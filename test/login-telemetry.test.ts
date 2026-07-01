import { describe, it, expect, beforeEach } from 'vitest';
import { ByteWriter } from '../src/protocol/writer.js';
import { decodeFrame } from '../src/protocol/decode.js';
import * as encode from '../src/protocol/encode.js';
import { Cmd, Resp, Push, AdvType } from '../src/protocol/constants.js';
import { fromHex, toHex } from '../src/protocol/hex.js';
import { MeshCore } from '../src/client.js';
import type { Transport } from '../src/transport/transport.js';

const SELF = 'cc'.repeat(32);
const SELF_PREFIX = 'cccccccccccc';
const PUB = 'a1b2c3d4e5f6' + '33'.repeat(26);
const PUB_PREFIX = 'a1b2c3d4e5f6';

// ---- encoders ----

describe('login/status/telemetry encoders', () => {
  it('sendLogin: key + password', () => {
    const f = encode.sendLogin(PUB, 'secret');
    expect(f[0]).toBe(Cmd.SEND_LOGIN);
    expect(toHex(f.slice(1, 33))).toBe(PUB);
    expect(new TextDecoder().decode(f.slice(33))).toBe('secret');
  });

  it('logout / sendStatusReq / hasConnection carry a full key', () => {
    for (const [fn, cmd] of [
      [encode.logout, Cmd.LOGOUT],
      [encode.sendStatusReq, Cmd.SEND_STATUS_REQ],
      [encode.hasConnection, Cmd.HAS_CONNECTION],
    ] as const) {
      const f = fn(PUB);
      expect(f[0]).toBe(cmd);
      expect(f.length).toBe(1 + 32);
      expect(toHex(f.slice(1))).toBe(PUB);
    }
  });

  it('sendTelemetryReq: 3 reserved bytes then key at offset 4', () => {
    const f = encode.sendTelemetryReq(PUB);
    expect(f[0]).toBe(Cmd.SEND_TELEMETRY_REQ);
    expect([...f.slice(1, 4)]).toEqual([0, 0, 0]);
    expect(toHex(f.slice(4))).toBe(PUB);
    expect(f.length).toBe(4 + 32);
  });

  it('sendSelfTelemetryReq is exactly 4 bytes', () => {
    const f = encode.sendSelfTelemetryReq();
    expect(f.length).toBe(4);
    expect(f[0]).toBe(Cmd.SEND_TELEMETRY_REQ);
  });
});

// ---- decoders ----

describe('login/status/telemetry decoders', () => {
  it('LOGIN_SUCCESS (legacy 8-byte form)', () => {
    const w = new ByteWriter().u8(Push.LOGIN_SUCCESS).u8(0).bytes(fromHex(PUB_PREFIX));
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'loginSuccess') throw new Error('wrong type');
    expect(d.result.pubKeyPrefix).toBe(PUB_PREFIX);
    expect(d.result.permissions).toBe(0);
    expect(d.result.serverTimestamp).toBeUndefined();
  });

  it('LOGIN_SUCCESS (new form with timestamp/acl/fw)', () => {
    const w = new ByteWriter()
      .u8(Push.LOGIN_SUCCESS)
      .u8(1) // permissions (admin)
      .bytes(fromHex(PUB_PREFIX))
      .u32(1_700_000_000)
      .u8(0x0f) // acl
      .u8(7); // fw level
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'loginSuccess') throw new Error('wrong type');
    expect(d.result.permissions).toBe(1);
    expect(d.result.serverTimestamp).toBe(1_700_000_000);
    expect(d.result.aclPermissions).toBe(0x0f);
    expect(d.result.firmwareVerLevel).toBe(7);
  });

  it('LOGIN_FAIL', () => {
    const w = new ByteWriter().u8(Push.LOGIN_FAIL).u8(0).bytes(fromHex(PUB_PREFIX));
    expect(decodeFrame(w.toBytes())).toEqual({ type: 'loginFail', pubKeyPrefix: PUB_PREFIX });
  });

  it('STATUS_RESPONSE / TELEMETRY_RESPONSE carry prefix + raw blob', () => {
    for (const [code, type] of [
      [Push.STATUS_RESPONSE, 'statusResponse'],
      [Push.TELEMETRY_RESPONSE, 'telemetryResponse'],
    ] as const) {
      const w = new ByteWriter().u8(code).u8(0).bytes(fromHex(PUB_PREFIX)).bytes(fromHex('deadbeef'));
      const d = decodeFrame(w.toBytes());
      if (d.type !== type) throw new Error('wrong type');
      expect(d.response.pubKeyPrefix).toBe(PUB_PREFIX);
      expect(toHex(d.response.data)).toBe('deadbeef');
    }
  });

  it('BINARY_RESPONSE carries a tag + blob', () => {
    const w = new ByteWriter().u8(Push.BINARY_RESPONSE).u8(0).u32(0xdeadbeef).bytes(fromHex('0102'));
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'binaryResponse') throw new Error('wrong type');
    expect(d.response.tag).toBe(0xdeadbeef);
    expect(toHex(d.response.data)).toBe('0102');
  });
});

// ---- async request -> push flow ----

class FakeServer implements Transport {
  connected = false;
  loginShouldFail = false;
  private frameListeners = new Set<(f: Uint8Array) => void>();
  private disconnectListeners = new Set<() => void>();

  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
    for (const l of this.disconnectListeners) l();
  }
  onFrame(l: (f: Uint8Array) => void): () => void {
    this.frameListeners.add(l);
    return () => this.frameListeners.delete(l);
  }
  onDisconnect(l: () => void): () => void {
    this.disconnectListeners.add(l);
    return () => this.disconnectListeners.delete(l);
  }
  private push(frame: Uint8Array): void {
    queueMicrotask(() => {
      for (const l of [...this.frameListeners]) l(frame);
    });
  }
  private sent(): Uint8Array {
    return new ByteWriter().u8(Resp.SENT).u8(0).u32(0x11223344).u32(1000).toBytes();
  }

  async send(frame: Uint8Array): Promise<void> {
    switch (frame[0]) {
      case Cmd.DEVICE_QUERY:
        this.push(
          new ByteWriter()
            .u8(Resp.DEVICE_INFO).u8(9).u8(50).u8(8).u32(0)
            .fixedStr('d', 12).fixedStr('m', 40).fixedStr('v1', 20).u8(0).u8(0).toBytes(),
        );
        break;
      case Cmd.APP_START:
        this.push(
          new ByteWriter()
            .u8(Resp.SELF_INFO).u8(AdvType.CHAT).u8(20).u8(22)
            .bytes(fromHex(SELF))
            .i32(0).i32(0).u8(0).u8(0).u8(0).u8(0)
            .u32(915_000).u32(250_000).u8(10).u8(5).str('Self').toBytes(),
        );
        break;
      case Cmd.SEND_LOGIN:
        this.push(this.sent());
        if (this.loginShouldFail) {
          this.push(new ByteWriter().u8(Push.LOGIN_FAIL).u8(0).bytes(fromHex(PUB_PREFIX)).toBytes());
        } else {
          this.push(
            new ByteWriter()
              .u8(Push.LOGIN_SUCCESS).u8(1).bytes(fromHex(PUB_PREFIX))
              .u32(1_700_000_000).u8(0x0f).u8(7).toBytes(),
          );
        }
        break;
      case Cmd.SEND_STATUS_REQ:
        this.push(this.sent());
        this.push(
          new ByteWriter().u8(Push.STATUS_RESPONSE).u8(0).bytes(fromHex(PUB_PREFIX)).bytes(fromHex('aabb')).toBytes(),
        );
        break;
      case Cmd.SEND_TELEMETRY_REQ:
        if (frame.length === 4) {
          // self telemetry -> push directly, no SENT
          this.push(
            new ByteWriter().u8(Push.TELEMETRY_RESPONSE).u8(0).bytes(fromHex(SELF_PREFIX)).bytes(fromHex('cafe')).toBytes(),
          );
        } else {
          this.push(this.sent());
          this.push(
            new ByteWriter().u8(Push.TELEMETRY_RESPONSE).u8(0).bytes(fromHex(PUB_PREFIX)).bytes(fromHex('beef')).toBytes(),
          );
        }
        break;
      case Cmd.LOGOUT:
      case Cmd.HAS_CONNECTION:
        this.push(new Uint8Array([Resp.OK]));
        break;
      default:
        this.push(new Uint8Array([Resp.ERR, 1]));
    }
  }
}

describe('login/status/telemetry client flow', () => {
  let server: FakeServer;
  let client: MeshCore;

  beforeEach(async () => {
    server = new FakeServer();
    client = new MeshCore(server);
    await client.connect();
  });

  it('login resolves with the server LoginResult', async () => {
    const result = await client.login(PUB, 'password');
    expect(result.pubKeyPrefix).toBe(PUB_PREFIX);
    expect(result.permissions).toBe(1);
    expect(result.serverTimestamp).toBe(1_700_000_000);
    expect(result.firmwareVerLevel).toBe(7);
  });

  it('login rejects on LOGIN_FAIL', async () => {
    server.loginShouldFail = true;
    await expect(client.login(PUB, 'bad')).rejects.toThrow(/rejected/);
  });

  it('login also fires the "login" event', async () => {
    const evt = new Promise((r) => client.on('login', r));
    await client.login(PUB, 'password');
    expect(await evt).toMatchObject({ pubKeyPrefix: PUB_PREFIX });
  });

  it('requestStatus resolves with the raw blob', async () => {
    const res = await client.requestStatus(PUB);
    expect(res.pubKeyPrefix).toBe(PUB_PREFIX);
    expect(toHex(res.data)).toBe('aabb');
  });

  it('requestTelemetry resolves with the raw blob', async () => {
    const res = await client.requestTelemetry(PUB);
    expect(toHex(res.data)).toBe('beef');
  });

  it('getSelfTelemetry resolves via a direct push', async () => {
    const res = await client.getSelfTelemetry();
    expect(res.pubKeyPrefix).toBe(SELF_PREFIX);
    expect(toHex(res.data)).toBe('cafe');
  });

  it('hasConnection returns true on OK', async () => {
    expect(await client.hasConnection(PUB)).toBe(true);
  });
});

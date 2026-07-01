import { describe, it, expect, beforeEach } from 'vitest';
import { ByteWriter } from '../src/protocol/writer.js';
import { decodeFrame } from '../src/protocol/decode.js';
import * as encode from '../src/protocol/encode.js';
import { Cmd, Resp, Push, AdvType } from '../src/protocol/constants.js';
import { fromHex, toHex } from '../src/protocol/hex.js';
import { MeshCore } from '../src/client.js';
import type { Transport } from '../src/transport/transport.js';

const PUB = 'a1b2c3d4e5f6' + '44'.repeat(26);

describe('raw/binary/control encoders', () => {
  it('sendRawData: path_len, path, payload', () => {
    const f = encode.sendRawData(fromHex('aabb'), fromHex('01020304'));
    expect(f[0]).toBe(Cmd.SEND_RAW_DATA);
    expect(f[1]).toBe(2); // path_len
    expect([...f.slice(2, 4)]).toEqual([0xaa, 0xbb]);
    expect([...f.slice(4)]).toEqual([1, 2, 3, 4]);
  });

  it('sendRawData rejects short payloads', () => {
    expect(() => encode.sendRawData('', '010203')).toThrow(/>= 4/);
  });

  it('sendBinaryReq: key + data', () => {
    const f = encode.sendBinaryReq(PUB, fromHex('ff00'));
    expect(f[0]).toBe(Cmd.SEND_BINARY_REQ);
    expect(toHex(f.slice(1, 33))).toBe(PUB);
    expect([...f.slice(33)]).toEqual([0xff, 0x00]);
  });

  it('sendControlData requires the high bit on the first byte', () => {
    expect([...encode.sendControlData(fromHex('80aa'))]).toEqual([Cmd.SEND_CONTROL_DATA, 0x80, 0xaa]);
    expect(() => encode.sendControlData(fromHex('01'))).toThrow(/0x80/);
  });
});

describe('raw/control decoders', () => {
  it('RAW_DATA: snr, rssi, reserved, payload', () => {
    const w = new ByteWriter().u8(Push.RAW_DATA).i8(8).i8(-90).u8(0xff).bytes(fromHex('cafe'));
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'rawData') throw new Error('wrong type');
    expect(d.data.snr).toBe(2);
    expect(d.data.rssi).toBe(-90);
    expect(toHex(d.data.payload)).toBe('cafe');
  });

  it('CONTROL_DATA: snr, rssi, path_len, payload', () => {
    const w = new ByteWriter().u8(Push.CONTROL_DATA).i8(-4).i8(-100).u8(3).bytes(fromHex('8899'));
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'controlData') throw new Error('wrong type');
    expect(d.data.snr).toBe(-1);
    expect(d.data.rssi).toBe(-100);
    expect(d.data.pathLen).toBe(3);
    expect(toHex(d.data.payload)).toBe('8899');
  });

  it('LOG_RX_DATA: snr, rssi, raw packet', () => {
    // observed on real hardware as code 0x88
    const w = new ByteWriter().u8(Push.LOG_RX_DATA).i8(21).i8(-106).bytes(fromHex('001122'));
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'rxLog') throw new Error('wrong type');
    expect(d.data.snr).toBe(5.25);
    expect(d.data.rssi).toBe(-106);
    expect(toHex(d.data.raw)).toBe('001122');
  });
});

// ---- client flow ----

class Fake implements Transport {
  connected = false;
  private listeners = new Set<(f: Uint8Array) => void>();
  private dcl = new Set<() => void>();
  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
    for (const l of this.dcl) l();
  }
  onFrame(l: (f: Uint8Array) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onDisconnect(l: () => void): () => void {
    this.dcl.add(l);
    return () => this.dcl.delete(l);
  }
  push(frame: Uint8Array): void {
    queueMicrotask(() => {
      for (const l of [...this.listeners]) l(frame);
    });
  }
  async send(frame: Uint8Array): Promise<void> {
    switch (frame[0]) {
      case Cmd.DEVICE_QUERY:
        this.push(
          new ByteWriter().u8(Resp.DEVICE_INFO).u8(9).u8(50).u8(8).u32(0)
            .fixedStr('d', 12).fixedStr('m', 40).fixedStr('v1', 20).u8(0).u8(0).toBytes(),
        );
        break;
      case Cmd.APP_START:
        this.push(
          new ByteWriter().u8(Resp.SELF_INFO).u8(AdvType.CHAT).u8(20).u8(22)
            .bytes(fromHex('cc'.repeat(32))).i32(0).i32(0).u8(0).u8(0).u8(0).u8(0)
            .u32(915_000).u32(250_000).u8(10).u8(5).str('N').toBytes(),
        );
        break;
      case Cmd.SEND_BINARY_REQ:
        // device assigns tag 0xABCD1234 and echoes in SENT, then responds
        this.push(new ByteWriter().u8(Resp.SENT).u8(0).u32(0xabcd1234).u32(500).toBytes());
        this.push(
          new ByteWriter().u8(Push.BINARY_RESPONSE).u8(0).u32(0xabcd1234).bytes(fromHex('1234')).toBytes(),
        );
        break;
      case Cmd.SEND_RAW_DATA:
      case Cmd.SEND_CONTROL_DATA:
        this.push(new Uint8Array([Resp.OK]));
        break;
      default:
        this.push(new Uint8Array([Resp.ERR, 1]));
    }
  }
}

describe('client raw/binary/control', () => {
  let device: Fake;
  let client: MeshCore;
  beforeEach(async () => {
    device = new Fake();
    client = new MeshCore(device);
    await client.connect();
  });

  it('sendRawData / sendControlData resolve on OK', async () => {
    await expect(client.sendRawData('aabb', '01020304')).resolves.toBeUndefined();
    await expect(client.sendControlData(fromHex('80ff'))).resolves.toBeUndefined();
  });

  it('requestBinary correlates the response by the device-assigned tag', async () => {
    const res = await client.requestBinary(PUB, fromHex('00'));
    expect(res.tag >>> 0).toBe(0xabcd1234);
    expect(toHex(res.data)).toBe('1234');
  });

  it('emits rawData / controlData pushes', async () => {
    const raw = new Promise((r) => client.on('rawData', r));
    const ctrl = new Promise((r) => client.on('controlData', r));
    device.push(new ByteWriter().u8(Push.RAW_DATA).i8(8).i8(-80).u8(0xff).bytes(fromHex('aa')).toBytes());
    device.push(new ByteWriter().u8(Push.CONTROL_DATA).i8(4).i8(-70).u8(0).bytes(fromHex('80bb')).toBytes());
    expect(await raw).toMatchObject({ snr: 2, rssi: -80 });
    expect(await ctrl).toMatchObject({ snr: 1, rssi: -70 });
  });
});

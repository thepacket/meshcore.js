import { describe, it, expect, beforeEach } from 'vitest';
import { MeshCore } from '../src/client.js';
import type { Transport } from '../src/transport/transport.js';
import { ByteWriter } from '../src/protocol/writer.js';
import { Resp, Push, Cmd, AdvType, TxtType } from '../src/protocol/constants.js';
import { fromHex } from '../src/protocol/hex.js';

const PUB = 'a1b2c3d4e5f6' + '11'.repeat(26);

/** In-memory transport that emulates a MeshCore companion device. */
class FakeDevice implements Transport {
  connected = false;
  private frameListeners = new Set<(f: Uint8Array) => void>();
  private disconnectListeners = new Set<() => void>();
  msgQueue: Uint8Array[] = [];

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

  /** Deliver a device -> app frame. */
  push(frame: Uint8Array): void {
    queueMicrotask(() => {
      for (const l of [...this.frameListeners]) l(frame);
    });
  }

  async send(frame: Uint8Array): Promise<void> {
    const cmd = frame[0];
    switch (cmd) {
      case Cmd.DEVICE_QUERY:
        this.push(
          new ByteWriter()
            .u8(Resp.DEVICE_INFO)
            .u8(9).u8(50).u8(8).u32(4321)
            .fixedStr('1 Jul 2026', 12)
            .fixedStr('Heltec', 40)
            .fixedStr('v1.7.0', 20)
            .u8(0).u8(0)
            .toBytes(),
        );
        break;
      case Cmd.APP_START:
        this.push(
          new ByteWriter()
            .u8(Resp.SELF_INFO)
            .u8(AdvType.CHAT).u8(20).u8(22)
            .bytes(fromHex(PUB))
            .i32(0).i32(0)
            .u8(0).u8(0).u8(0).u8(0)
            .u32(915_000).u32(250_000).u8(10).u8(5)
            .str('FakeNode')
            .toBytes(),
        );
        break;
      case Cmd.GET_CONTACTS: {
        this.push(new ByteWriter().u8(Resp.CONTACTS_START).u32(1).toBytes());
        const path = new Uint8Array(64);
        this.push(
          new ByteWriter()
            .u8(Resp.CONTACT)
            .bytes(fromHex(PUB))
            .u8(AdvType.CHAT).u8(0).u8(0xff).bytes(path)
            .fixedStr('Alice', 32)
            .u32(1700).i32(0).i32(0).u32(1701)
            .toBytes(),
        );
        this.push(new ByteWriter().u8(Resp.END_OF_CONTACTS).u32(1701).toBytes());
        break;
      }
      case Cmd.SEND_TXT_MSG:
        this.push(
          new ByteWriter().u8(Resp.SENT).u8(0).u32(0xdeadbeef).u32(1500).toBytes(),
        );
        break;
      case Cmd.GET_DEVICE_TIME:
        this.push(new ByteWriter().u8(Resp.CURR_TIME).u32(1_700_000_000).toBytes());
        break;
      case Cmd.SYNC_NEXT_MESSAGE: {
        const next = this.msgQueue.shift();
        this.push(next ?? new Uint8Array([Resp.NO_MORE_MESSAGES]));
        break;
      }
      case Cmd.GET_CHANNEL:
        if (frame[1] === 0) {
          this.push(
            new ByteWriter()
              .u8(Resp.CHANNEL_INFO)
              .u8(0)
              .fixedStr('public', 32)
              .bytes(fromHex('000102030405060708090a0b0c0d0e0f'))
              .toBytes(),
          );
        } else {
          this.push(new Uint8Array([Resp.ERR, 2])); // NOT_FOUND
        }
        break;
      case Cmd.GET_CONTACT_BY_KEY:
        this.push(new Uint8Array([Resp.ERR, 2])); // NOT_FOUND -> null
        break;
      case Cmd.GET_BATT_AND_STORAGE:
        this.push(new ByteWriter().u8(Resp.BATT_AND_STORAGE).u16(3700).u32(128).u32(1024).toBytes());
        break;
      case Cmd.SEND_SELF_ADVERT:
      case Cmd.SET_DEVICE_TIME:
      case Cmd.SET_CHANNEL:
      case Cmd.SET_RADIO_PARAMS:
        this.push(new Uint8Array([Resp.OK]));
        break;
      case Cmd.REBOOT:
        // device reboots without replying
        break;
      default:
        this.push(new Uint8Array([Resp.ERR, 1]));
    }
  }

  queueContactMessage(text: string): void {
    this.msgQueue.push(
      new ByteWriter()
        .u8(Resp.CONTACT_MSG_RECV_V3)
        .i8(-20).u8(0).u8(0)
        .bytes(fromHex('a1b2c3d4e5f6'))
        .u8(0xff).u8(TxtType.PLAIN).u32(1_700_000_000)
        .str(text)
        .toBytes(),
    );
  }
}

let device: FakeDevice;
let client: MeshCore;

beforeEach(() => {
  device = new FakeDevice();
  client = new MeshCore(device);
});

describe('MeshCore client', () => {
  it('performs the handshake and exposes device/self info', async () => {
    const { deviceInfo, selfInfo } = await client.connect();
    expect(deviceInfo.firmwareVersion).toBe('v1.7.0');
    expect(deviceInfo.maxContacts).toBe(100);
    expect(selfInfo.name).toBe('FakeNode');
    expect(selfInfo.publicKey).toBe(PUB);
    expect(selfInfo.freq).toBe(915);
    expect(client.connected).toBe(true);
  });

  it('streams the contacts list', async () => {
    await client.connect();
    const contacts = await client.getContacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toBe('Alice');
    expect(contacts[0]!.publicKey).toBe(PUB);
  });

  it('sends a text message and returns the ACK tag', async () => {
    await client.connect();
    const result = await client.sendTextMessage(PUB, 'hello');
    expect(result.expectedAck).toBe(0xdeadbeef);
    expect(result.estTimeout).toBe(1500);
  });

  it('reads device time', async () => {
    await client.connect();
    expect((await client.getDeviceTime()).epochSeconds).toBe(1_700_000_000);
  });

  it('serialises overlapping commands correctly', async () => {
    await client.connect();
    const [contacts, sent, time] = await Promise.all([
      client.getContacts(),
      client.sendTextMessage(PUB, 'hi'),
      client.getDeviceTime(),
    ]);
    expect(contacts).toHaveLength(1);
    expect(sent.expectedAck).toBe(0xdeadbeef);
    expect(time.epochSeconds).toBe(1_700_000_000);
  });

  it('auto-drains messages on MSG_WAITING push and emits them', async () => {
    await client.connect();
    device.queueContactMessage('incoming!');
    const received = new Promise<string>((resolve) => {
      client.on('message', (m) => resolve(m.text));
    });
    device.push(new Uint8Array([Push.MSG_WAITING]));
    expect(await received).toBe('incoming!');
  });

  it('emits advert and sendConfirmed pushes', async () => {
    await client.connect();
    const advert = new Promise<string>((r) => client.on('advert', r));
    const confirmed = new Promise<number>((r) =>
      client.on('sendConfirmed', (c) => r(c.ackTag)),
    );
    device.push(new ByteWriter().u8(Push.ADVERT).bytes(fromHex(PUB)).toBytes());
    device.push(new ByteWriter().u8(Push.SEND_CONFIRMED).u32(0xdeadbeef).u32(500).toBytes());
    expect(await advert).toBe(PUB);
    expect(await confirmed).toBe(0xdeadbeef);
  });

  it('throws MeshCoreError on device error replies', async () => {
    await client.connect();
    // channel message handler in the fake returns ERR
    await expect(client.sendChannelMessage(9, 'x')).rejects.toThrow(/UNSUPPORTED_CMD/);
  });

  it('reads a channel and returns null for empty slots', async () => {
    await client.connect();
    const ch = await client.getChannel(0);
    expect(ch?.name).toBe('public');
    expect(ch?.secret).toBe('000102030405060708090a0b0c0d0e0f');
    expect(await client.getChannel(3)).toBeNull();
  });

  it('getContactByKey returns null on NOT_FOUND', async () => {
    await client.connect();
    expect(await client.getContactByKey(PUB)).toBeNull();
  });

  it('reads battery and storage', async () => {
    await client.connect();
    const b = await client.getBatteryAndStorage();
    expect(b.batteryMillivolts).toBe(3700);
    expect(b.storageTotalKb).toBe(1024);
  });

  it('reboot is fire-and-forget (no reply)', async () => {
    await client.connect();
    await expect(client.reboot()).resolves.toBeUndefined();
  });

  it('emits disconnect', async () => {
    await client.connect();
    const gone = new Promise<void>((r) => client.on('disconnect', r));
    await device.disconnect();
    await gone;
  });
});

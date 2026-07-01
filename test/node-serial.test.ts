import { describe, it, expect, beforeEach } from 'vitest';
import {
  UsbFrameParser,
  encodeUsbFrame,
  FRAME_TO_DEVICE,
  FRAME_FROM_DEVICE,
} from '../src/transport/usb-framing.js';
import { NodeSerialTransport, type SerialPortLike } from '../src/transport/node-serial.js';
import { MeshCore } from '../src/client.js';
import { ByteWriter } from '../src/protocol/writer.js';
import { Cmd, Resp, AdvType } from '../src/protocol/constants.js';
import { fromHex } from '../src/protocol/hex.js';

// ---- USB framing codec ----

describe('encodeUsbFrame', () => {
  it('prefixes "<" and a little-endian length', () => {
    const f = encodeUsbFrame(new Uint8Array([1, 2, 3]));
    expect([...f]).toEqual([FRAME_TO_DEVICE, 3, 0, 1, 2, 3]);
  });

  it('encodes a length > 255 across two bytes', () => {
    const f = encodeUsbFrame(new Uint8Array(300));
    expect(f[0]).toBe(FRAME_TO_DEVICE);
    expect(f[1]).toBe(300 & 0xff);
    expect(f[2]).toBe(300 >> 8);
  });
});

describe('UsbFrameParser', () => {
  const wrap = (payload: number[]): Uint8Array =>
    new Uint8Array([FRAME_FROM_DEVICE, payload.length & 0xff, payload.length >> 8, ...payload]);

  it('parses a single frame', () => {
    const p = new UsbFrameParser();
    const frames = p.push(wrap([10, 20, 30]));
    expect(frames.map((f) => [...f])).toEqual([[10, 20, 30]]);
  });

  it('parses multiple frames in one chunk', () => {
    const p = new UsbFrameParser();
    const chunk = new Uint8Array([...wrap([1]), ...wrap([2, 3])]);
    const frames = p.push(chunk);
    expect(frames.map((f) => [...f])).toEqual([[1], [2, 3]]);
  });

  it('reassembles a frame split across chunks (including the length bytes)', () => {
    const p = new UsbFrameParser();
    const full = wrap([9, 8, 7, 6, 5]);
    // split at every offset
    expect(p.push(full.subarray(0, 1))).toEqual([]); // just '>'
    expect(p.push(full.subarray(1, 2))).toEqual([]); // LSB
    expect(p.push(full.subarray(2, 3))).toEqual([]); // MSB
    expect(p.push(full.subarray(3, 6))).toEqual([]); // partial payload
    const frames = p.push(full.subarray(6)); // rest
    expect(frames.map((f) => [...f])).toEqual([[9, 8, 7, 6, 5]]);
  });

  it('skips garbage bytes before the header', () => {
    const p = new UsbFrameParser();
    const chunk = new Uint8Array([0x00, 0xff, 0x41, ...wrap([42])]);
    expect(p.push(chunk).map((f) => [...f])).toEqual([[42]]);
  });

  it('ignores zero-length frames', () => {
    const p = new UsbFrameParser();
    expect(p.push(new Uint8Array([FRAME_FROM_DEVICE, 0, 0]))).toEqual([]);
  });

  it('resyncs on an implausibly large length', () => {
    const p = new UsbFrameParser();
    // len = 0xFFFF (> MAX) then a valid frame afterwards
    const chunk = new Uint8Array([FRAME_FROM_DEVICE, 0xff, 0xff, ...wrap([7])]);
    expect(p.push(chunk).map((f) => [...f])).toEqual([[7]]);
  });
});

// ---- transport + client over an injected fake port ----

/** In-memory SerialPortLike that behaves like a MeshCore device on USB. */
class FakeSerialPort implements SerialPortLike {
  isOpen = false;
  private dataCb?: (chunk: Uint8Array) => void;
  private closeCb?: () => void;
  private parser = new UsbFrameParser();

  open(cb?: (err: Error | null) => void): void {
    this.isOpen = true;
    cb?.(null);
  }
  close(cb?: (err: Error | null) => void): void {
    this.isOpen = false;
    this.closeCb?.();
    cb?.(null);
  }
  on(event: string, listener: (...args: never[]) => void): this {
    if (event === 'data') this.dataCb = listener as (c: Uint8Array) => void;
    if (event === 'close') this.closeCb = listener as () => void;
    return this;
  }
  write(data: Uint8Array, cb?: (err: Error | null | undefined) => void): boolean {
    // `data` is a full app->device USB frame ('<' + len + payload).
    // The device parses '<' frames; emulate by reusing the parser on a
    // rewritten header, then respond.
    const rewritten = new Uint8Array(data);
    rewritten[0] = FRAME_FROM_DEVICE; // pretend it's a '>' so our parser reads it
    for (const cmd of this.parser.push(rewritten)) this.handleCommand(cmd);
    cb?.(null);
    return true;
  }

  /** Deliver a device->app frame to the transport. */
  private emit(payload: Uint8Array): void {
    queueMicrotask(() => this.dataCb?.(encodeUsbFrameFromDevice(payload)));
  }

  private handleCommand(cmd: Uint8Array): void {
    switch (cmd[0]) {
      case Cmd.DEVICE_QUERY:
        this.emit(
          new ByteWriter()
            .u8(Resp.DEVICE_INFO).u8(9).u8(50).u8(8).u32(0)
            .fixedStr('1 Jul 2026', 12).fixedStr('RAK', 40).fixedStr('v1.7.0', 20)
            .u8(0).u8(0).toBytes(),
        );
        break;
      case Cmd.APP_START:
        this.emit(
          new ByteWriter()
            .u8(Resp.SELF_INFO).u8(AdvType.CHAT).u8(20).u8(22)
            .bytes(fromHex('cc'.repeat(32)))
            .i32(0).i32(0).u8(0).u8(0).u8(0).u8(0)
            .u32(915_000).u32(250_000).u8(10).u8(5).str('SerialNode').toBytes(),
        );
        break;
      case Cmd.GET_DEVICE_TIME:
        this.emit(new ByteWriter().u8(Resp.CURR_TIME).u32(1_700_000_000).toBytes());
        break;
      default:
        this.emit(new Uint8Array([Resp.OK]));
    }
  }
}

/** Wrap a payload in a device->app ('>') USB frame. */
function encodeUsbFrameFromDevice(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(3 + payload.length);
  out[0] = FRAME_FROM_DEVICE;
  out[1] = payload.length & 0xff;
  out[2] = (payload.length >> 8) & 0xff;
  out.set(payload, 3);
  return out;
}

describe('NodeSerialTransport (injected port)', () => {
  let port: FakeSerialPort;
  let client: MeshCore;

  beforeEach(() => {
    port = new FakeSerialPort();
    client = new MeshCore(new NodeSerialTransport({ port }));
  });

  it('handshakes and runs commands over USB framing', async () => {
    const { deviceInfo, selfInfo } = await client.connect();
    expect(deviceInfo.manufacturer).toBe('RAK');
    expect(selfInfo.name).toBe('SerialNode');
    expect((await client.getDeviceTime()).epochSeconds).toBe(1_700_000_000);
  });

  it('reports an unexpected port close as a disconnect', async () => {
    await client.connect();
    const gone = new Promise<void>((r) => client.on('disconnect', r));
    port.close(); // external drop (device unplugged / powered off)
    await gone;
    expect(client.connected).toBe(false);
  });
});

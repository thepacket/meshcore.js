import { describe, it, expect, beforeEach } from 'vitest';
import { ByteWriter } from '../src/protocol/writer.js';
import { decodeFrame } from '../src/protocol/decode.js';
import * as encode from '../src/protocol/encode.js';
import { Cmd, Resp, Push, AdvType } from '../src/protocol/constants.js';
import { fromHex } from '../src/protocol/hex.js';
import { MeshCore } from '../src/client.js';
import type { Transport } from '../src/transport/transport.js';

describe('sendTracePath encoder', () => {
  it('lays out tag, auth, flags, path', () => {
    const f = encode.sendTracePath({ path: fromHex('aabbcc'), tag: 0x01020304, authCode: 0, flags: 0 });
    const view = new DataView(f.buffer, f.byteOffset);
    expect(f[0]).toBe(Cmd.SEND_TRACE_PATH);
    expect(view.getUint32(1, true)).toBe(0x01020304);
    expect(view.getUint32(5, true)).toBe(0);
    expect(f[9]).toBe(0);
    expect([...f.slice(10)]).toEqual([0xaa, 0xbb, 0xcc]);
  });
});

describe('TRACE_DATA decoder', () => {
  it('decodes per-hop hashes + SNR and the final SNR (flags=0, 1-byte hops)', () => {
    // path_len=3 hops (aa,bb,cc), snrs +2,+1,-1 dB (*4), final +3 dB
    const w = new ByteWriter()
      .u8(Push.TRACE_DATA)
      .u8(0) // reserved
      .u8(3) // path_len
      .u8(0) // flags (path_sz=0)
      .u32(0xdeadbeef) // tag
      .u32(0) // auth
      .bytes(fromHex('aabbcc')) // path hashes
      .i8(8).i8(4).i8(-4) // per-hop SNR *4
      .i8(12); // final SNR *4
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'traceData') throw new Error('wrong type');
    expect(d.trace.tag).toBe(0xdeadbeef);
    expect(d.trace.hops).toHaveLength(3);
    expect(d.trace.hops[0]).toEqual({ hash: 'aa', snr: 2 });
    expect(d.trace.hops[1]).toEqual({ hash: 'bb', snr: 1 });
    expect(d.trace.hops[2]).toEqual({ hash: 'cc', snr: -1 });
    expect(d.trace.finalSnr).toBe(3);
  });

  it('groups hash bytes per hop when flags select 2-byte hashes', () => {
    // path_sz=1 -> 2 bytes per hop; path_len=4 -> 2 hops
    const w = new ByteWriter()
      .u8(Push.TRACE_DATA)
      .u8(0).u8(4).u8(1) // flags path_sz=1
      .u32(7).u32(0)
      .bytes(fromHex('aaaabbbb'))
      .i8(4).i8(8) // 2 hop SNRs
      .i8(0); // final
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'traceData') throw new Error('wrong type');
    expect(d.trace.hops.map((h) => h.hash)).toEqual(['aaaa', 'bbbb']);
    expect(d.trace.hops[1]!.snr).toBe(2);
  });
});

// ---- client flow ----

class FakeTracer implements Transport {
  connected = false;
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
            .bytes(fromHex('cc'.repeat(32)))
            .i32(0).i32(0).u8(0).u8(0).u8(0).u8(0)
            .u32(915_000).u32(250_000).u8(10).u8(5).str('N').toBytes(),
        );
        break;
      case Cmd.SEND_TRACE_PATH: {
        const view = new DataView(frame.buffer, frame.byteOffset);
        const tag = view.getUint32(1, true); // echo the app's tag
        this.push(new ByteWriter().u8(Resp.SENT).u8(0).u32(tag).u32(500).toBytes());
        this.push(
          new ByteWriter().u8(Push.TRACE_DATA).u8(0).u8(2).u8(0).u32(tag).u32(0)
            .bytes(fromHex('aabb')).i8(8).i8(4).i8(12).toBytes(),
        );
        break;
      }
      default:
        this.push(new Uint8Array([Resp.ERR, 1]));
    }
  }
}

describe('client.tracePath', () => {
  let device: FakeTracer;
  let client: MeshCore;
  beforeEach(async () => {
    device = new FakeTracer();
    client = new MeshCore(device);
    await client.connect();
  });

  it('sends a trace and resolves with per-hop SNR correlated by tag', async () => {
    const trace = await client.tracePath('aabb', { tag: 0x11223344 });
    expect(trace.tag).toBe(0x11223344);
    expect(trace.hops.map((h) => h.hash)).toEqual(['aa', 'bb']);
    expect(trace.hops[0]!.snr).toBe(2);
    expect(trace.finalSnr).toBe(3);
  });

  it('also fires the "traceData" event', async () => {
    const evt = new Promise((r) => client.on('traceData', r));
    await client.tracePath('aabb', { tag: 5 });
    expect(await evt).toMatchObject({ tag: 5 });
  });
});

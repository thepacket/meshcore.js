import { describe, it, expect, beforeEach } from 'vitest';
import { ByteWriter } from '../src/protocol/writer.js';
import { decodeFrame } from '../src/protocol/decode.js';
import * as encode from '../src/protocol/encode.js';
import { Cmd, Resp, StatsType, AdvType } from '../src/protocol/constants.js';
import { fromHex } from '../src/protocol/hex.js';
import { MeshCore } from '../src/client.js';
import type { Transport } from '../src/transport/transport.js';

describe('getStats encoder', () => {
  it('encodes command + sub-type', () => {
    expect([...encode.getStats(StatsType.RADIO)]).toEqual([Cmd.GET_STATS, StatsType.RADIO]);
  });
});

describe('STATS decoder', () => {
  it('core stats', () => {
    const w = new ByteWriter()
      .u8(Resp.STATS).u8(StatsType.CORE)
      .u16(3700).u32(86_400).u16(0x0002).u8(5);
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'stats' || d.stats.kind !== 'core') throw new Error('wrong type');
    expect(d.stats.batteryMillivolts).toBe(3700);
    expect(d.stats.uptimeSeconds).toBe(86_400);
    expect(d.stats.errFlags).toBe(2);
    expect(d.stats.queueLength).toBe(5);
  });

  it('radio stats (signed noise floor + SNR/4)', () => {
    const w = new ByteWriter()
      .u8(Resp.STATS).u8(StatsType.RADIO)
      .i16(-125).i8(-90).i8(-6).u32(120).u32(3600);
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'stats' || d.stats.kind !== 'radio') throw new Error('wrong type');
    expect(d.stats.noiseFloor).toBe(-125);
    expect(d.stats.lastRssi).toBe(-90);
    expect(d.stats.lastSnr).toBe(-1.5);
    expect(d.stats.txAirtimeSeconds).toBe(120);
    expect(d.stats.rxAirtimeSeconds).toBe(3600);
  });

  it('packet counters', () => {
    const w = new ByteWriter()
      .u8(Resp.STATS).u8(StatsType.PACKETS)
      .u32(100).u32(50).u32(10).u32(40).u32(30).u32(70).u32(3);
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'stats' || d.stats.kind !== 'packets') throw new Error('wrong type');
    expect(d.stats).toMatchObject({
      received: 100, sent: 50, sentFlood: 10, sentDirect: 40,
      recvFlood: 30, recvDirect: 70, recvErrors: 3,
    });
  });

  it('unknown sub-type falls back to raw', () => {
    const d = decodeFrame(new Uint8Array([Resp.STATS, 0x09, 1, 2]));
    expect(d.type).toBe('raw');
  });
});

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
  private push(frame: Uint8Array): void {
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
      case Cmd.GET_STATS:
        if (frame[1] === StatsType.CORE) {
          this.push(new ByteWriter().u8(Resp.STATS).u8(StatsType.CORE).u16(3900).u32(3600).u16(0).u8(2).toBytes());
        } else {
          this.push(new Uint8Array([Resp.ERR, 6]));
        }
        break;
      default:
        this.push(new Uint8Array([Resp.OK]));
    }
  }
}

describe('client.getCoreStats', () => {
  let client: MeshCore;
  beforeEach(async () => {
    client = new MeshCore(new Fake());
    await client.connect();
  });

  it('returns typed core stats', async () => {
    const s = await client.getCoreStats();
    expect(s.kind).toBe('core');
    expect(s.batteryMillivolts).toBe(3900);
    expect(s.uptimeSeconds).toBe(3600);
    expect(s.queueLength).toBe(2);
  });
});

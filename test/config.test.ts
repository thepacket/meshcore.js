import { describe, it, expect, beforeEach } from 'vitest';
import { ByteWriter } from '../src/protocol/writer.js';
import { decodeFrame } from '../src/protocol/decode.js';
import * as encode from '../src/protocol/encode.js';
import { Cmd, Resp, AdvType } from '../src/protocol/constants.js';
import { fromHex, toHex } from '../src/protocol/hex.js';
import { MeshCore } from '../src/client.js';
import type { Transport } from '../src/transport/transport.js';

describe('config encoders', () => {
  it('setCustomVar sends "name:value"', () => {
    const f = encode.setCustomVar('gps', '1');
    expect(f[0]).toBe(Cmd.SET_CUSTOM_VAR);
    expect(new TextDecoder().decode(f.slice(1))).toBe('gps:1');
  });

  it('setTuningParams uses *1000 wire units', () => {
    const f = encode.setTuningParams(0.5, 2.5);
    const v = new DataView(f.buffer, f.byteOffset);
    expect(f[0]).toBe(Cmd.SET_TUNING_PARAMS);
    expect(v.getUint32(1, true)).toBe(500);
    expect(v.getUint32(5, true)).toBe(2500);
  });

  it('setDevicePin', () => {
    const f = encode.setDevicePin(123456);
    expect(new DataView(f.buffer, f.byteOffset).getUint32(1, true)).toBe(123456);
  });

  it('setOtherParams packs telemetry modes', () => {
    const f = encode.setOtherParams({
      manualAddContacts: 1,
      telemetryModeEnv: 1,
      telemetryModeLoc: 2,
      telemetryModeBase: 3,
    });
    expect(f[0]).toBe(Cmd.SET_OTHER_PARAMS);
    expect(f[1]).toBe(1);
    expect(f[2]).toBe((1 << 4) | (2 << 2) | 3);
  });

  it('setOtherParams minimal form is just the flag', () => {
    expect([...encode.setOtherParams({ manualAddContacts: 0 })]).toEqual([Cmd.SET_OTHER_PARAMS, 0]);
  });

  it('setAutoAddConfig with/without maxHops', () => {
    expect([...encode.setAutoAddConfig(0x03)]).toEqual([Cmd.SET_AUTOADD_CONFIG, 3]);
    expect([...encode.setAutoAddConfig(0x03, 5)]).toEqual([Cmd.SET_AUTOADD_CONFIG, 3, 5]);
  });

  it('setPathHashMode inserts a reserved 0 byte', () => {
    expect([...encode.setPathHashMode(2)]).toEqual([Cmd.SET_PATH_HASH_MODE, 0, 2]);
  });

  it('setAdvertLatLon scales by 1e6', () => {
    const f = encode.setAdvertLatLon(-33.5, 151.2);
    const v = new DataView(f.buffer, f.byteOffset);
    expect(v.getInt32(1, true)).toBe(-33_500_000);
    expect(v.getInt32(5, true)).toBe(151_200_000);
  });

  it('factoryReset carries the "reset" magic', () => {
    expect(new TextDecoder().decode(encode.factoryReset().slice(1))).toBe('reset');
  });
});

describe('config decoders', () => {
  it('CUSTOM_VARS parses name:value pairs', () => {
    const w = new ByteWriter().u8(Resp.CUSTOM_VARS).str('gps:1,name:node7,interval:60');
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'customVars') throw new Error('wrong type');
    expect(d.vars).toEqual({ gps: '1', name: 'node7', interval: '60' });
  });

  it('CUSTOM_VARS handles an empty set', () => {
    const d = decodeFrame(new Uint8Array([Resp.CUSTOM_VARS]));
    if (d.type !== 'customVars') throw new Error('wrong type');
    expect(d.vars).toEqual({});
  });

  it('TUNING_PARAMS divides by 1000', () => {
    const w = new ByteWriter().u8(Resp.TUNING_PARAMS).u32(500).u32(2500);
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'tuningParams') throw new Error('wrong type');
    expect(d.params.rxDelayBase).toBeCloseTo(0.5, 6);
    expect(d.params.airtimeFactor).toBeCloseTo(2.5, 6);
  });

  it('AUTOADD_CONFIG', () => {
    const d = decodeFrame(new Uint8Array([Resp.AUTOADD_CONFIG, 0x07, 4]));
    expect(d).toEqual({ type: 'autoAddConfig', config: { config: 7, maxHops: 4 } });
  });

  it('ALLOWED_REPEAT_FREQ decodes MHz ranges', () => {
    const w = new ByteWriter()
      .u8(Resp.ALLOWED_REPEAT_FREQ)
      .u32(902_000).u32(928_000)
      .u32(868_000).u32(870_000);
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'allowedRepeatFreq') throw new Error('wrong type');
    expect(d.ranges).toEqual([
      { lowerMHz: 902, upperMHz: 928 },
      { lowerMHz: 868, upperMHz: 870 },
    ]);
  });

  it('SIGN_START and SIGNATURE', () => {
    const start = decodeFrame(new ByteWriter().u8(Resp.SIGN_START).u8(0).u32(8192).toBytes());
    expect(start).toEqual({ type: 'signStart', maxLen: 8192 });
    const sig = new Uint8Array(64).fill(7);
    const d = decodeFrame(new ByteWriter().u8(Resp.SIGNATURE).bytes(sig).toBytes());
    if (d.type !== 'signature') throw new Error('wrong type');
    expect(toHex(d.signature)).toBe('07'.repeat(64));
  });
});

// ---- client flow: custom vars + sign session ----

class Fake implements Transport {
  connected = false;
  signedChunks: Uint8Array[] = [];
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
      case Cmd.GET_CUSTOM_VARS:
        this.push(new ByteWriter().u8(Resp.CUSTOM_VARS).str('gps:1,interval:60').toBytes());
        break;
      case Cmd.GET_TUNING_PARAMS:
        this.push(new ByteWriter().u8(Resp.TUNING_PARAMS).u32(500).u32(2500).toBytes());
        break;
      case Cmd.SIGN_START:
        this.signedChunks = [];
        this.push(new ByteWriter().u8(Resp.SIGN_START).u8(0).u32(8192).toBytes());
        break;
      case Cmd.SIGN_DATA:
        this.signedChunks.push(frame.slice(1));
        this.push(new Uint8Array([Resp.OK]));
        break;
      case Cmd.SIGN_FINISH:
        this.push(new ByteWriter().u8(Resp.SIGNATURE).bytes(new Uint8Array(64).fill(9)).toBytes());
        break;
      default:
        this.push(new Uint8Array([Resp.OK]));
    }
  }
}

describe('client config flow', () => {
  let device: Fake;
  let client: MeshCore;
  beforeEach(async () => {
    device = new Fake();
    client = new MeshCore(device);
    await client.connect();
  });

  it('reads custom vars as a map', async () => {
    expect(await client.getCustomVars()).toEqual({ gps: '1', interval: '60' });
  });

  it('reads tuning params', async () => {
    const t = await client.getTuningParams();
    expect(t.rxDelayBase).toBeCloseTo(0.5, 6);
    expect(t.airtimeFactor).toBeCloseTo(2.5, 6);
  });

  it('signData streams chunks and returns the 64-byte signature', async () => {
    const data = new Uint8Array(300).map((_, i) => i & 0xff);
    const sig = await client.signData(data, { chunkSize: 128 });
    expect(sig).toHaveLength(64);
    // 300 bytes / 128 -> 3 chunks, reassembling to the original
    expect(device.signedChunks).toHaveLength(3);
    const joined = new Uint8Array(device.signedChunks.reduce<number[]>((a, c) => [...a, ...c], []));
    expect(toHex(joined)).toBe(toHex(data));
  });
});

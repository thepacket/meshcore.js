import { describe, it, expect } from 'vitest';
import { parseTelemetry, LppType } from '../src/telemetry.js';

/** Minimal big-endian LPP encoder mirroring the firmware LPPWriter. */
class Lpp {
  private bytes: number[] = [];
  private be(value: number, size: number): void {
    // two's complement for negatives
    let v = value;
    if (v < 0) v += 2 ** (size * 8);
    for (let i = size - 1; i >= 0; i--) this.bytes.push((v >> (8 * i)) & 0xff);
  }
  entry(channel: number, type: number): this {
    this.bytes.push(channel, type);
    return this;
  }
  voltage(ch: number, v: number): this {
    return this.entry(ch, LppType.VOLTAGE).tap(() => this.be(Math.round(v * 100), 2));
  }
  temperature(ch: number, c: number): this {
    return this.entry(ch, LppType.TEMPERATURE).tap(() => this.be(Math.round(c * 10), 2));
  }
  humidity(ch: number, pct: number): this {
    return this.entry(ch, LppType.RELATIVE_HUMIDITY).tap(() => this.be(Math.round(pct * 2), 1));
  }
  accel(ch: number, x: number, y: number, z: number): this {
    return this.entry(ch, LppType.ACCELEROMETER).tap(() => {
      this.be(Math.round(x * 1000), 2);
      this.be(Math.round(y * 1000), 2);
      this.be(Math.round(z * 1000), 2);
    });
  }
  gps(ch: number, lat: number, lon: number, alt: number): this {
    return this.entry(ch, LppType.GPS).tap(() => {
      this.be(Math.round(lat * 10000), 3);
      this.be(Math.round(lon * 10000), 3);
      this.be(Math.round(alt * 100), 3);
    });
  }
  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  private tap(fn: () => void): this {
    fn();
    return this;
  }
  build(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

describe('parseTelemetry', () => {
  it('decodes voltage, temperature and humidity', () => {
    const blob = new Lpp().voltage(1, 3.7).temperature(2, 21.5).humidity(3, 55).build();
    const readings = parseTelemetry(blob);
    expect(readings).toHaveLength(3);
    expect(readings[0]).toMatchObject({ channel: 1, typeName: 'voltage', unit: 'V' });
    expect(readings[0]!.value).toBeCloseTo(3.7, 2);
    expect(readings[1]).toMatchObject({ channel: 2, typeName: 'temperature', unit: '°C' });
    expect(readings[1]!.value).toBeCloseTo(21.5, 1);
    expect(readings[2]!.value).toBeCloseTo(55, 1);
  });

  it('decodes negative (signed) temperature', () => {
    const blob = new Lpp().temperature(1, -5.5).build();
    expect(parseTelemetry(blob)[0]!.value).toBeCloseTo(-5.5, 1);
  });

  it('decodes multi-axis accelerometer into components', () => {
    const blob = new Lpp().accel(4, 0.1, -0.2, 1.0).build();
    const r = parseTelemetry(blob)[0]!;
    expect(r.typeName).toBe('accelerometer');
    expect(r.values![0]).toBeCloseTo(0.1, 3);
    expect(r.values![1]).toBeCloseTo(-0.2, 3);
    expect(r.values![2]).toBeCloseTo(1.0, 3);
  });

  it('decodes GPS', () => {
    const blob = new Lpp().gps(5, -33.8688, 151.2093, 10.5).build();
    const r = parseTelemetry(blob)[0]!;
    expect(r.typeName).toBe('gps');
    expect(r.gps!.lat).toBeCloseTo(-33.8688, 4);
    expect(r.gps!.lon).toBeCloseTo(151.2093, 4);
    expect(r.gps!.alt).toBeCloseTo(10.5, 2);
  });

  it('stops at an end-of-data (channel 0) marker', () => {
    const blob = new Lpp().voltage(1, 3.7).raw(0, 116, 0, 0).build();
    expect(parseTelemetry(blob)).toHaveLength(1);
  });

  it('stops cleanly on an unknown type rather than throwing', () => {
    const blob = new Lpp().voltage(1, 3.7).raw(2, 0xfe, 0x00).build();
    const readings = parseTelemetry(blob);
    expect(readings).toHaveLength(1); // voltage parsed, unknown type ends parsing
  });

  it('stops cleanly on a truncated entry', () => {
    const blob = new Lpp().temperature(1, 20).raw(2, LppType.VOLTAGE, 0x01).build(); // missing 1 byte
    expect(parseTelemetry(blob)).toHaveLength(1);
  });

  it('returns [] for empty input', () => {
    expect(parseTelemetry(new Uint8Array(0))).toEqual([]);
  });
});

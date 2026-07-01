import { describe, it, expect } from 'vitest';
import { ByteWriter } from '../src/protocol/writer.js';
import { ByteReader } from '../src/protocol/reader.js';

describe('ByteWriter / ByteReader', () => {
  it('round-trips scalars little-endian', () => {
    const w = new ByteWriter();
    w.u8(0x12).u16(0x3456).u32(0x89abcdef).i32(-1).i8(-2);
    const r = new ByteReader(w.toBytes());
    expect(r.u8()).toBe(0x12);
    expect(r.u16()).toBe(0x3456);
    expect(r.u32()).toBe(0x89abcdef);
    expect(r.i32()).toBe(-1);
    expect(r.i8()).toBe(-2);
    expect(r.remaining).toBe(0);
  });

  it('writes u16/u32 as little-endian bytes', () => {
    const w = new ByteWriter();
    w.u16(0x0102).u32(0x03040506);
    expect([...w.toBytes()]).toEqual([0x02, 0x01, 0x06, 0x05, 0x04, 0x03]);
  });

  it('fixed-width strings are NUL-padded and NUL-trimmed', () => {
    const w = new ByteWriter();
    w.fixedStr('hi', 8);
    const bytes = w.toBytes();
    expect(bytes.length).toBe(8);
    expect([...bytes]).toEqual([104, 105, 0, 0, 0, 0, 0, 0]);
    const r = new ByteReader(bytes);
    expect(r.fixedStr(8)).toBe('hi');
  });

  it('fixedStr truncates leaving room for a NUL terminator', () => {
    const w = new ByteWriter();
    w.fixedStr('abcdef', 4); // firmware strzcpy keeps trailing NUL
    expect([...w.toBytes()]).toEqual([97, 98, 99, 0]);
  });

  it('rest() / restStr() consume the tail', () => {
    const w = new ByteWriter();
    w.u8(1).str('tail-message');
    const r = new ByteReader(w.toBytes());
    expect(r.u8()).toBe(1);
    expect(r.restStr()).toBe('tail-message');
  });

  it('throws on under-read', () => {
    const r = new ByteReader(new Uint8Array([1, 2]));
    r.u8();
    r.u8();
    expect(() => r.u8()).toThrow(RangeError);
  });
});

/**
 * Little-endian byte writer for encoding Companion Radio Protocol frames.
 *
 * Mirror of {@link ByteReader}. Scalars are written little-endian; fixed-width
 * string fields are NUL-padded to match the firmware's `StrHelper::strzcpy`.
 */
export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.offset + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.offset + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.offset++, v);
    return this;
  }

  i8(v: number): this {
    this.ensure(1);
    this.view.setInt8(this.offset++, v);
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
    return this;
  }

  i16(v: number): this {
    this.ensure(2);
    this.view.setInt16(this.offset, v, true);
    this.offset += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
    return this;
  }

  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.offset, v, true);
    this.offset += 4;
    return this;
  }

  bytes(data: Uint8Array): this {
    this.ensure(data.length);
    this.buf.set(data, this.offset);
    this.offset += data.length;
    return this;
  }

  /** Write a UTF-8 string with no length prefix or terminator. */
  str(s: string): this {
    return this.bytes(new TextEncoder().encode(s));
  }

  /**
   * Write a string into a fixed-width `n`-byte field, NUL-padded and truncated
   * to fit (matching firmware `strzcpy`, which always leaves a trailing NUL).
   */
  fixedStr(s: string, n: number): this {
    const enc = new TextEncoder().encode(s);
    const field = new Uint8Array(n); // zero-filled
    field.set(enc.subarray(0, Math.max(0, n - 1)));
    return this.bytes(field);
  }

  /** Snapshot of the bytes written so far. */
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.offset);
  }

  get length(): number {
    return this.offset;
  }
}

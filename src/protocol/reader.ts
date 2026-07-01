/**
 * Little-endian byte reader for decoding Companion Radio Protocol frames.
 *
 * Mirrors the on-wire layout produced by the firmware (`memcpy` of scalars =
 * little-endian; fixed-width strings are null-padded via `StrHelper::strzcpy`).
 */
export class ByteReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Bytes not yet consumed. */
  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  hasMore(): boolean {
    return this.offset < this.bytes.length;
  }

  private ensure(n: number): void {
    if (this.offset + n > this.bytes.length) {
      throw new RangeError(
        `ByteReader: need ${n} bytes at offset ${this.offset}, only ${this.remaining} left`,
      );
    }
  }

  u8(): number {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  i8(): number {
    this.ensure(1);
    return this.view.getInt8(this.offset++);
  }

  u16(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    this.ensure(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  i32(): number {
    this.ensure(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Read `n` raw bytes as a copy. */
  bytes_(n: number): Uint8Array {
    this.ensure(n);
    const out = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  /** Consume all remaining bytes as a copy. */
  rest(): Uint8Array {
    return this.bytes_(this.remaining);
  }

  /**
   * Read a fixed-width field of `n` bytes and decode as a UTF-8 string,
   * trimming at the first NUL (firmware null-pads fixed string fields).
   */
  fixedStr(n: number): string {
    const raw = this.bytes_(n);
    const nul = raw.indexOf(0);
    const end = nul === -1 ? raw.length : nul;
    return new TextDecoder().decode(raw.subarray(0, end));
  }

  /** Decode all remaining bytes as a UTF-8 string (no NUL trimming). */
  restStr(): string {
    return new TextDecoder().decode(this.rest());
  }

  /** Read `n` bytes and format as lowercase hex. */
  hex(n: number): string {
    const raw = this.bytes_(n);
    let s = '';
    for (const b of raw) s += b.toString(16).padStart(2, '0');
    return s;
  }
}

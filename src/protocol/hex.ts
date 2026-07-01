/** Hex <-> bytes helpers (lowercase, no separators). */

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) throw new Error(`fromHex: odd-length string "${hex}"`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`fromHex: invalid hex "${hex}"`);
    out[i] = byte;
  }
  return out;
}

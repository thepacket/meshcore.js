import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto as nodeCrypto } from 'node:crypto';
// Load the actual built WASM artifact (proves the shipped module works).
// @ts-expect-error generated JS module, no types
import factory from '../dist/wasm/meshcore_crypto.mjs';
import { MeshCoreCrypto } from '../src/crypto/crypto.js';

const hex = (s: string): Uint8Array =>
  new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const toHex = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64urlToBytes = (s: string): Uint8Array =>
  new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

let mc: MeshCoreCrypto;
beforeAll(async () => {
  mc = await MeshCoreCrypto.create(factory);
});

describe('SHA-256', () => {
  it('matches the standard "abc" vector', () => {
    expect(toHex(mc.sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('truncates to requested length', () => {
    const full = mc.sha256(new TextEncoder().encode('abc'));
    expect(toHex(mc.sha256(new TextEncoder().encode('abc'), 8))).toBe(
      toHex(full.subarray(0, 8)),
    );
  });

  it('two-fragment == concatenated single', () => {
    const a = new TextEncoder().encode('hello ');
    const b = new TextEncoder().encode('world');
    expect(toHex(mc.sha256Two(a, b))).toBe(
      toHex(mc.sha256(new Uint8Array([...a, ...b]))),
    );
  });
});

describe('AES-128 ECB', () => {
  // FIPS-197 Appendix B / C.1 single-block vector.
  const key = hex('000102030405060708090a0b0c0d0e0f');
  const pt = hex('00112233445566778899aabbccddeeff');
  const ct = hex('69c4e0d86a7b0430d8cdb78070b4c55a');

  it('encrypts the FIPS-197 block', () => {
    expect(toHex(mc.aesEncrypt(key, pt))).toBe(toHex(ct));
  });

  it('decrypts the FIPS-197 block', () => {
    expect(toHex(mc.aesDecrypt(key, ct))).toBe(toHex(pt));
  });

  it('zero-pads a partial final block', () => {
    const out = mc.aesEncrypt(key, hex('0011223344')); // 5 bytes -> 1 block
    expect(out.length).toBe(16);
    // decrypting recovers the zero-padded block
    expect(toHex(mc.aesDecrypt(key, out).subarray(0, 5))).toBe('0011223344');
  });
});

describe('encryptThenMac / macThenDecrypt', () => {
  const secret = mc0secret();
  function mc0secret(): Uint8Array {
    const s = new Uint8Array(32);
    for (let i = 0; i < 32; i++) s[i] = i;
    return s;
  }

  it('round-trips and prefixes a 2-byte MAC', () => {
    const msg = new TextEncoder().encode('the quick brown fox');
    const enc = mc.encryptThenMac(secret, msg);
    expect(enc.length).toBe(2 + 32); // 2-byte MAC + 2 blocks (19 bytes -> 32)
    const dec = mc.macThenDecrypt(secret, enc);
    expect(dec).not.toBeNull();
    expect(toHex(dec!.subarray(0, msg.length))).toBe(toHex(msg));
  });

  it('rejects a tampered MAC', () => {
    const enc = mc.encryptThenMac(secret, new TextEncoder().encode('data'));
    enc[0] ^= 0xff;
    expect(mc.macThenDecrypt(secret, enc)).toBeNull();
  });
});

describe('Ed25519 (cross-checked against WebCrypto)', () => {
  const seed = hex('9d61b19deffebc3a5b48f7f9b9e2fbd1'.repeat(2)); // 32 bytes

  it('derives the same public key and signature as WebCrypto', async () => {
    const kp = mc.createKeypair(seed);

    // Independent oracle: import the seed as a PKCS8 Ed25519 key.
    const pkcs8 = new Uint8Array([
      ...hex('302e020100300506032b657004220420'),
      ...seed,
    ]);
    const priv = await nodeCrypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'Ed25519' },
      true,
      ['sign'],
    );
    const jwk = await nodeCrypto.subtle.exportKey('jwk', priv);
    const oraclePub = b64urlToBytes(jwk.x!);
    expect(toHex(kp.publicKey)).toBe(toHex(oraclePub));

    const msg = new TextEncoder().encode('meshcore attestation');
    const sig = mc.sign(msg, kp.publicKey, kp.privateKey);
    const oracleSig = new Uint8Array(
      await nodeCrypto.subtle.sign({ name: 'Ed25519' }, priv, msg),
    );
    // Ed25519 is deterministic (RFC 8032) -> byte-identical signatures.
    expect(toHex(sig)).toBe(toHex(oracleSig));

    expect(mc.verify(sig, msg, kp.publicKey)).toBe(true);
  });

  it('derivePublicKey matches createKeypair', () => {
    const kp = mc.createKeypair(seed);
    expect(toHex(mc.derivePublicKey(kp.privateKey))).toBe(toHex(kp.publicKey));
  });

  it('rejects a tampered signature', () => {
    const kp = mc.createKeypair(seed);
    const msg = new TextEncoder().encode('x');
    const sig = mc.sign(msg, kp.publicKey, kp.privateKey);
    sig[0] ^= 0x01;
    expect(mc.verify(sig, msg, kp.publicKey)).toBe(false);
  });
});

describe('X25519 key exchange', () => {
  // Known-good test keypair embedded in MeshCore Identity.cpp::validatePrivateKey.
  const testClientPrv = hex(
    '7065e18fd9fabb70c1ed90dca19907de698c88b709ea146eafd93d9b830c7b60' +
      'c4681193c79bbc39945ba8064104bb618f8fd7a84a0af6f57033d6e8ddcd6471',
  );
  const testClientPub = hex(
    '1ec77175b0918ed206f9ae04ec136d6d5d4315bb26305427f645b492e9350c10',
  );

  it('is symmetric and matches the firmware test vector', () => {
    const us = mc.createKeypair(
      hex('1111111111111111111111111111111111111111111111111111111111111111'),
    );
    // ss(theirPub=testClient, ourPrv=us) == ss(theirPub=us, ourPrv=testClient)
    const ssA = mc.keyExchange(testClientPub, us.privateKey);
    const ssB = mc.keyExchange(us.publicKey, testClientPrv);
    expect(toHex(ssA)).toBe(toHex(ssB));
    expect(ssA.some((b) => b !== 0)).toBe(true); // not the all-zero secret
  });
});

/**
 * High-level, allocation-managed wrappers around the crypto WASM module.
 *
 * All methods take/return `Uint8Array`; heap bookkeeping is hidden. Sizes and
 * semantics mirror MeshCore (see wasm/meshcore_crypto.c).
 */
import {
  loadCryptoWasm,
  type CryptoWasm,
  type CryptoWasmFactory,
} from './module.js';

export const PUB_KEY_SIZE = 32;
export const PRV_KEY_SIZE = 64;
export const SIGNATURE_SIZE = 64;
export const SEED_SIZE = 32;
export const SHARED_SECRET_SIZE = 32;
export const CIPHER_KEY_SIZE = 16;
export const CIPHER_BLOCK_SIZE = 16;
export const CIPHER_MAC_SIZE = 2;

export interface KeyPair {
  publicKey: Uint8Array; // 32 bytes
  privateKey: Uint8Array; // 64 bytes
}

/** Ciphertext length for `src_len` plaintext bytes: whole blocks + a final
 * (possibly zero-padded) block, matching Utils::encrypt. */
function encryptedLen(srcLen: number): number {
  return (Math.floor(srcLen / CIPHER_BLOCK_SIZE) + 1) * CIPHER_BLOCK_SIZE;
}

function randomSeed(): Uint8Array {
  const seed = new Uint8Array(SEED_SIZE);
  crypto.getRandomValues(seed);
  return seed;
}

export class MeshCoreCrypto {
  private constructor(private readonly mod: CryptoWasm) {}

  /** Initialise the WASM module and return a ready-to-use crypto instance. */
  static async create(factory?: CryptoWasmFactory): Promise<MeshCoreCrypto> {
    return new MeshCoreCrypto(await loadCryptoWasm(factory));
  }

  // -- heap helpers -------------------------------------------------------

  private alloc(data: Uint8Array): number {
    const ptr = this.mod._malloc(Math.max(1, data.length));
    this.mod.HEAPU8.set(data, ptr);
    return ptr;
  }

  private allocOut(size: number): number {
    return this.mod._malloc(Math.max(1, size));
  }

  private read(ptr: number, len: number): Uint8Array {
    return this.mod.HEAPU8.slice(ptr, ptr + len);
  }

  private run<T>(ptrs: number[], fn: () => T): T {
    try {
      return fn();
    } finally {
      for (const p of ptrs) this.mod._free(p);
    }
  }

  // -- hashing ------------------------------------------------------------

  /** SHA-256 of `data`, truncated to `outLen` (default 32). */
  sha256(data: Uint8Array, outLen = 32): Uint8Array {
    const inPtr = this.alloc(data);
    const outPtr = this.allocOut(outLen);
    return this.run([inPtr, outPtr], () => {
      this.mod._mc_sha256(outPtr, outLen, inPtr, data.length);
      return this.read(outPtr, outLen);
    });
  }

  /** SHA-256 over two concatenated fragments (Utils::sha256 overload). */
  sha256Two(a: Uint8Array, b: Uint8Array, outLen = 32): Uint8Array {
    const aPtr = this.alloc(a);
    const bPtr = this.alloc(b);
    const outPtr = this.allocOut(outLen);
    return this.run([aPtr, bPtr, outPtr], () => {
      this.mod._mc_sha256_2(outPtr, outLen, aPtr, a.length, bPtr, b.length);
      return this.read(outPtr, outLen);
    });
  }

  // -- AES-128 ECB --------------------------------------------------------

  /** AES-128-ECB encrypt with zero-padded final block. `key` = 16 bytes. */
  aesEncrypt(key: Uint8Array, src: Uint8Array): Uint8Array {
    const keyPtr = this.alloc(key);
    const srcPtr = this.alloc(src);
    const outPtr = this.allocOut(encryptedLen(src.length));
    return this.run([keyPtr, srcPtr, outPtr], () => {
      const n = this.mod._mc_aes_encrypt(keyPtr, outPtr, srcPtr, src.length);
      return this.read(outPtr, n);
    });
  }

  /** AES-128-ECB decrypt. `src` length must be a multiple of 16. */
  aesDecrypt(key: Uint8Array, src: Uint8Array): Uint8Array {
    const keyPtr = this.alloc(key);
    const srcPtr = this.alloc(src);
    const outPtr = this.allocOut(Math.max(CIPHER_BLOCK_SIZE, src.length));
    return this.run([keyPtr, srcPtr, outPtr], () => {
      const n = this.mod._mc_aes_decrypt(keyPtr, outPtr, srcPtr, src.length);
      return this.read(outPtr, n);
    });
  }

  /** Encrypt then prefix a 2-byte HMAC (Utils::encryptThenMAC). `secret` = 32 bytes. */
  encryptThenMac(secret: Uint8Array, src: Uint8Array): Uint8Array {
    const secPtr = this.alloc(secret);
    const srcPtr = this.alloc(src);
    const outPtr = this.allocOut(CIPHER_MAC_SIZE + encryptedLen(src.length));
    return this.run([secPtr, srcPtr, outPtr], () => {
      const n = this.mod._mc_encrypt_then_mac(secPtr, outPtr, srcPtr, src.length);
      return this.read(outPtr, n);
    });
  }

  /** Verify the 2-byte MAC and decrypt (Utils::MACThenDecrypt).
   * Returns plaintext, or `null` if the MAC is invalid. */
  macThenDecrypt(secret: Uint8Array, src: Uint8Array): Uint8Array | null {
    const secPtr = this.alloc(secret);
    const srcPtr = this.alloc(src);
    const outPtr = this.allocOut(Math.max(CIPHER_BLOCK_SIZE, src.length));
    return this.run([secPtr, srcPtr, outPtr], () => {
      const n = this.mod._mc_mac_then_decrypt(secPtr, outPtr, srcPtr, src.length);
      return n === 0 ? null : this.read(outPtr, n);
    });
  }

  // -- Ed25519 / X25519 ---------------------------------------------------

  /** Generate a keypair from `seed` (32 bytes); random if omitted. */
  createKeypair(seed: Uint8Array = randomSeed()): KeyPair {
    const seedPtr = this.alloc(seed);
    const pubPtr = this.allocOut(PUB_KEY_SIZE);
    const prvPtr = this.allocOut(PRV_KEY_SIZE);
    return this.run([seedPtr, pubPtr, prvPtr], () => {
      this.mod._mc_ed25519_create_keypair(pubPtr, prvPtr, seedPtr);
      return {
        publicKey: this.read(pubPtr, PUB_KEY_SIZE),
        privateKey: this.read(prvPtr, PRV_KEY_SIZE),
      };
    });
  }

  /** Derive the 32-byte public key from a 64-byte private key. */
  derivePublicKey(privateKey: Uint8Array): Uint8Array {
    const prvPtr = this.alloc(privateKey);
    const pubPtr = this.allocOut(PUB_KEY_SIZE);
    return this.run([prvPtr, pubPtr], () => {
      this.mod._mc_ed25519_derive_pub(pubPtr, prvPtr);
      return this.read(pubPtr, PUB_KEY_SIZE);
    });
  }

  /** Ed25519 sign; returns a 64-byte signature. */
  sign(message: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array {
    const msgPtr = this.alloc(message);
    const pubPtr = this.alloc(publicKey);
    const prvPtr = this.alloc(privateKey);
    const sigPtr = this.allocOut(SIGNATURE_SIZE);
    return this.run([msgPtr, pubPtr, prvPtr, sigPtr], () => {
      this.mod._mc_ed25519_sign(sigPtr, msgPtr, message.length, pubPtr, prvPtr);
      return this.read(sigPtr, SIGNATURE_SIZE);
    });
  }

  /** Ed25519 verify. */
  verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
    const sigPtr = this.alloc(signature);
    const msgPtr = this.alloc(message);
    const pubPtr = this.alloc(publicKey);
    return this.run([sigPtr, msgPtr, pubPtr], () => {
      return this.mod._mc_ed25519_verify(sigPtr, msgPtr, message.length, pubPtr) === 1;
    });
  }

  /** X25519 shared secret (32 bytes) from their public + our private key. */
  keyExchange(theirPublicKey: Uint8Array, ourPrivateKey: Uint8Array): Uint8Array {
    const pubPtr = this.alloc(theirPublicKey);
    const prvPtr = this.alloc(ourPrivateKey);
    const outPtr = this.allocOut(SHARED_SECRET_SIZE);
    return this.run([pubPtr, prvPtr, outPtr], () => {
      this.mod._mc_ed25519_key_exchange(outPtr, pubPtr, prvPtr);
      return this.read(outPtr, SHARED_SECRET_SIZE);
    });
  }
}

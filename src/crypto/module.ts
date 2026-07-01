/**
 * Loader for the Emscripten-built MeshCore crypto module.
 *
 * The generated `dist/wasm/meshcore_crypto.mjs` is an ES6 module factory
 * (MODULARIZE + EXPORT_ES6). We load it lazily and cache the instance.
 */

/** The subset of the Emscripten module surface we use. */
export interface CryptoWasm {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;

  _mc_sha256(out: number, outLen: number, msg: number, msgLen: number): void;
  _mc_sha256_2(
    out: number,
    outLen: number,
    f1: number,
    l1: number,
    f2: number,
    l2: number,
  ): void;
  _mc_aes_encrypt(key: number, dest: number, src: number, srcLen: number): number;
  _mc_aes_decrypt(key: number, dest: number, src: number, srcLen: number): number;
  _mc_encrypt_then_mac(secret: number, dest: number, src: number, srcLen: number): number;
  _mc_mac_then_decrypt(secret: number, dest: number, src: number, srcLen: number): number;
  _mc_ed25519_create_keypair(pub: number, prv: number, seed: number): void;
  _mc_ed25519_derive_pub(pub: number, prv: number): void;
  _mc_ed25519_sign(
    sig: number,
    msg: number,
    msgLen: number,
    pub: number,
    prv: number,
  ): void;
  _mc_ed25519_verify(sig: number, msg: number, msgLen: number, pub: number): number;
  _mc_ed25519_key_exchange(shared: number, pub: number, prv: number): void;
}

export type CryptoWasmFactory = (options?: Record<string, unknown>) => Promise<CryptoWasm>;

let instance: Promise<CryptoWasm> | null = null;

/** Default factory: dynamically import the built module next to this file. */
async function defaultFactory(): Promise<CryptoWasmFactory> {
  const url = new URL('../wasm/meshcore_crypto.mjs', import.meta.url).href;
  const mod = (await import(/* @vite-ignore */ url)) as { default: CryptoWasmFactory };
  return mod.default;
}

/**
 * Initialise (once) and return the crypto WASM instance.
 *
 * @param factory Optional Emscripten factory override (used by tests to point
 *   at an explicit build artifact).
 */
export function loadCryptoWasm(factory?: CryptoWasmFactory): Promise<CryptoWasm> {
  if (!instance) {
    instance = (factory ? Promise.resolve(factory) : defaultFactory()).then((f) => f());
  }
  return instance;
}

/** Reset the cached instance (test helper). */
export function _resetCryptoWasm(): void {
  instance = null;
}

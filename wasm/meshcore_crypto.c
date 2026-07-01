/*
 * meshcore_crypto.c — flat C ABI exposing MeshCore's crypto primitives to JS.
 *
 * Semantics mirror MeshCore/src/Utils.cpp and Identity.cpp exactly:
 *   - Ed25519 keygen/sign/verify + X25519 key exchange use orlp's ed25519
 *     (the same source bundled in the firmware; see vendor/ed25519).
 *   - AES-128 in ECB block mode, final block zero-padded (Utils::encrypt).
 *   - encryptThenMAC: AES-ECB ciphertext prefixed with a 2-byte truncated
 *     HMAC-SHA256, keyed with the full 32-byte shared secret.
 *   - SHA-256 truncated to caller-requested length.
 *
 * AES-128 / SHA-256 / HMAC are standardized (FIPS-197/180, RFC 2104), so any
 * correct implementation is byte-identical to the firmware's rweather Crypto
 * lib; parity is asserted against official vectors in test/crypto.test.ts.
 * Ed25519 verify uses orlp's verify rather than the firmware's rweather
 * Ed25519::verify — RFC 8032 verification is deterministic, so accept/reject
 * results are identical.
 */
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <emscripten.h>

#include "ed_25519.h"
#include "aes.h"
#include "sha256.h"

/* MeshCore constants (MeshCore/src/MeshCore.h) */
#define MC_CIPHER_KEY_SIZE 16
#define MC_CIPHER_MAC_SIZE 2
#define MC_PUB_KEY_SIZE    32

/* ---------------------------------------------------------------- SHA-256 */

EMSCRIPTEN_KEEPALIVE
void mc_sha256(uint8_t *out, size_t out_len, const uint8_t *msg, size_t msg_len) {
  SHA256_CTX ctx;
  uint8_t full[32];
  sha256_init(&ctx);
  sha256_update(&ctx, msg, msg_len);
  sha256_final(&ctx, full);
  if (out_len > 32) out_len = 32;
  memcpy(out, full, out_len);
}

/* Two-fragment variant, matching the Utils::sha256(frag1, frag2) overload. */
EMSCRIPTEN_KEEPALIVE
void mc_sha256_2(uint8_t *out, size_t out_len,
                 const uint8_t *f1, size_t l1,
                 const uint8_t *f2, size_t l2) {
  SHA256_CTX ctx;
  uint8_t full[32];
  sha256_init(&ctx);
  sha256_update(&ctx, f1, l1);
  sha256_update(&ctx, f2, l2);
  sha256_final(&ctx, full);
  if (out_len > 32) out_len = 32;
  memcpy(out, full, out_len);
}

/* Standard HMAC-SHA256 (block size 64), truncated to out_len bytes. */
static void hmac_sha256(uint8_t *out, size_t out_len,
                        const uint8_t *key, size_t key_len,
                        const uint8_t *msg, size_t msg_len) {
  uint8_t k[64];
  uint8_t ipad[64], opad[64];
  uint8_t inner[32], full[32];
  SHA256_CTX ctx;
  size_t i;

  memset(k, 0, sizeof(k));
  if (key_len > 64) {
    sha256_init(&ctx);
    sha256_update(&ctx, key, key_len);
    sha256_final(&ctx, k); /* 32 bytes, rest stays zero */
  } else {
    memcpy(k, key, key_len);
  }
  for (i = 0; i < 64; i++) {
    ipad[i] = (uint8_t)(k[i] ^ 0x36);
    opad[i] = (uint8_t)(k[i] ^ 0x5c);
  }
  sha256_init(&ctx);
  sha256_update(&ctx, ipad, 64);
  sha256_update(&ctx, msg, msg_len);
  sha256_final(&ctx, inner);

  sha256_init(&ctx);
  sha256_update(&ctx, opad, 64);
  sha256_update(&ctx, inner, 32);
  sha256_final(&ctx, full);

  if (out_len > 32) out_len = 32;
  memcpy(out, full, out_len);
}

/* -------------------------------------------------------------- AES-128 ECB */

/* Mirrors Utils::encrypt: full blocks, then a zero-padded final partial block.
 * Returns bytes written to dest (always a multiple of 16). */
EMSCRIPTEN_KEEPALIVE
int mc_aes_encrypt(const uint8_t *key, uint8_t *dest, const uint8_t *src, int src_len) {
  struct AES_ctx ctx;
  uint8_t *dp = dest;
  int written = 0;
  AES_init_ctx(&ctx, key); /* AES_KEYLEN == 16 */
  while (src_len >= 16) {
    memcpy(dp, src, 16);
    AES_ECB_encrypt(&ctx, dp);
    dp += 16; src += 16; src_len -= 16; written += 16;
  }
  if (src_len > 0) {
    uint8_t tmp[16];
    memset(tmp, 0, 16);
    memcpy(tmp, src, (size_t)src_len);
    memcpy(dp, tmp, 16);
    AES_ECB_encrypt(&ctx, dp);
    written += 16;
  }
  return written;
}

/* Mirrors Utils::decrypt: src_len must be a multiple of 16. */
EMSCRIPTEN_KEEPALIVE
int mc_aes_decrypt(const uint8_t *key, uint8_t *dest, const uint8_t *src, int src_len) {
  struct AES_ctx ctx;
  uint8_t *dp = dest;
  const uint8_t *sp = src;
  AES_init_ctx(&ctx, key);
  while (sp - src < src_len) {
    memcpy(dp, sp, 16);
    AES_ECB_decrypt(&ctx, dp);
    dp += 16; sp += 16;
  }
  return (int)(sp - src);
}

/* dest layout: [2-byte HMAC][ciphertext]. Returns total dest length. */
EMSCRIPTEN_KEEPALIVE
int mc_encrypt_then_mac(const uint8_t *shared_secret, uint8_t *dest,
                        const uint8_t *src, int src_len) {
  int enc_len = mc_aes_encrypt(shared_secret, dest + MC_CIPHER_MAC_SIZE, src, src_len);
  hmac_sha256(dest, MC_CIPHER_MAC_SIZE, shared_secret, MC_PUB_KEY_SIZE,
              dest + MC_CIPHER_MAC_SIZE, (size_t)enc_len);
  return MC_CIPHER_MAC_SIZE + enc_len;
}

/* Verifies the 2-byte MAC then decrypts. Returns plaintext length, or 0 on
 * MAC failure / invalid input. */
EMSCRIPTEN_KEEPALIVE
int mc_mac_then_decrypt(const uint8_t *shared_secret, uint8_t *dest,
                        const uint8_t *src, int src_len) {
  uint8_t mac[MC_CIPHER_MAC_SIZE];
  if (src_len <= MC_CIPHER_MAC_SIZE) return 0;
  hmac_sha256(mac, MC_CIPHER_MAC_SIZE, shared_secret, MC_PUB_KEY_SIZE,
              src + MC_CIPHER_MAC_SIZE, (size_t)(src_len - MC_CIPHER_MAC_SIZE));
  if (memcmp(mac, src, MC_CIPHER_MAC_SIZE) != 0) return 0;
  return mc_aes_decrypt(shared_secret, dest, src + MC_CIPHER_MAC_SIZE,
                        src_len - MC_CIPHER_MAC_SIZE);
}

/* --------------------------------------------------------------- Ed25519 */

/* seed is 32 bytes; produces 32-byte pub + 64-byte prv. */
EMSCRIPTEN_KEEPALIVE
void mc_ed25519_create_keypair(uint8_t *pub, uint8_t *prv, const uint8_t *seed) {
  ed25519_create_keypair(pub, prv, seed);
}

EMSCRIPTEN_KEEPALIVE
void mc_ed25519_derive_pub(uint8_t *pub, const uint8_t *prv) {
  ed25519_derive_pub(pub, prv);
}

/* sig: 64 bytes out. */
EMSCRIPTEN_KEEPALIVE
void mc_ed25519_sign(uint8_t *sig, const uint8_t *msg, size_t msg_len,
                     const uint8_t *pub, const uint8_t *prv) {
  ed25519_sign(sig, msg, msg_len, pub, prv);
}

/* Returns 1 if valid, 0 otherwise. */
EMSCRIPTEN_KEEPALIVE
int mc_ed25519_verify(const uint8_t *sig, const uint8_t *msg, size_t msg_len,
                      const uint8_t *pub) {
  return ed25519_verify(sig, msg, msg_len, pub);
}

/* X25519 shared secret (32 bytes) from our prv + their pub, matching
 * LocalIdentity::calcSharedSecret. */
EMSCRIPTEN_KEEPALIVE
void mc_ed25519_key_exchange(uint8_t *shared, const uint8_t *pub, const uint8_t *prv) {
  ed25519_key_exchange(shared, pub, prv);
}

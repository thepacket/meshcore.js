#!/usr/bin/env bash
#
# Build the MeshCore crypto WASM module with Emscripten.
#
# Requires the emsdk environment to be active:
#   source ./emsdk/emsdk_env.sh
# The generated artifacts (dist/wasm/meshcore_crypto.{mjs,wasm}) are committed
# so consumers of the package do not need a C toolchain.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/dist/wasm"
mkdir -p "$OUT_DIR"

# Exported C functions (leading underscore is the emscripten convention).
EXPORTS='["_malloc","_free",'\
'"_mc_sha256","_mc_sha256_2",'\
'"_mc_aes_encrypt","_mc_aes_decrypt",'\
'"_mc_encrypt_then_mac","_mc_mac_then_decrypt",'\
'"_mc_ed25519_create_keypair","_mc_ed25519_derive_pub",'\
'"_mc_ed25519_sign","_mc_ed25519_verify","_mc_ed25519_key_exchange"]'

emcc \
  -O3 \
  -DED25519_NO_SEED=1 \
  -I "$ROOT/vendor/ed25519" \
  -I "$ROOT/vendor/aes" \
  -I "$ROOT/vendor/sha256" \
  "$ROOT/wasm/meshcore_crypto.c" \
  "$ROOT/vendor/ed25519/"*.c \
  "$ROOT/vendor/aes/aes.c" \
  "$ROOT/vendor/sha256/sha256.c" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,node \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORT_NAME=createMeshCoreCrypto \
  -s EXPORTED_FUNCTIONS="$EXPORTS" \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8","getValue","setValue"]' \
  -o "$OUT_DIR/meshcore_crypto.mjs"

echo "Built: $OUT_DIR/meshcore_crypto.mjs (+ .wasm)"

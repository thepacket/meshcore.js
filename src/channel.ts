/**
 * Group-channel helpers.
 *
 * A MeshCore group channel is a name plus a 16-byte shared secret. Secrets are
 * commonly exchanged as a base64 "PSK" (e.g. the built-in public channel).
 */
import { PUBLIC_GROUP_PSK, CHANNEL_SECRET_SIZE } from './protocol/constants.js';

// `atob`/`btoa` are available in all supported browsers and Node >= 16.
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decode a base64 PSK into a 16-byte channel secret. */
export function channelSecretFromPsk(psk: string): Uint8Array {
  const bytes = base64ToBytes(psk);
  if (bytes.length !== CHANNEL_SECRET_SIZE) {
    throw new Error(
      `channel secret must be ${CHANNEL_SECRET_SIZE} bytes, got ${bytes.length}`,
    );
  }
  return bytes;
}

/** Encode a 16-byte channel secret as a base64 PSK. */
export function pskFromChannelSecret(secret: Uint8Array): string {
  if (secret.length !== CHANNEL_SECRET_SIZE) {
    throw new Error(`channel secret must be ${CHANNEL_SECRET_SIZE} bytes`);
  }
  return bytesToBase64(secret);
}

/** The built-in "public" group channel (index 0 on stock firmware). */
export const PUBLIC_CHANNEL = {
  name: 'public',
  psk: PUBLIC_GROUP_PSK,
  get secret(): Uint8Array {
    return channelSecretFromPsk(PUBLIC_GROUP_PSK);
  },
} as const;

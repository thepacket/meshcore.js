# meshcore.js

A browser client for [MeshCore](https://github.com/meshcore-dev/MeshCore) companion
devices. It speaks the **Companion Radio Protocol** over **Web Bluetooth**, with the
security-critical crypto compiled to **WebAssembly from MeshCore's own C sources** so it is
byte-for-byte compatible with the firmware.

- **TypeScript** for the transport, frame codec, and high-level API.
- **WASM (Emscripten)** for Ed25519 sign/verify, X25519 key exchange, AES-128 and
  SHA-256 / HMAC-SHA256 — the exact primitives the firmware uses.

> Status: MVP. Handshake, contacts, direct + channel messaging, message sync, device
> time, and self-advertising are implemented. See [Protocol coverage](#protocol-coverage).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  MeshCore (client.ts)      high-level API + typed events  │
├─────────────────────────────────────────────────────────┤
│  Connection (connection.ts)  request/response + push router│
├───────────────────────────┬─────────────────────────────┤
│  protocol/  (pure TS)      │  crypto/  → WASM              │
│   encode · decode          │   MeshCoreCrypto              │
│   constants · reader/writer│   (ed25519 + aes + sha256)    │
├───────────────────────────┴─────────────────────────────┤
│  Transport (interface)                                    │
│   WebBluetoothTransport  (Nordic UART Service)            │
└─────────────────────────────────────────────────────────┘
```

Why this split? The Companion Radio Protocol is the app↔device boundary; the device
firmware does all mesh encryption. The frame codec is plain little-endian struct packing,
so it lives in TypeScript. Only the crypto primitives benefit from reusing the audited
upstream C — those are compiled to WASM.

## Install & build

```bash
npm install
npm run build         # compile TypeScript -> dist/
npm test              # run the test suite
```

The prebuilt WASM (`dist/wasm/meshcore_crypto.{mjs,wasm}`) is committed, so consumers do
**not** need a C toolchain.

### Rebuilding the WASM (maintainers only)

Requires the [Emscripten SDK](https://emscripten.org/):

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh && cd ..
npm run build:wasm
```

## Usage

```ts
import { MeshCore, WebBluetoothTransport } from 'meshcore.js';

const transport = new WebBluetoothTransport({ namePrefix: 'MeshCore' });
const client = new MeshCore(transport);

client.on('message', (m) => console.log('message:', m.text));
client.on('advert', (pubKey) => console.log('heard advert from', pubKey));
client.on('sendConfirmed', (c) => console.log('delivered, rtt', c.roundTripMillis, 'ms'));

const { deviceInfo, selfInfo } = await client.connect();
console.log(`connected to ${selfInfo.name} (${deviceInfo.firmwareVersion})`);

const contacts = await client.getContacts();
await client.sendTextMessage(contacts[0].publicKey, 'hello from the browser');
```

### Using the crypto directly

```ts
import { MeshCoreCrypto } from 'meshcore.js';

const crypto = await MeshCoreCrypto.create();
const kp = crypto.createKeypair();                       // Ed25519 keypair
const sig = crypto.sign(msg, kp.publicKey, kp.privateKey);
crypto.verify(sig, msg, kp.publicKey);                   // -> true
const secret = crypto.keyExchange(theirPub, kp.privateKey); // X25519
```

## Running the demo

Web Bluetooth requires `https` or `localhost`. Build first, then serve the repo root:

```bash
npm run build
npx serve .    # or: python3 -m http.server
# open http://localhost:3000/examples/web-ble-demo/  (port may vary)
```

Click **Connect** and pick your MeshCore device.

## Protocol coverage

Implemented commands:

- **Handshake:** `DEVICE_QUERY`, `APP_START`
- **Messaging:** `SEND_TXT_MSG`, `SEND_CHANNEL_TXT_MSG`, `SYNC_NEXT_MESSAGE`
- **Contacts:** `GET_CONTACTS`, `GET_CONTACT_BY_KEY`, `ADD_UPDATE_CONTACT`, `REMOVE_CONTACT`,
  `RESET_PATH`, `SHARE_CONTACT`
- **Channels:** `GET_CHANNEL`, `SET_CHANNEL` (+ base64 PSK helpers, `PUBLIC_CHANNEL`)
- **Device/radio:** `GET_DEVICE_TIME`, `SET_DEVICE_TIME`, `SEND_SELF_ADVERT`, `SET_ADVERT_NAME`,
  `GET_BATT_AND_STORAGE`, `SET_RADIO_PARAMS`, `SET_RADIO_TX_POWER`, `REBOOT`

Handled pushes: `ADVERT`, `NEW_ADVERT`, `PATH_UPDATED`, `SEND_CONFIRMED`, `MSG_WAITING`
(auto-drains the offline queue), `CONTACT_DELETED`, `CONTACTS_FULL`.

Not yet modelled frames decode to `{ type: 'raw', code, payload }` rather than failing, so
newer firmware won't break the client. Telemetry, login/repeater, traces, raw/binary/control
data, and Node transports are planned.

## Crypto fidelity

- **Ed25519 keygen/sign & X25519 key exchange** use MeshCore's bundled
  [orlp/ed25519](https://github.com/orlp/ed25519) sources verbatim (`vendor/ed25519`).
- **AES-128 (ECB, zero-padded final block)** and **SHA-256 / HMAC-SHA256** are standardized
  (FIPS-197 / FIPS-180 / RFC 2104); the compact vendored implementations
  ([tiny-AES-c](https://github.com/kokke/tiny-AES-c),
  [B-Con/crypto-algorithms](https://github.com/B-Con/crypto-algorithms)) are asserted
  byte-identical to the firmware's rweather Crypto lib against official test vectors.
- **Ed25519 verify** uses orlp's `ed25519_verify` rather than the firmware's rweather
  `Ed25519::verify`; RFC 8032 verification is deterministic, so accept/reject is identical.
- The composed `encryptThenMAC` / `MACThenDecrypt` layout mirrors
  [`MeshCore/src/Utils.cpp`](https://github.com/meshcore-dev/MeshCore/blob/main/src/Utils.cpp)
  exactly (2-byte truncated HMAC keyed with the 32-byte shared secret).

The crypto test suite cross-checks the WASM module against the FIPS/RFC vectors, Node's
independent WebCrypto Ed25519, and MeshCore's own embedded X25519 test keypair.

## Known limitations

- **BLE fragmentation:** each notification is treated as one whole frame (per the protocol
  spec). If a device is found to split large frames across notifications, a reassembly layer
  will be added to `WebBluetoothTransport`.
- Web Bluetooth is Chromium-only (Chrome/Edge/Opera); Firefox/Safari do not support it.

## Contributing

This project **does not accept pull requests** — fork it instead (that's what MIT is for).
Issues are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE). Vendored third-party crypto retains its original licenses
(see `vendor/*`).

// Public API surface for meshcore.js.

export { MeshCore, MeshCoreError } from './client.js';
export type { MeshCoreEvents, MeshCoreOptions } from './client.js';

export { Connection } from './connection.js';
export { Emitter } from './emitter.js';

export type { Transport } from './transport/transport.js';
export {
  WebBluetoothTransport,
  NUS_SERVICE,
  NUS_RX_CHARACTERISTIC,
  NUS_TX_CHARACTERISTIC,
  type WebBluetoothOptions,
} from './transport/web-bluetooth.js';

export * from './protocol/index.js';

export {
  MeshCoreCrypto,
  loadCryptoWasm,
  type CryptoWasm,
  type CryptoWasmFactory,
  type KeyPair,
} from './crypto/index.js';

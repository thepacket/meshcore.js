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
export {
  NodeSerialTransport,
  type NodeSerialOptions,
  type SerialPortLike,
} from './transport/node-serial.js';
export {
  UsbFrameParser,
  encodeUsbFrame,
  FRAME_TO_DEVICE,
  FRAME_FROM_DEVICE,
  MAX_USB_FRAME_SIZE,
} from './transport/usb-framing.js';

export * from './protocol/index.js';

export {
  channelSecretFromPsk,
  pskFromChannelSecret,
  PUBLIC_CHANNEL,
} from './channel.js';

export {
  parseTelemetry,
  LppType,
  type TelemetryReading,
  type GpsReading,
} from './telemetry.js';

export {
  parseRepeaterStatus,
  parseRoomServerStatus,
  parseNodeStatus,
  type NodeStatus,
  type NodeStatusCommon,
  type RepeaterStatus,
  type RoomServerStatus,
} from './status.js';

export {
  MeshCoreCrypto,
  loadCryptoWasm,
  type CryptoWasm,
  type CryptoWasmFactory,
  type KeyPair,
} from './crypto/index.js';

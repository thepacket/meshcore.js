/**
 * Decoded shapes for Companion Radio Protocol frames. Public keys and paths are
 * exposed as lowercase hex strings for ergonomics; raw byte access is available
 * on the frames that carry binary payloads.
 */

/** RESP.DEVICE_INFO — reply to CMD.DEVICE_QUERY. */
export interface DeviceInfo {
  firmwareVerCode: number;
  maxContacts: number; // firmware reports MAX_CONTACTS/2; expanded back to full count
  maxChannels: number;
  blePin: number;
  firmwareBuildDate: string;
  manufacturer: string;
  firmwareVersion: string;
  /** v9+; 0 if not reported. */
  clientRepeat: number;
  /** v10+; 0 if not reported. */
  pathHashMode: number;
}

/** RESP.SELF_INFO — reply to CMD.APP_START. */
export interface SelfInfo {
  advType: number;
  txPower: number;
  maxTxPower: number;
  publicKey: string; // hex, 32 bytes
  lat: number; // degrees
  lon: number; // degrees
  multiAcks: number;
  advertLocPolicy: number;
  telemetryModeBase: number;
  telemetryModeLoc: number;
  telemetryModeEnv: number;
  manualAddContacts: number;
  freq: number; // MHz
  bandwidth: number; // kHz
  spreadingFactor: number;
  codingRate: number;
  name: string;
}

/** RESP.CONTACT — one entry in the contacts stream. */
export interface Contact {
  publicKey: string; // hex, 32 bytes
  type: number;
  flags: number;
  outPathLen: number;
  outPath: string; // hex of the used path bytes (outPathLen, or '' when unknown)
  name: string;
  lastAdvertTimestamp: number; // epoch seconds
  gpsLat: number; // degrees
  gpsLon: number; // degrees
  lastMod: number; // epoch seconds
}

/** RESP.SENT — reply to CMD.SEND_TXT_MSG. */
export interface SendResult {
  flood: boolean;
  /** 4-byte ACK tag (0 if none expected); match against SendConfirmed.ackTag. */
  expectedAck: number;
  /** Estimated round-trip timeout in ms. */
  estTimeout: number;
}

/** A queued inbound message (RESP.CONTACT_MSG_RECV[_V3] / CHANNEL_MSG_RECV[_V3]). */
export interface InboundMessage {
  kind: 'contact' | 'channel';
  /** SNR in dB (V3 frames only; undefined otherwise). */
  snr?: number;
  /** Contact messages: 6-byte sender pubkey prefix (hex). */
  senderPrefix?: string;
  /** Channel messages: channel index. */
  channelIdx?: number;
  /** Flood path length, or 0xFF when received via a direct route. */
  pathLen: number;
  txtType: number;
  senderTimestamp: number; // epoch seconds
  /** For signed contact messages: extra 4-byte sender prefix (hex). */
  signedSenderPrefix?: string;
  text: string;
}

/** PUSH.SEND_CONFIRMED — an ACK for a previously sent message. */
export interface SendConfirmed {
  ackTag: number;
  roundTripMillis: number;
}

/** RESP.CURR_TIME — device clock. */
export interface CurrentTime {
  epochSeconds: number;
}

/** RESP.CHANNEL_INFO — reply to CMD.GET_CHANNEL. */
export interface Channel {
  index: number;
  name: string;
  /** 16-byte shared secret as hex. */
  secret: string;
}

/** RESP.BATT_AND_STORAGE — reply to CMD.GET_BATT_AND_STORAGE. */
export interface BatteryAndStorage {
  batteryMillivolts: number;
  storageUsedKb: number;
  storageTotalKb: number;
}

/** PUSH.LOGIN_SUCCESS — a repeater/room-server login was accepted. */
export interface LoginResult {
  /** 6-byte public-key prefix of the server (hex). */
  pubKeyPrefix: string;
  /** Server-assigned permissions byte (e.g. admin bit). */
  permissions: number;
  /** New-protocol logins only: server timestamp. */
  serverTimestamp?: number;
  /** v7+ ACL permissions byte. */
  aclPermissions?: number;
  /** Server firmware version level. */
  firmwareVerLevel?: number;
}

/** PUSH.STATUS_RESPONSE / TELEMETRY_RESPONSE — payload is a raw device blob. */
export interface NodeResponse {
  /** 6-byte public-key prefix of the responder (hex). */
  pubKeyPrefix: string;
  /** Raw response payload (status or telemetry blob; parse per your app). */
  data: Uint8Array;
}

/** PUSH.BINARY_RESPONSE — reply to a binary request, matched by tag. */
export interface BinaryResponse {
  tag: number;
  data: Uint8Array;
}

/** PUSH.RAW_DATA — an inbound custom/raw packet with radio metadata. */
export interface RawData {
  /** SNR in dB. */
  snr: number;
  /** RSSI in dBm. */
  rssi: number;
  payload: Uint8Array;
}

/** PUSH.CONTROL_DATA — an inbound control packet. */
export interface ControlData {
  snr: number;
  rssi: number;
  pathLen: number;
  payload: Uint8Array;
}

/** PUSH.LOG_RX_DATA — a raw over-the-air packet the device overheard. */
export interface RxLogData {
  snr: number;
  rssi: number;
  /** The raw received packet bytes. */
  raw: Uint8Array;
}

/** One hop in a completed path trace. */
export interface TraceHop {
  /** Node hash for this hop (hex; 1+ bytes depending on flags). */
  hash: string;
  /** SNR in dB reported at this hop. */
  snr: number;
}

/** PUSH.TRACE_DATA — a completed path trace with per-hop SNR. */
export interface TraceResult {
  tag: number;
  authCode: number;
  flags: number;
  hops: TraceHop[];
  /** SNR (dB) of the final packet arriving back at this device. */
  finalSnr: number;
}

/** RESP.TUNING_PARAMS — airtime/rx tuning. */
export interface TuningParams {
  /** Base RX delay in seconds. */
  rxDelayBase: number;
  /** Airtime budget factor. */
  airtimeFactor: number;
}

/** RESP.AUTOADD_CONFIG — automatic contact-adding config. */
export interface AutoAddConfig {
  /** Bitmask (see AUTO_ADD_* in the firmware). */
  config: number;
  /** Max hops for auto-added contacts. */
  maxHops: number;
}

/** A frequency range (MHz) in which repeat mode is permitted. */
export interface FreqRange {
  lowerMHz: number;
  upperMHz: number;
}

/** RESP.STATS — device counters, discriminated by sub-type. */
export type Stats =
  | {
      kind: 'core';
      batteryMillivolts: number;
      uptimeSeconds: number;
      errFlags: number;
      queueLength: number;
    }
  | {
      kind: 'radio';
      noiseFloor: number;
      lastRssi: number;
      lastSnr: number; // dB
      txAirtimeSeconds: number;
      rxAirtimeSeconds: number;
    }
  | {
      kind: 'packets';
      received: number;
      sent: number;
      sentFlood: number;
      sentDirect: number;
      recvFlood: number;
      recvDirect: number;
      recvErrors: number;
    };

/** A generic error reply (RESP.ERR). */
export interface ErrorResult {
  code: number;
  name: string;
}

/** Union tag for a decoded inbound frame. */
export type DecodedFrame =
  | { type: 'ok' }
  | { type: 'error'; error: ErrorResult }
  | { type: 'disabled' }
  | { type: 'noMoreMessages' }
  | { type: 'deviceInfo'; info: DeviceInfo }
  | { type: 'selfInfo'; info: SelfInfo }
  | { type: 'contactsStart'; count: number }
  | { type: 'contact'; contact: Contact }
  | { type: 'endOfContacts'; mostRecentLastMod: number }
  | { type: 'sent'; result: SendResult }
  | { type: 'currentTime'; time: CurrentTime }
  | { type: 'channelInfo'; channel: Channel }
  | { type: 'batteryAndStorage'; info: BatteryAndStorage }
  | { type: 'customVars'; vars: Record<string, string> }
  | { type: 'tuningParams'; params: TuningParams }
  | { type: 'autoAddConfig'; config: AutoAddConfig }
  | { type: 'allowedRepeatFreq'; ranges: FreqRange[] }
  | { type: 'signStart'; maxLen: number }
  | { type: 'signature'; signature: Uint8Array }
  | { type: 'stats'; stats: Stats }
  | { type: 'message'; message: InboundMessage }
  // pushes
  | { type: 'advert'; publicKey: string }
  | { type: 'newAdvert'; contact: Contact }
  | { type: 'pathUpdated'; publicKey: string }
  | { type: 'sendConfirmed'; confirmed: SendConfirmed }
  | { type: 'loginSuccess'; result: LoginResult }
  | { type: 'loginFail'; pubKeyPrefix: string }
  | { type: 'statusResponse'; response: NodeResponse }
  | { type: 'telemetryResponse'; response: NodeResponse }
  | { type: 'binaryResponse'; response: BinaryResponse }
  | { type: 'traceData'; trace: TraceResult }
  | { type: 'rawData'; data: RawData }
  | { type: 'controlData'; data: ControlData }
  | { type: 'rxLog'; data: RxLogData }
  | { type: 'messageWaiting' }
  | { type: 'contactDeleted'; publicKey: string }
  | { type: 'contactsFull' }
  // fallback for codes not yet modelled
  | { type: 'raw'; code: number; payload: Uint8Array };

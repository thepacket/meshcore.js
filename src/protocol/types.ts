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
  | { type: 'message'; message: InboundMessage }
  // pushes
  | { type: 'advert'; publicKey: string }
  | { type: 'newAdvert'; contact: Contact }
  | { type: 'pathUpdated'; publicKey: string }
  | { type: 'sendConfirmed'; confirmed: SendConfirmed }
  | { type: 'messageWaiting' }
  | { type: 'contactDeleted'; publicKey: string }
  | { type: 'contactsFull' }
  // fallback for codes not yet modelled
  | { type: 'raw'; code: number; payload: Uint8Array };

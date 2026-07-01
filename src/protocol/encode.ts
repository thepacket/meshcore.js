/**
 * Encoders for app -> device command frames (MVP command set).
 *
 * Layouts mirror the parsers in MeshCore `MyMesh.cpp::handleCmdFrame`.
 */
import { ByteWriter } from './writer.js';
import {
  Cmd,
  TxtType,
  PUBKEY_PREFIX_SIZE,
  PUB_KEY_SIZE,
  MAX_PATH_SIZE,
  CHANNEL_NAME_SIZE,
  CHANNEL_SECRET_SIZE,
  CONTACT_NAME_SIZE,
  OUT_PATH_UNKNOWN,
} from './constants.js';
import { fromHex } from './hex.js';
import type { Contact } from './types.js';

function asBytes(v: string | Uint8Array): Uint8Array {
  return typeof v === 'string' ? fromHex(v) : v;
}

/** First 6 bytes of a public key (hex or bytes) as used in message frames. */
function pubKeyPrefix(key: string | Uint8Array): Uint8Array {
  const bytes = asBytes(key);
  if (bytes.length < PUBKEY_PREFIX_SIZE) {
    throw new Error(`public key prefix needs >= ${PUBKEY_PREFIX_SIZE} bytes`);
  }
  return bytes.subarray(0, PUBKEY_PREFIX_SIZE);
}

/** Exactly `size` bytes from hex/bytes, zero-padded or truncated. */
function fixedBytes(v: string | Uint8Array, size: number): Uint8Array {
  const src = asBytes(v);
  const out = new Uint8Array(size);
  out.set(src.subarray(0, size));
  return out;
}

/** Full 32-byte public key (hex or bytes). */
function fullPubKey(key: string | Uint8Array): Uint8Array {
  const bytes = asBytes(key);
  if (bytes.length < PUB_KEY_SIZE) {
    throw new Error(`public key needs ${PUB_KEY_SIZE} bytes`);
  }
  return bytes.subarray(0, PUB_KEY_SIZE);
}

/** CMD.DEVICE_QUERY — sent first; `appVer` is the protocol version the app speaks. */
export function deviceQuery(appVer = 3): Uint8Array {
  return new ByteWriter().u8(Cmd.DEVICE_QUERY).u8(appVer).toBytes();
}

/** CMD.APP_START — handshake. Firmware reads the app name from byte 8 onward. */
export function appStart(appName = 'meshcore.js', appVer = 3): Uint8Array {
  return new ByteWriter()
    .u8(Cmd.APP_START)
    .u8(appVer) // reserved[0]; other clients place their version here
    .bytes(new Uint8Array(6)) // reserved[1..6]
    .str(appName)
    .toBytes();
}

/** CMD.GET_CONTACTS — optional `since` (epoch seconds) for incremental sync. */
export function getContacts(since?: number): Uint8Array {
  const w = new ByteWriter().u8(Cmd.GET_CONTACTS);
  if (since !== undefined) w.u32(since);
  return w.toBytes();
}

/** CMD.GET_DEVICE_TIME. */
export function getDeviceTime(): Uint8Array {
  return new ByteWriter().u8(Cmd.GET_DEVICE_TIME).toBytes();
}

/** CMD.SET_DEVICE_TIME. */
export function setDeviceTime(epochSeconds: number): Uint8Array {
  return new ByteWriter().u8(Cmd.SET_DEVICE_TIME).u32(epochSeconds).toBytes();
}

/** CMD.SEND_SELF_ADVERT — `flood` true = network-wide, false = zero-hop. */
export function sendSelfAdvert(flood = false): Uint8Array {
  return new ByteWriter().u8(Cmd.SEND_SELF_ADVERT).u8(flood ? 1 : 0).toBytes();
}

/** CMD.SET_ADVERT_NAME. */
export function setAdvertName(name: string): Uint8Array {
  return new ByteWriter().u8(Cmd.SET_ADVERT_NAME).str(name).toBytes();
}

/** CMD.SYNC_NEXT_MESSAGE — pull the next queued inbound message. */
export function syncNextMessage(): Uint8Array {
  return new ByteWriter().u8(Cmd.SYNC_NEXT_MESSAGE).toBytes();
}

export interface SendTxtMsgParams {
  /** Recipient public key (full hex or >= 6-byte prefix). */
  publicKey: string | Uint8Array;
  text: string;
  /** Message timestamp (epoch seconds). Defaults to now. */
  timestamp?: number;
  /** TxtType.PLAIN (default) or TxtType.CLI_DATA. */
  txtType?: number;
  /** Retry attempt counter (default 0). */
  attempt?: number;
}

/** CMD.SEND_TXT_MSG — a direct message to a contact. */
export function sendTxtMsg(params: SendTxtMsgParams): Uint8Array {
  const {
    publicKey,
    text,
    timestamp = Math.floor(Date.now() / 1000),
    txtType = TxtType.PLAIN,
    attempt = 0,
  } = params;
  return new ByteWriter()
    .u8(Cmd.SEND_TXT_MSG)
    .u8(txtType)
    .u8(attempt)
    .u32(timestamp)
    .bytes(pubKeyPrefix(publicKey))
    .str(text)
    .toBytes();
}

export interface SendChannelTxtMsgParams {
  channelIdx: number;
  text: string;
  timestamp?: number;
  txtType?: number;
}

/** CMD.SEND_CHANNEL_TXT_MSG — a flood-mode group/channel message. */
export function sendChannelTxtMsg(params: SendChannelTxtMsgParams): Uint8Array {
  const {
    channelIdx,
    text,
    timestamp = Math.floor(Date.now() / 1000),
    txtType = TxtType.PLAIN,
  } = params;
  return new ByteWriter()
    .u8(Cmd.SEND_CHANNEL_TXT_MSG)
    .u8(txtType)
    .u8(channelIdx)
    .u32(timestamp)
    .str(text)
    .toBytes();
}

// -- channels ------------------------------------------------------------

/** CMD.GET_CHANNEL. */
export function getChannel(index: number): Uint8Array {
  return new ByteWriter().u8(Cmd.GET_CHANNEL).u8(index).toBytes();
}

/** CMD.SET_CHANNEL — 16-byte (128-bit) shared secret only. */
export function setChannel(index: number, name: string, secret: string | Uint8Array): Uint8Array {
  return new ByteWriter()
    .u8(Cmd.SET_CHANNEL)
    .u8(index)
    .fixedStr(name, CHANNEL_NAME_SIZE)
    .bytes(fixedBytes(secret, CHANNEL_SECRET_SIZE))
    .toBytes();
}

// -- contacts ------------------------------------------------------------

/** Subset of {@link Contact} needed to add or update a contact. */
export interface ContactInput {
  publicKey: string | Uint8Array; // full 32-byte key
  type: number;
  flags?: number;
  outPathLen?: number; // 0xFF = unknown/flood (default)
  outPath?: string | Uint8Array; // up to 64 bytes; zero-padded
  name: string;
  lastAdvertTimestamp?: number;
  gpsLat?: number; // degrees
  gpsLon?: number; // degrees
  lastMod?: number;
}

/** CMD.ADD_UPDATE_CONTACT — reverse of the CONTACT frame layout. */
export function addUpdateContact(c: ContactInput): Uint8Array {
  return new ByteWriter()
    .u8(Cmd.ADD_UPDATE_CONTACT)
    .bytes(fullPubKey(c.publicKey))
    .u8(c.type)
    .u8(c.flags ?? 0)
    .u8(c.outPathLen ?? OUT_PATH_UNKNOWN)
    .bytes(fixedBytes(c.outPath ?? new Uint8Array(0), MAX_PATH_SIZE))
    .fixedStr(c.name, CONTACT_NAME_SIZE)
    .u32(c.lastAdvertTimestamp ?? 0)
    .i32(Math.round((c.gpsLat ?? 0) * 1_000_000))
    .i32(Math.round((c.gpsLon ?? 0) * 1_000_000))
    .u32(c.lastMod ?? Math.floor(Date.now() / 1000))
    .toBytes();
}

/** CMD.GET_CONTACT_BY_KEY — full 32-byte public key. */
export function getContactByKey(publicKey: string | Uint8Array): Uint8Array {
  return new ByteWriter().u8(Cmd.GET_CONTACT_BY_KEY).bytes(fullPubKey(publicKey)).toBytes();
}

/** CMD.REMOVE_CONTACT. */
export function removeContact(publicKey: string | Uint8Array): Uint8Array {
  return new ByteWriter().u8(Cmd.REMOVE_CONTACT).bytes(fullPubKey(publicKey)).toBytes();
}

/** CMD.RESET_PATH — forget the cached out-path to a contact. */
export function resetPath(publicKey: string | Uint8Array): Uint8Array {
  return new ByteWriter().u8(Cmd.RESET_PATH).bytes(fullPubKey(publicKey)).toBytes();
}

/** CMD.SHARE_CONTACT — re-advertise a contact zero-hop. */
export function shareContact(publicKey: string | Uint8Array): Uint8Array {
  return new ByteWriter().u8(Cmd.SHARE_CONTACT).bytes(fullPubKey(publicKey)).toBytes();
}

// -- device / radio ------------------------------------------------------

/** CMD.GET_BATT_AND_STORAGE. */
export function getBatteryAndStorage(): Uint8Array {
  return new ByteWriter().u8(Cmd.GET_BATT_AND_STORAGE).toBytes();
}

/** CMD.REBOOT — requires the literal "reboot" magic bytes. */
export function reboot(): Uint8Array {
  return new ByteWriter().u8(Cmd.REBOOT).str('reboot').toBytes();
}

export interface RadioParams {
  freqMHz: number;
  bandwidthKHz: number;
  spreadingFactor: number;
  codingRate: number;
  /** v9+ client repeat flag. */
  repeat?: boolean;
}

/** CMD.SET_RADIO_PARAMS. Wire units: freq = MHz*1000, bw = kHz*1000. */
export function setRadioParams(p: RadioParams): Uint8Array {
  const w = new ByteWriter()
    .u8(Cmd.SET_RADIO_PARAMS)
    .u32(Math.round(p.freqMHz * 1000))
    .u32(Math.round(p.bandwidthKHz * 1000))
    .u8(p.spreadingFactor)
    .u8(p.codingRate);
  if (p.repeat !== undefined) w.u8(p.repeat ? 1 : 0);
  return w.toBytes();
}

/** CMD.SET_RADIO_TX_POWER — signed dBm. */
export function setRadioTxPower(dbm: number): Uint8Array {
  return new ByteWriter().u8(Cmd.SET_RADIO_TX_POWER).i8(dbm).toBytes();
}

// -- login / status / telemetry -----------------------------------------

/** CMD.SEND_LOGIN — authenticate to a repeater/room server. */
export function sendLogin(publicKey: string | Uint8Array, password: string): Uint8Array {
  return new ByteWriter()
    .u8(Cmd.SEND_LOGIN)
    .bytes(fullPubKey(publicKey))
    .str(password)
    .toBytes();
}

/** CMD.LOGOUT — end a repeater/room-server session. */
export function logout(publicKey: string | Uint8Array): Uint8Array {
  return new ByteWriter().u8(Cmd.LOGOUT).bytes(fullPubKey(publicKey)).toBytes();
}

/** CMD.SEND_STATUS_REQ — request status from a repeater/sensor node. */
export function sendStatusReq(publicKey: string | Uint8Array): Uint8Array {
  return new ByteWriter().u8(Cmd.SEND_STATUS_REQ).bytes(fullPubKey(publicKey)).toBytes();
}

/** CMD.SEND_TELEMETRY_REQ for a remote node (3 reserved bytes then the key). */
export function sendTelemetryReq(publicKey: string | Uint8Array): Uint8Array {
  return new ByteWriter()
    .u8(Cmd.SEND_TELEMETRY_REQ)
    .bytes(new Uint8Array(3)) // reserved
    .bytes(fullPubKey(publicKey))
    .toBytes();
}

/** CMD.SEND_TELEMETRY_REQ for THIS device (len == 4 selects self telemetry). */
export function sendSelfTelemetryReq(): Uint8Array {
  return new ByteWriter().u8(Cmd.SEND_TELEMETRY_REQ).bytes(new Uint8Array(3)).toBytes();
}

/** CMD.HAS_CONNECTION — check for an active session to a node. */
export function hasConnection(publicKey: string | Uint8Array): Uint8Array {
  return new ByteWriter().u8(Cmd.HAS_CONNECTION).bytes(fullPubKey(publicKey)).toBytes();
}

export interface TracePathParams {
  /** Node hashes to route the trace through (each 1<<(flags&3) bytes). */
  path: string | Uint8Array;
  /** Correlation tag echoed back in the TRACE_DATA response. */
  tag: number;
  /** Optional auth code (default 0). */
  authCode?: number;
  /** Flags; low 2 bits set the per-hop hash size (default 0 = 1 byte). */
  flags?: number;
}

/** CMD.SEND_TRACE_PATH — trace a route, collecting per-hop SNR. */
export function sendTracePath(p: TracePathParams): Uint8Array {
  return new ByteWriter()
    .u8(Cmd.SEND_TRACE_PATH)
    .u32(p.tag)
    .u32(p.authCode ?? 0)
    .u8(p.flags ?? 0)
    .bytes(asBytes(p.path))
    .toBytes();
}

// -- raw / binary / control passthrough ---------------------------------

/**
 * CMD.SEND_RAW_DATA — send a custom/raw packet along a direct `path`
 * (list of node hashes). `payload` must be at least 4 bytes.
 */
export function sendRawData(
  path: string | Uint8Array,
  payload: string | Uint8Array,
): Uint8Array {
  const pathBytes = asBytes(path);
  const payloadBytes = asBytes(payload);
  if (payloadBytes.length < 4) throw new Error('sendRawData: payload must be >= 4 bytes');
  return new ByteWriter()
    .u8(Cmd.SEND_RAW_DATA)
    .u8(pathBytes.length)
    .bytes(pathBytes)
    .bytes(payloadBytes)
    .toBytes();
}

/**
 * CMD.SEND_BINARY_REQ — send a binary request to a node. The device assigns a
 * tag (returned in the SENT reply) that matches the later BINARY_RESPONSE.
 */
export function sendBinaryReq(
  publicKey: string | Uint8Array,
  data: string | Uint8Array,
): Uint8Array {
  return new ByteWriter()
    .u8(Cmd.SEND_BINARY_REQ)
    .bytes(fullPubKey(publicKey))
    .bytes(asBytes(data))
    .toBytes();
}

/**
 * CMD.SEND_CONTROL_DATA — send a control packet (zero-hop). The first payload
 * byte must have its high bit (0x80) set.
 */
export function sendControlData(payload: string | Uint8Array): Uint8Array {
  const bytes = asBytes(payload);
  if (bytes.length < 1 || (bytes[0]! & 0x80) === 0) {
    throw new Error('sendControlData: first payload byte must have bit 0x80 set');
  }
  return new ByteWriter().u8(Cmd.SEND_CONTROL_DATA).bytes(bytes).toBytes();
}

// -- configuration ------------------------------------------------------

/** CMD.GET_CUSTOM_VARS. */
export function getCustomVars(): Uint8Array {
  return new ByteWriter().u8(Cmd.GET_CUSTOM_VARS).toBytes();
}

/** CMD.SET_CUSTOM_VAR — sets `name` to `value` (sent as "name:value"). */
export function setCustomVar(name: string, value: string): Uint8Array {
  return new ByteWriter().u8(Cmd.SET_CUSTOM_VAR).str(`${name}:${value}`).toBytes();
}

/** CMD.GET_TUNING_PARAMS. */
export function getTuningParams(): Uint8Array {
  return new ByteWriter().u8(Cmd.GET_TUNING_PARAMS).toBytes();
}

/** CMD.SET_TUNING_PARAMS. Wire units are the float values * 1000. */
export function setTuningParams(rxDelayBase: number, airtimeFactor: number): Uint8Array {
  return new ByteWriter()
    .u8(Cmd.SET_TUNING_PARAMS)
    .u32(Math.round(rxDelayBase * 1000))
    .u32(Math.round(airtimeFactor * 1000))
    .toBytes();
}

/** CMD.SET_DEVICE_PIN — 0 to disable, or a 6-digit PIN. */
export function setDevicePin(pin: number): Uint8Array {
  return new ByteWriter().u8(Cmd.SET_DEVICE_PIN).u32(pin).toBytes();
}

export interface OtherParams {
  manualAddContacts: number;
  telemetryModeBase?: number;
  telemetryModeLoc?: number;
  telemetryModeEnv?: number;
  advertLocPolicy?: number;
  multiAcks?: number;
}

/** CMD.SET_OTHER_PARAMS — trailing fields are optional (firmware-version gated). */
export function setOtherParams(p: OtherParams): Uint8Array {
  const w = new ByteWriter().u8(Cmd.SET_OTHER_PARAMS).u8(p.manualAddContacts);
  const hasTelemetry =
    p.telemetryModeBase !== undefined ||
    p.telemetryModeLoc !== undefined ||
    p.telemetryModeEnv !== undefined ||
    p.advertLocPolicy !== undefined ||
    p.multiAcks !== undefined;
  if (hasTelemetry) {
    w.u8(
      ((p.telemetryModeEnv ?? 0) << 4) |
        ((p.telemetryModeLoc ?? 0) << 2) |
        (p.telemetryModeBase ?? 0),
    );
    if (p.advertLocPolicy !== undefined || p.multiAcks !== undefined) {
      w.u8(p.advertLocPolicy ?? 0);
      if (p.multiAcks !== undefined) w.u8(p.multiAcks);
    }
  }
  return w.toBytes();
}

/** CMD.GET_AUTOADD_CONFIG. */
export function getAutoAddConfig(): Uint8Array {
  return new ByteWriter().u8(Cmd.GET_AUTOADD_CONFIG).toBytes();
}

/** CMD.SET_AUTOADD_CONFIG. */
export function setAutoAddConfig(config: number, maxHops?: number): Uint8Array {
  const w = new ByteWriter().u8(Cmd.SET_AUTOADD_CONFIG).u8(config);
  if (maxHops !== undefined) w.u8(maxHops);
  return w.toBytes();
}

/** CMD.GET_ALLOWED_REPEAT_FREQ. */
export function getAllowedRepeatFreq(): Uint8Array {
  return new ByteWriter().u8(Cmd.GET_ALLOWED_REPEAT_FREQ).toBytes();
}

/** CMD.SET_PATH_HASH_MODE (0..2). */
export function setPathHashMode(mode: number): Uint8Array {
  return new ByteWriter().u8(Cmd.SET_PATH_HASH_MODE).u8(0).u8(mode).toBytes();
}

/** CMD.SET_ADVERT_LATLON — location in advertisements (degrees). */
export function setAdvertLatLon(lat: number, lon: number): Uint8Array {
  return new ByteWriter()
    .u8(Cmd.SET_ADVERT_LATLON)
    .i32(Math.round(lat * 1_000_000))
    .i32(Math.round(lon * 1_000_000))
    .toBytes();
}

/** CMD.FACTORY_RESET — requires the literal "reset" magic bytes. */
export function factoryReset(): Uint8Array {
  return new ByteWriter().u8(Cmd.FACTORY_RESET).str('reset').toBytes();
}

// -- device sign API ----------------------------------------------------

/** CMD.SIGN_START — begin a signing session. */
export function signStart(): Uint8Array {
  return new ByteWriter().u8(Cmd.SIGN_START).toBytes();
}

/** CMD.SIGN_DATA — append a chunk of data to sign. */
export function signData(chunk: Uint8Array): Uint8Array {
  return new ByteWriter().u8(Cmd.SIGN_DATA).bytes(chunk).toBytes();
}

/** CMD.SIGN_FINISH — finish and return the 64-byte signature. */
export function signFinish(): Uint8Array {
  return new ByteWriter().u8(Cmd.SIGN_FINISH).toBytes();
}

/**
 * Encoders for app -> device command frames (MVP command set).
 *
 * Layouts mirror the parsers in MeshCore `MyMesh.cpp::handleCmdFrame`.
 */
import { ByteWriter } from './writer.js';
import { Cmd, TxtType, PUBKEY_PREFIX_SIZE } from './constants.js';
import { fromHex } from './hex.js';

/** First 6 bytes of a public key (hex or bytes) as used in message frames. */
function pubKeyPrefix(key: string | Uint8Array): Uint8Array {
  const bytes = typeof key === 'string' ? fromHex(key) : key;
  if (bytes.length < PUBKEY_PREFIX_SIZE) {
    throw new Error(`public key prefix needs >= ${PUBKEY_PREFIX_SIZE} bytes`);
  }
  return bytes.subarray(0, PUBKEY_PREFIX_SIZE);
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

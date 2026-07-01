/**
 * Decoders for device -> app frames (responses and pushes).
 *
 * Layouts mirror the frame writers in MeshCore `MyMesh.cpp`. Frames whose code
 * is not yet modelled decode to `{ type: 'raw' }` with the payload preserved.
 */
import { ByteReader } from './reader.js';
import {
  Resp,
  Push,
  TxtType,
  ERR_CODE_NAMES,
  PUB_KEY_SIZE,
  MAX_PATH_SIZE,
  CONTACT_NAME_SIZE,
  CHANNEL_NAME_SIZE,
  CHANNEL_SECRET_SIZE,
  PUBKEY_PREFIX_SIZE,
} from './constants.js';
import { toHex } from './hex.js';
import type { Contact, DecodedFrame, InboundMessage } from './types.js';

/** True if `code` denotes an unsolicited push notification. */
export function isPushCode(code: number): boolean {
  return code >= 0x80;
}

function decodeContact(r: ByteReader): Contact {
  const publicKey = r.hex(PUB_KEY_SIZE);
  const type = r.u8();
  const flags = r.u8();
  const outPathLen = r.u8();
  const pathBytes = r.bytes_(MAX_PATH_SIZE);
  const name = r.fixedStr(CONTACT_NAME_SIZE);
  const lastAdvertTimestamp = r.u32();
  const gpsLat = r.i32() / 1_000_000;
  const gpsLon = r.i32() / 1_000_000;
  const lastMod = r.u32();
  const outPath =
    outPathLen <= MAX_PATH_SIZE ? toHex(pathBytes.subarray(0, outPathLen)) : '';
  return {
    publicKey,
    type,
    flags,
    outPathLen,
    outPath,
    name,
    lastAdvertTimestamp,
    gpsLat,
    gpsLon,
    lastMod,
  };
}

function decodeContactMessage(r: ByteReader, v3: boolean): InboundMessage {
  const snr = v3 ? readSnr(r) : undefined;
  const senderPrefix = r.hex(PUBKEY_PREFIX_SIZE);
  const pathLen = r.u8();
  const txtType = r.u8();
  const senderTimestamp = r.u32();
  let signedSenderPrefix: string | undefined;
  if (txtType === TxtType.SIGNED_PLAIN) {
    signedSenderPrefix = r.hex(4); // 'extra' bytes prepended by the firmware
  }
  return {
    kind: 'contact',
    snr,
    senderPrefix,
    pathLen,
    txtType,
    senderTimestamp,
    signedSenderPrefix,
    text: r.restStr(),
  };
}

function decodeChannelMessage(r: ByteReader, v3: boolean): InboundMessage {
  const snr = v3 ? readSnr(r) : undefined;
  const channelIdx = r.u8();
  const pathLen = r.u8();
  const txtType = r.u8();
  const senderTimestamp = r.u32();
  return {
    kind: 'channel',
    snr,
    channelIdx,
    pathLen,
    txtType,
    senderTimestamp,
    text: r.restStr(),
  };
}

/** V3 frames encode SNR as int8 * 4. */
function readSnr(r: ByteReader): number {
  const snr = r.i8() / 4;
  r.u8(); // reserved1
  r.u8(); // reserved2
  return snr;
}

/** Decode one whole protocol frame. */
export function decodeFrame(frame: Uint8Array): DecodedFrame {
  if (frame.length === 0) return { type: 'raw', code: -1, payload: frame };
  const r = new ByteReader(frame);
  const code = r.u8();

  switch (code) {
    case Resp.OK:
      return { type: 'ok' };
    case Resp.ERR: {
      const c = r.hasMore() ? r.u8() : 0;
      return { type: 'error', error: { code: c, name: ERR_CODE_NAMES[c] ?? 'UNKNOWN' } };
    }
    case Resp.DISABLED:
      return { type: 'disabled' };
    case Resp.NO_MORE_MESSAGES:
      return { type: 'noMoreMessages' };

    case Resp.DEVICE_INFO: {
      const firmwareVerCode = r.u8();
      const maxContacts = r.u8() * 2; // firmware sends MAX_CONTACTS/2
      const maxChannels = r.u8();
      const blePin = r.u32();
      const firmwareBuildDate = r.fixedStr(12);
      const manufacturer = r.fixedStr(40);
      const firmwareVersion = r.fixedStr(20);
      const clientRepeat = r.hasMore() ? r.u8() : 0;
      const pathHashMode = r.hasMore() ? r.u8() : 0;
      return {
        type: 'deviceInfo',
        info: {
          firmwareVerCode,
          maxContacts,
          maxChannels,
          blePin,
          firmwareBuildDate,
          manufacturer,
          firmwareVersion,
          clientRepeat,
          pathHashMode,
        },
      };
    }

    case Resp.SELF_INFO: {
      const advType = r.u8();
      const txPower = r.u8();
      const maxTxPower = r.u8();
      const publicKey = r.hex(PUB_KEY_SIZE);
      const lat = r.i32() / 1_000_000;
      const lon = r.i32() / 1_000_000;
      const multiAcks = r.u8();
      const advertLocPolicy = r.u8();
      const telemetry = r.u8();
      const manualAddContacts = r.u8();
      const freq = r.u32() / 1000; // MHz
      const bandwidth = r.u32() / 1000; // kHz
      const spreadingFactor = r.u8();
      const codingRate = r.u8();
      const name = r.restStr();
      return {
        type: 'selfInfo',
        info: {
          advType,
          txPower,
          maxTxPower,
          publicKey,
          lat,
          lon,
          multiAcks,
          advertLocPolicy,
          telemetryModeBase: telemetry & 0x03,
          telemetryModeLoc: (telemetry >> 2) & 0x03,
          telemetryModeEnv: (telemetry >> 4) & 0x0f,
          manualAddContacts,
          freq,
          bandwidth,
          spreadingFactor,
          codingRate,
          name,
        },
      };
    }

    case Resp.CONTACTS_START:
      return { type: 'contactsStart', count: r.u32() };
    case Resp.CONTACT:
      return { type: 'contact', contact: decodeContact(r) };
    case Resp.END_OF_CONTACTS:
      return { type: 'endOfContacts', mostRecentLastMod: r.u32() };

    case Resp.SENT:
      return {
        type: 'sent',
        result: { flood: r.u8() === 1, expectedAck: r.u32(), estTimeout: r.u32() },
      };

    case Resp.CURR_TIME:
      return { type: 'currentTime', time: { epochSeconds: r.u32() } };

    case Resp.CHANNEL_INFO:
      return {
        type: 'channelInfo',
        channel: {
          index: r.u8(),
          name: r.fixedStr(CHANNEL_NAME_SIZE),
          secret: r.hex(CHANNEL_SECRET_SIZE),
        },
      };

    case Resp.BATT_AND_STORAGE:
      return {
        type: 'batteryAndStorage',
        info: {
          batteryMillivolts: r.u16(),
          storageUsedKb: r.u32(),
          storageTotalKb: r.u32(),
        },
      };

    case Resp.CONTACT_MSG_RECV_V3:
      return { type: 'message', message: decodeContactMessage(r, true) };
    case Resp.CONTACT_MSG_RECV:
      return { type: 'message', message: decodeContactMessage(r, false) };
    case Resp.CHANNEL_MSG_RECV_V3:
      return { type: 'message', message: decodeChannelMessage(r, true) };
    case Resp.CHANNEL_MSG_RECV:
      return { type: 'message', message: decodeChannelMessage(r, false) };

    // -- pushes --
    case Push.ADVERT:
      return { type: 'advert', publicKey: r.hex(PUB_KEY_SIZE) };
    case Push.NEW_ADVERT:
      return { type: 'newAdvert', contact: decodeContact(r) };
    case Push.PATH_UPDATED:
      return { type: 'pathUpdated', publicKey: r.hex(PUB_KEY_SIZE) };
    case Push.SEND_CONFIRMED:
      return {
        type: 'sendConfirmed',
        confirmed: { ackTag: r.u32(), roundTripMillis: r.u32() },
      };
    case Push.MSG_WAITING:
      return { type: 'messageWaiting' };
    case Push.CONTACT_DELETED:
      return { type: 'contactDeleted', publicKey: r.hex(PUB_KEY_SIZE) };
    case Push.CONTACTS_FULL:
      return { type: 'contactsFull' };

    default:
      return { type: 'raw', code, payload: frame.slice(1) };
  }
}

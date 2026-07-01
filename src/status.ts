/**
 * Repeater / room-server status blob parsing.
 *
 * `requestStatus()` returns the raw device blob. Repeaters and room servers
 * pack a stats struct (`RepeaterStats` / `ServerStats` in the firmware) that
 * shares a common 48-byte prefix and then diverges. All fields are
 * little-endian; SNR is int16 × 4.
 */
import { ByteReader } from './protocol/reader.js';
import { AdvType } from './protocol/constants.js';

/** Fields common to repeater and room-server status. */
export interface NodeStatusCommon {
  batteryMillivolts: number;
  txQueueLength: number;
  noiseFloor: number;
  lastRssi: number;
  packetsReceived: number;
  packetsSent: number;
  txAirtimeSeconds: number;
  uptimeSeconds: number;
  sentFlood: number;
  sentDirect: number;
  recvFlood: number;
  recvDirect: number;
  errEvents: number;
  /** SNR of the last packet, in dB. */
  lastSnr: number;
  directDups: number;
  floodDups: number;
}

export interface RepeaterStatus extends NodeStatusCommon {
  kind: 'repeater';
  rxAirtimeSeconds: number;
  recvErrors: number;
}

export interface RoomServerStatus extends NodeStatusCommon {
  kind: 'room';
  /** Number of posts stored. */
  posted: number;
  /** Number of post pushes sent. */
  postPushes: number;
}

export type NodeStatus = RepeaterStatus | RoomServerStatus;

function parseCommon(r: ByteReader): NodeStatusCommon {
  return {
    batteryMillivolts: r.u16(),
    txQueueLength: r.u16(),
    noiseFloor: r.i16(),
    lastRssi: r.i16(),
    packetsReceived: r.u32(),
    packetsSent: r.u32(),
    txAirtimeSeconds: r.u32(),
    uptimeSeconds: r.u32(),
    sentFlood: r.u32(),
    sentDirect: r.u32(),
    recvFlood: r.u32(),
    recvDirect: r.u32(),
    errEvents: r.u16(),
    lastSnr: r.i16() / 4,
    directDups: r.u16(),
    floodDups: r.u16(),
  };
}

/** Parse a repeater status blob (from a type=REPEATER node). */
export function parseRepeaterStatus(data: Uint8Array): RepeaterStatus {
  const r = new ByteReader(data);
  const common = parseCommon(r);
  return {
    kind: 'repeater',
    ...common,
    rxAirtimeSeconds: r.u32(),
    recvErrors: r.u32(),
  };
}

/** Parse a room-server status blob (from a type=ROOM node). */
export function parseRoomServerStatus(data: Uint8Array): RoomServerStatus {
  const r = new ByteReader(data);
  const common = parseCommon(r);
  return {
    kind: 'room',
    ...common,
    posted: r.u16(),
    postPushes: r.u16(),
  };
}

/**
 * Parse a status blob using the responder's advertisement type: ROOM nodes use
 * the room-server layout, everything else uses the repeater layout.
 */
export function parseNodeStatus(data: Uint8Array, advType: number): NodeStatus {
  return advType === AdvType.ROOM
    ? parseRoomServerStatus(data)
    : parseRepeaterStatus(data);
}

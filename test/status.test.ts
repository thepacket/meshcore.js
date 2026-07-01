import { describe, it, expect } from 'vitest';
import {
  parseRepeaterStatus,
  parseRoomServerStatus,
  parseNodeStatus,
} from '../src/status.js';
import { ByteWriter } from '../src/protocol/writer.js';
import { fromHex } from '../src/protocol/hex.js';
import { AdvType } from '../src/protocol/constants.js';

describe('parseRepeaterStatus', () => {
  // Real 60-byte blob captured from a LilyGo T-Echo repeater "LostPacketR"
  // (56-byte RepeaterStats + 4 trailing zero bytes from a newer firmware).
  const REAL =
    'd40f00008cfff9ff240000000f00000004000000890600000a0000000500000010000000140000000000320000000800090000000300000000000000';

  it('decodes the real hardware blob', () => {
    const s = parseRepeaterStatus(fromHex(REAL));
    expect(s.kind).toBe('repeater');
    expect(s.batteryMillivolts).toBe(4052);
    expect(s.txQueueLength).toBe(0);
    expect(s.noiseFloor).toBe(-116);
    expect(s.lastRssi).toBe(-7);
    expect(s.packetsReceived).toBe(36);
    expect(s.packetsSent).toBe(15);
    expect(s.txAirtimeSeconds).toBe(4);
    expect(s.uptimeSeconds).toBe(1673);
    expect(s.sentFlood).toBe(10);
    expect(s.sentDirect).toBe(5);
    expect(s.recvFlood).toBe(16);
    expect(s.recvDirect).toBe(20);
    expect(s.errEvents).toBe(0);
    expect(s.lastSnr).toBe(12.5);
    expect(s.directDups).toBe(0);
    expect(s.floodDups).toBe(8);
    expect(s.rxAirtimeSeconds).toBe(9);
    expect(s.recvErrors).toBe(3);
  });

  it('tolerates trailing bytes (newer firmware) — ignores extra', () => {
    // 56-byte struct with no trailing bytes still parses
    const s = parseRepeaterStatus(fromHex(REAL).subarray(0, 56));
    expect(s.recvErrors).toBe(3);
  });
});

describe('parseRoomServerStatus', () => {
  it('decodes the room-server tail (posted / postPushes)', () => {
    const w = new ByteWriter()
      .u16(4000).u16(1) // batt, queue
      .i16(-110).i16(-80) // noise, rssi
      .u32(100).u32(50).u32(7).u32(3600) // recv, sent, txAir, uptime
      .u32(10).u32(20).u32(30).u32(40) // flood/direct sent/recv
      .u16(2).i16(24) // errEvents, snr*4 (=6 dB)
      .u16(1).u16(5) // direct/flood dups
      .u16(12).u16(9); // n_posted, n_post_push
    const s = parseRoomServerStatus(w.toBytes());
    expect(s.kind).toBe('room');
    expect(s.batteryMillivolts).toBe(4000);
    expect(s.lastSnr).toBe(6);
    expect(s.posted).toBe(12);
    expect(s.postPushes).toBe(9);
  });
});

describe('parseNodeStatus dispatch', () => {
  const blob = fromHex(
    'd40f00008cfff9ff240000000f00000004000000890600000a0000000500000010000000140000000000320000000800090000000300000000000000',
  );
  it('uses repeater layout for non-room types', () => {
    expect(parseNodeStatus(blob, AdvType.REPEATER).kind).toBe('repeater');
    expect(parseNodeStatus(blob, AdvType.CHAT).kind).toBe('repeater');
  });
  it('uses room layout for ROOM type', () => {
    expect(parseNodeStatus(blob, AdvType.ROOM).kind).toBe('room');
  });
});

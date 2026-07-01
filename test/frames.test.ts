import { describe, it, expect } from 'vitest';
import { ByteWriter } from '../src/protocol/writer.js';
import { decodeFrame } from '../src/protocol/decode.js';
import * as encode from '../src/protocol/encode.js';
import { Cmd, Resp, Push, AdvType, TxtType } from '../src/protocol/constants.js';
import { fromHex, toHex } from '../src/protocol/hex.js';

const PUB = 'a1b2c3d4e5f6' + '00'.repeat(26); // 32-byte hex

// ---- encoders: assert exact bytes the firmware parses ----

describe('command encoders', () => {
  it('deviceQuery', () => {
    expect([...encode.deviceQuery(3)]).toEqual([Cmd.DEVICE_QUERY, 3]);
  });

  it('appStart puts the name at byte 8', () => {
    const f = encode.appStart('app', 3);
    expect(f[0]).toBe(Cmd.APP_START);
    expect(f[1]).toBe(3); // reserved[0] carries version
    expect([...f.slice(2, 8)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(new TextDecoder().decode(f.slice(8))).toBe('app');
  });

  it('getContacts with and without since', () => {
    expect([...encode.getContacts()]).toEqual([Cmd.GET_CONTACTS]);
    const f = encode.getContacts(0x01020304);
    expect([...f]).toEqual([Cmd.GET_CONTACTS, 0x04, 0x03, 0x02, 0x01]);
  });

  it('setDeviceTime is little-endian u32', () => {
    expect([...encode.setDeviceTime(0x01020304)]).toEqual([
      Cmd.SET_DEVICE_TIME, 0x04, 0x03, 0x02, 0x01,
    ]);
  });

  it('sendSelfAdvert flood flag', () => {
    expect([...encode.sendSelfAdvert(false)]).toEqual([Cmd.SEND_SELF_ADVERT, 0]);
    expect([...encode.sendSelfAdvert(true)]).toEqual([Cmd.SEND_SELF_ADVERT, 1]);
  });

  it('sendTxtMsg layout: type, attempt, ts, 6-byte prefix, text', () => {
    const f = encode.sendTxtMsg({
      publicKey: PUB,
      text: 'hi',
      timestamp: 0x01020304,
      txtType: TxtType.PLAIN,
      attempt: 2,
    });
    expect([...f]).toEqual([
      Cmd.SEND_TXT_MSG,
      TxtType.PLAIN,
      2,
      0x04, 0x03, 0x02, 0x01, // timestamp LE
      0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, // 6-byte prefix
      104, 105, // "hi"
    ]);
  });

  it('sendChannelTxtMsg layout: type, channelIdx, ts, text', () => {
    const f = encode.sendChannelTxtMsg({ channelIdx: 1, text: 'yo', timestamp: 5 });
    expect([...f]).toEqual([
      Cmd.SEND_CHANNEL_TXT_MSG, TxtType.PLAIN, 1, 5, 0, 0, 0, 121, 111,
    ]);
  });
});

// ---- decoders: build firmware-shaped frames, decode, verify fields ----

describe('response decoders', () => {
  it('OK / ERR / DISABLED / NO_MORE_MESSAGES', () => {
    expect(decodeFrame(new Uint8Array([Resp.OK]))).toEqual({ type: 'ok' });
    expect(decodeFrame(new Uint8Array([Resp.ERR, 2]))).toEqual({
      type: 'error',
      error: { code: 2, name: 'NOT_FOUND' },
    });
    expect(decodeFrame(new Uint8Array([Resp.DISABLED])).type).toBe('disabled');
    expect(decodeFrame(new Uint8Array([Resp.NO_MORE_MESSAGES])).type).toBe(
      'noMoreMessages',
    );
  });

  it('DEVICE_INFO', () => {
    const w = new ByteWriter()
      .u8(Resp.DEVICE_INFO)
      .u8(9) // ver code
      .u8(50) // MAX_CONTACTS/2 -> 100
      .u8(8) // channels
      .u32(123456) // ble pin
      .fixedStr('1 Jan 2026', 12)
      .fixedStr('Heltec', 40)
      .fixedStr('v1.2.3', 20)
      .u8(1) // client_repeat
      .u8(2); // path_hash_mode
    const d = decodeFrame(w.toBytes());
    expect(d.type).toBe('deviceInfo');
    if (d.type !== 'deviceInfo') return;
    expect(d.info.firmwareVerCode).toBe(9);
    expect(d.info.maxContacts).toBe(100);
    expect(d.info.maxChannels).toBe(8);
    expect(d.info.blePin).toBe(123456);
    expect(d.info.firmwareBuildDate).toBe('1 Jan 2026');
    expect(d.info.manufacturer).toBe('Heltec');
    expect(d.info.firmwareVersion).toBe('v1.2.3');
    expect(d.info.clientRepeat).toBe(1);
    expect(d.info.pathHashMode).toBe(2);
  });

  it('DEVICE_INFO tolerates missing v9+/v10+ trailer', () => {
    const w = new ByteWriter()
      .u8(Resp.DEVICE_INFO)
      .u8(3).u8(50).u8(8).u32(0)
      .fixedStr('date', 12).fixedStr('mfr', 40).fixedStr('v1', 20);
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'deviceInfo') throw new Error('wrong type');
    expect(d.info.clientRepeat).toBe(0);
    expect(d.info.pathHashMode).toBe(0);
  });

  it('SELF_INFO', () => {
    const w = new ByteWriter()
      .u8(Resp.SELF_INFO)
      .u8(AdvType.CHAT)
      .u8(20) // tx power
      .u8(22) // max tx power
      .bytes(fromHex(PUB))
      .i32(-33_500_000) // lat -33.5
      .i32(151_200_000) // lon 151.2
      .u8(1) // multi_acks
      .u8(0) // advert_loc_policy
      .u8((0x0 << 4) | (0x1 << 2) | 0x2) // telemetry: env0 loc1 base2
      .u8(1) // manual_add_contacts
      .u32(915_000) // freq wire = MHz*1000 -> 915 MHz
      .u32(250 * 1000) // bw -> 250 kHz
      .u8(10) // sf
      .u8(5) // cr
      .str('MyNode');
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'selfInfo') throw new Error('wrong type');
    expect(d.info.advType).toBe(AdvType.CHAT);
    expect(d.info.publicKey).toBe(PUB);
    expect(d.info.lat).toBeCloseTo(-33.5, 6);
    expect(d.info.lon).toBeCloseTo(151.2, 6);
    expect(d.info.telemetryModeBase).toBe(2);
    expect(d.info.telemetryModeLoc).toBe(1);
    expect(d.info.telemetryModeEnv).toBe(0);
    expect(d.info.freq).toBe(915);
    expect(d.info.bandwidth).toBe(250);
    expect(d.info.spreadingFactor).toBe(10);
    expect(d.info.codingRate).toBe(5);
    expect(d.info.name).toBe('MyNode');
  });

  it('CONTACT (mirrors writeContactRespFrame)', () => {
    const path = new Uint8Array(64);
    path[0] = 0xaa;
    path[1] = 0xbb;
    const w = new ByteWriter()
      .u8(Resp.CONTACT)
      .bytes(fromHex(PUB))
      .u8(AdvType.REPEATER)
      .u8(0x01) // flags
      .u8(2) // out_path_len
      .bytes(path) // MAX_PATH_SIZE
      .fixedStr('Repeater-1', 32)
      .u32(1_700_000_000)
      .i32(-33_000_000)
      .i32(151_000_000)
      .u32(1_700_000_500);
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'contact') throw new Error('wrong type');
    expect(d.contact.publicKey).toBe(PUB);
    expect(d.contact.type).toBe(AdvType.REPEATER);
    expect(d.contact.outPathLen).toBe(2);
    expect(d.contact.outPath).toBe('aabb');
    expect(d.contact.name).toBe('Repeater-1');
    expect(d.contact.lastAdvertTimestamp).toBe(1_700_000_000);
    expect(d.contact.gpsLat).toBeCloseTo(-33, 6);
    expect(d.contact.lastMod).toBe(1_700_000_500);
  });

  it('CONTACTS_START / END_OF_CONTACTS', () => {
    const start = decodeFrame(new ByteWriter().u8(Resp.CONTACTS_START).u32(7).toBytes());
    expect(start).toEqual({ type: 'contactsStart', count: 7 });
    const end = decodeFrame(
      new ByteWriter().u8(Resp.END_OF_CONTACTS).u32(1_700_000_500).toBytes(),
    );
    expect(end).toEqual({ type: 'endOfContacts', mostRecentLastMod: 1_700_000_500 });
  });

  it('SENT', () => {
    const w = new ByteWriter().u8(Resp.SENT).u8(1).u32(0xdeadbeef).u32(1500);
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'sent') throw new Error('wrong type');
    expect(d.result.flood).toBe(true);
    expect(d.result.expectedAck).toBe(0xdeadbeef);
    expect(d.result.estTimeout).toBe(1500);
  });

  it('CURR_TIME', () => {
    const d = decodeFrame(new ByteWriter().u8(Resp.CURR_TIME).u32(1_700_000_000).toBytes());
    expect(d).toEqual({ type: 'currentTime', time: { epochSeconds: 1_700_000_000 } });
  });

  it('CONTACT_MSG_RECV_V3 (plain)', () => {
    const w = new ByteWriter()
      .u8(Resp.CONTACT_MSG_RECV_V3)
      .i8(-20) // snr * 4 -> -5 dB
      .u8(0).u8(0) // reserved
      .bytes(fromHex('a1b2c3d4e5f6')) // 6-byte prefix
      .u8(3) // path_len
      .u8(TxtType.PLAIN)
      .u32(1_700_000_000)
      .str('hello there');
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'message') throw new Error('wrong type');
    expect(d.message.kind).toBe('contact');
    expect(d.message.snr).toBeCloseTo(-5, 6);
    expect(d.message.senderPrefix).toBe('a1b2c3d4e5f6');
    expect(d.message.pathLen).toBe(3);
    expect(d.message.text).toBe('hello there');
  });

  it('CONTACT_MSG_RECV_V3 (signed adds a 4-byte prefix before text)', () => {
    const w = new ByteWriter()
      .u8(Resp.CONTACT_MSG_RECV_V3)
      .i8(0).u8(0).u8(0)
      .bytes(fromHex('a1b2c3d4e5f6'))
      .u8(0xff)
      .u8(TxtType.SIGNED_PLAIN)
      .u32(1_700_000_000)
      .bytes(fromHex('11223344')) // signed sender prefix
      .str('signed msg');
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'message') throw new Error('wrong type');
    expect(d.message.signedSenderPrefix).toBe('11223344');
    expect(d.message.text).toBe('signed msg');
  });

  it('CHANNEL_MSG_RECV_V3', () => {
    const w = new ByteWriter()
      .u8(Resp.CHANNEL_MSG_RECV_V3)
      .i8(8) // 2 dB
      .u8(0).u8(0)
      .u8(1) // channel idx
      .u8(0xff) // path_len (direct)
      .u8(TxtType.PLAIN)
      .u32(1_700_000_000)
      .str('bob: hey all');
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'message') throw new Error('wrong type');
    expect(d.message.kind).toBe('channel');
    expect(d.message.channelIdx).toBe(1);
    expect(d.message.snr).toBeCloseTo(2, 6);
    expect(d.message.text).toBe('bob: hey all');
  });
});

describe('push decoders', () => {
  it('ADVERT carries a 32-byte pubkey', () => {
    const d = decodeFrame(new ByteWriter().u8(Push.ADVERT).bytes(fromHex(PUB)).toBytes());
    expect(d).toEqual({ type: 'advert', publicKey: PUB });
  });

  it('SEND_CONFIRMED', () => {
    const w = new ByteWriter().u8(Push.SEND_CONFIRMED).u32(0xdeadbeef).u32(842);
    const d = decodeFrame(w.toBytes());
    expect(d).toEqual({
      type: 'sendConfirmed',
      confirmed: { ackTag: 0xdeadbeef, roundTripMillis: 842 },
    });
  });

  it('MSG_WAITING', () => {
    expect(decodeFrame(new Uint8Array([Push.MSG_WAITING])).type).toBe('messageWaiting');
  });

  it('unknown code falls back to raw', () => {
    const d = decodeFrame(new Uint8Array([0x77, 1, 2, 3]));
    expect(d).toEqual({ type: 'raw', code: 0x77, payload: new Uint8Array([1, 2, 3]) });
  });
});

describe('hex helpers', () => {
  it('round-trip', () => {
    expect(toHex(fromHex('00ffa1'))).toBe('00ffa1');
  });
});

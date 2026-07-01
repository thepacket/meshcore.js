import { describe, it, expect } from 'vitest';
import { ByteWriter } from '../src/protocol/writer.js';
import { decodeFrame } from '../src/protocol/decode.js';
import * as encode from '../src/protocol/encode.js';
import { Cmd, Resp, AdvType, OUT_PATH_UNKNOWN } from '../src/protocol/constants.js';
import { fromHex, toHex } from '../src/protocol/hex.js';
import { channelSecretFromPsk, pskFromChannelSecret, PUBLIC_CHANNEL } from '../src/channel.js';

const PUB = 'a1b2c3d4e5f6' + '22'.repeat(26);
const SECRET = '000102030405060708090a0b0c0d0e0f';

describe('channel encoders/decoders', () => {
  it('getChannel', () => {
    expect([...encode.getChannel(2)]).toEqual([Cmd.GET_CHANNEL, 2]);
  });

  it('setChannel: idx, name[32], secret[16]', () => {
    const f = encode.setChannel(1, 'public', SECRET);
    expect(f[0]).toBe(Cmd.SET_CHANNEL);
    expect(f[1]).toBe(1);
    expect(f.length).toBe(2 + 32 + 16);
    expect(new TextDecoder().decode(f.slice(2, 8))).toBe('public');
    expect(toHex(f.slice(34))).toBe(SECRET);
  });

  it('decodes CHANNEL_INFO', () => {
    const w = new ByteWriter()
      .u8(Resp.CHANNEL_INFO)
      .u8(0)
      .fixedStr('public', 32)
      .bytes(fromHex(SECRET));
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'channelInfo') throw new Error('wrong type');
    expect(d.channel.index).toBe(0);
    expect(d.channel.name).toBe('public');
    expect(d.channel.secret).toBe(SECRET);
  });
});

describe('channel PSK helpers', () => {
  it('round-trips base64 <-> secret', () => {
    const secret = channelSecretFromPsk(PUBLIC_CHANNEL.psk);
    expect(secret.length).toBe(16);
    expect(pskFromChannelSecret(secret)).toBe(PUBLIC_CHANNEL.psk);
  });

  it('PUBLIC_CHANNEL exposes a 16-byte secret', () => {
    expect(PUBLIC_CHANNEL.secret.length).toBe(16);
  });

  it('rejects a wrong-length PSK', () => {
    expect(() => channelSecretFromPsk('YWJj')).toThrow(); // "abc" -> 3 bytes
  });
});

describe('contact management encoders', () => {
  it('getContactByKey / removeContact / resetPath use full 32-byte key', () => {
    for (const [fn, cmd] of [
      [encode.getContactByKey, Cmd.GET_CONTACT_BY_KEY],
      [encode.removeContact, Cmd.REMOVE_CONTACT],
      [encode.resetPath, Cmd.RESET_PATH],
      [encode.shareContact, Cmd.SHARE_CONTACT],
    ] as const) {
      const f = fn(PUB);
      expect(f[0]).toBe(cmd);
      expect(f.length).toBe(1 + 32);
      expect(toHex(f.slice(1))).toBe(PUB);
    }
  });

  it('addUpdateContact round-trips through the CONTACT decoder', () => {
    const frame = encode.addUpdateContact({
      publicKey: PUB,
      type: AdvType.CHAT,
      flags: 0,
      name: 'Bob',
      outPathLen: OUT_PATH_UNKNOWN,
      lastAdvertTimestamp: 1700,
      gpsLat: -33.5,
      gpsLon: 151.2,
      lastMod: 1701,
    });
    expect(frame[0]).toBe(Cmd.ADD_UPDATE_CONTACT);
    // Re-decode as a CONTACT frame by swapping the leading code byte.
    const asContact = frame.slice();
    asContact[0] = Resp.CONTACT;
    const d = decodeFrame(asContact);
    if (d.type !== 'contact') throw new Error('wrong type');
    expect(d.contact.publicKey).toBe(PUB);
    expect(d.contact.name).toBe('Bob');
    expect(d.contact.type).toBe(AdvType.CHAT);
    expect(d.contact.outPathLen).toBe(OUT_PATH_UNKNOWN);
    expect(d.contact.gpsLat).toBeCloseTo(-33.5, 6);
    expect(d.contact.gpsLon).toBeCloseTo(151.2, 6);
    expect(d.contact.lastMod).toBe(1701);
  });
});

describe('device/radio encoders', () => {
  it('getBatteryAndStorage + decode', () => {
    expect([...encode.getBatteryAndStorage()]).toEqual([Cmd.GET_BATT_AND_STORAGE]);
    const w = new ByteWriter().u8(Resp.BATT_AND_STORAGE).u16(3700).u32(128).u32(1024);
    const d = decodeFrame(w.toBytes());
    if (d.type !== 'batteryAndStorage') throw new Error('wrong type');
    expect(d.info.batteryMillivolts).toBe(3700);
    expect(d.info.storageUsedKb).toBe(128);
    expect(d.info.storageTotalKb).toBe(1024);
  });

  it('reboot carries the "reboot" magic', () => {
    const f = encode.reboot();
    expect(f[0]).toBe(Cmd.REBOOT);
    expect(new TextDecoder().decode(f.slice(1))).toBe('reboot');
  });

  it('setRadioParams uses MHz*1000 / kHz*1000 units', () => {
    const f = encode.setRadioParams({
      freqMHz: 915,
      bandwidthKHz: 250,
      spreadingFactor: 10,
      codingRate: 5,
    });
    const r = decodeFrame(new Uint8Array([Resp.OK])); // sanity that OK decodes
    expect(r.type).toBe('ok');
    // freq LE u32 = 915000, bw = 250000
    expect(f[0]).toBe(Cmd.SET_RADIO_PARAMS);
    const view = new DataView(f.buffer, f.byteOffset);
    expect(view.getUint32(1, true)).toBe(915000);
    expect(view.getUint32(5, true)).toBe(250000);
    expect(f[9]).toBe(10);
    expect(f[10]).toBe(5);
    expect(f.length).toBe(11); // no repeat byte
  });

  it('setRadioParams appends repeat flag when provided', () => {
    const f = encode.setRadioParams({
      freqMHz: 915, bandwidthKHz: 250, spreadingFactor: 10, codingRate: 5, repeat: true,
    });
    expect(f.length).toBe(12);
    expect(f[11]).toBe(1);
  });

  it('setRadioTxPower encodes signed dBm', () => {
    expect([...encode.setRadioTxPower(-5)]).toEqual([Cmd.SET_RADIO_TX_POWER, 0xfb]);
    expect([...encode.setRadioTxPower(22)]).toEqual([Cmd.SET_RADIO_TX_POWER, 22]);
  });
});

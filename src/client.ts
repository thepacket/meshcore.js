/**
 * High-level MeshCore client: handshake, MVP commands, and a typed event model.
 */
import type { Transport } from './transport/transport.js';
import { Connection } from './connection.js';
import { Emitter } from './emitter.js';
import * as encode from './protocol/encode.js';
import type {
  BatteryAndStorage,
  BinaryResponse,
  Channel,
  Contact,
  CurrentTime,
  DecodedFrame,
  DeviceInfo,
  InboundMessage,
  LoginResult,
  NodeResponse,
  SelfInfo,
  SendConfirmed,
  SendResult,
} from './protocol/types.js';
import type { ContactInput, RadioParams } from './protocol/encode.js';
import { ERR_CODE_NAMES } from './protocol/constants.js';
import { fromHex, toHex } from './protocol/hex.js';
import { parseTelemetry, type TelemetryReading } from './telemetry.js';

/** A telemetry response with the raw blob decoded into structured readings. */
export type TelemetryResult = NodeResponse & { readings: TelemetryReading[] };

/** 6-byte public-key prefix (hex) as used to correlate push responses. */
function pubKeyPrefixHex(key: string | Uint8Array): string {
  const bytes = typeof key === 'string' ? fromHex(key) : key;
  return toHex(bytes.subarray(0, 6));
}
import type { MeshCoreCrypto } from './crypto/crypto.js';

/** Error raised when the device replies with RESP.ERR. */
export class MeshCoreError extends Error {
  constructor(
    readonly code: number,
    readonly errorName: string,
  ) {
    super(`MeshCore command failed: ${errorName} (${code})`);
    this.name = 'MeshCoreError';
  }
}

export type MeshCoreEvents = {
  message: [InboundMessage];
  advert: [string]; // public key hex
  newContact: [Contact];
  pathUpdated: [string];
  sendConfirmed: [SendConfirmed];
  login: [LoginResult];
  loginFailed: [string]; // server pubkey prefix
  statusResponse: [NodeResponse];
  telemetryResponse: [NodeResponse];
  binaryResponse: [BinaryResponse];
  contactDeleted: [string];
  contactsFull: [];
  disconnect: [];
};

export interface MeshCoreOptions {
  /** Optional crypto instance for signature verification / key helpers. */
  crypto?: MeshCoreCrypto;
  /** App name reported in the handshake. */
  appName?: string;
  /** Protocol version the app understands (>= 3 enables SNR on messages). */
  appVersion?: number;
  /** Auto-drain the offline queue when the device signals MSG_WAITING (default true). */
  autoSync?: boolean;
}

function expectOk(frame: DecodedFrame): DecodedFrame {
  if (frame.type === 'error') throw new MeshCoreError(frame.error.code, frame.error.name);
  return frame;
}

export class MeshCore {
  private readonly emitter = new Emitter<MeshCoreEvents>();
  private readonly connection: Connection;
  private readonly appName: string;
  private readonly appVersion: number;
  private readonly autoSync: boolean;
  private draining = false;

  /** Populated after {@link connect}. */
  deviceInfo?: DeviceInfo;
  selfInfo?: SelfInfo;

  readonly crypto?: MeshCoreCrypto;

  constructor(
    private readonly transport: Transport,
    options: MeshCoreOptions = {},
  ) {
    this.crypto = options.crypto;
    this.appName = options.appName ?? 'meshcore.js';
    this.appVersion = options.appVersion ?? 3;
    this.autoSync = options.autoSync ?? true;
    this.connection = new Connection(transport);
    this.connection.on('push', (f) => this.routePush(f));
    this.connection.on('disconnect', () => this.emitter.emit('disconnect'));
  }

  on = this.emitter.on.bind(this.emitter);
  once = this.emitter.once.bind(this.emitter);
  off = this.emitter.off.bind(this.emitter);

  get connected(): boolean {
    return this.connection.connected;
  }

  // -- lifecycle ----------------------------------------------------------

  /** Connect the transport and perform the DEVICE_QUERY / APP_START handshake. */
  async connect(): Promise<{ deviceInfo: DeviceInfo; selfInfo: SelfInfo }> {
    await this.transport.connect();

    const info = await this.connection.request(encode.deviceQuery(this.appVersion));
    if (info.type !== 'deviceInfo') {
      throw new Error(`expected deviceInfo, got ${info.type}`);
    }
    this.deviceInfo = info.info;

    const self = await this.connection.request(
      encode.appStart(this.appName, this.appVersion),
    );
    if (self.type !== 'selfInfo') {
      throw new Error(`expected selfInfo, got ${self.type}`);
    }
    this.selfInfo = self.info;

    return { deviceInfo: this.deviceInfo, selfInfo: this.selfInfo };
  }

  async disconnect(): Promise<void> {
    this.connection.dispose();
    await this.transport.disconnect();
  }

  // -- contacts -----------------------------------------------------------

  /** Fetch the contacts list, optionally only those modified since `since`. */
  async getContacts(since?: number): Promise<Contact[]> {
    const frames = await this.connection.requestCollect(
      encode.getContacts(since),
      (f) => f.type === 'endOfContacts' || f.type === 'error',
    );
    const first = frames[0];
    if (first?.type === 'error') throw new MeshCoreError(first.error.code, first.error.name);
    return frames.filter((f) => f.type === 'contact').map((f) => (f as { contact: Contact }).contact);
  }

  // -- messaging ----------------------------------------------------------

  /** Send a direct text message to a contact. Resolves with the ACK tag/timeout. */
  async sendTextMessage(
    publicKey: string | Uint8Array,
    text: string,
    options: { timestamp?: number; txtType?: number; attempt?: number } = {},
  ): Promise<SendResult> {
    const frame = expectOk(
      await this.connection.request(encode.sendTxtMsg({ publicKey, text, ...options })),
    );
    if (frame.type !== 'sent') throw new Error(`expected sent, got ${frame.type}`);
    return frame.result;
  }

  /** Send a group/channel text message (flood mode). */
  async sendChannelMessage(
    channelIdx: number,
    text: string,
    options: { timestamp?: number } = {},
  ): Promise<void> {
    expectOk(
      await this.connection.request(
        encode.sendChannelTxtMsg({ channelIdx, text, ...options }),
      ),
    );
  }

  /** Pull the next queued inbound message, or `null` if the queue is empty. */
  async syncNextMessage(): Promise<InboundMessage | null> {
    const frame = await this.connection.request(encode.syncNextMessage());
    if (frame.type === 'noMoreMessages') return null;
    if (frame.type === 'message') return frame.message;
    if (frame.type === 'error') throw new MeshCoreError(frame.error.code, frame.error.name);
    throw new Error(`expected message, got ${frame.type}`);
  }

  /** Drain all queued inbound messages, emitting `message` for each. */
  async drainMessages(): Promise<InboundMessage[]> {
    const out: InboundMessage[] = [];
    for (;;) {
      const msg = await this.syncNextMessage();
      if (!msg) break;
      out.push(msg);
      this.emitter.emit('message', msg);
    }
    return out;
  }

  /** Fetch a single contact by its full public key, or `null` if not found. */
  async getContactByKey(publicKey: string | Uint8Array): Promise<Contact | null> {
    const frame = await this.connection.request(encode.getContactByKey(publicKey));
    if (frame.type === 'contact') return frame.contact;
    if (frame.type === 'error') {
      if (frame.error.code === 2 /* NOT_FOUND */) return null;
      throw new MeshCoreError(frame.error.code, frame.error.name);
    }
    throw new Error(`expected contact, got ${frame.type}`);
  }

  /** Add or update a contact. */
  async addOrUpdateContact(contact: ContactInput): Promise<void> {
    expectOk(await this.connection.request(encode.addUpdateContact(contact)));
  }

  /** Remove a contact by its public key. */
  async removeContact(publicKey: string | Uint8Array): Promise<void> {
    expectOk(await this.connection.request(encode.removeContact(publicKey)));
  }

  /** Forget the cached out-path to a contact (revert to flood routing). */
  async resetPath(publicKey: string | Uint8Array): Promise<void> {
    expectOk(await this.connection.request(encode.resetPath(publicKey)));
  }

  /** Re-share a contact via a zero-hop advertisement. */
  async shareContact(publicKey: string | Uint8Array): Promise<void> {
    expectOk(await this.connection.request(encode.shareContact(publicKey)));
  }

  // -- channels -----------------------------------------------------------

  /** Read a group channel by index, or `null` if the slot is empty. */
  async getChannel(index: number): Promise<Channel | null> {
    const frame = await this.connection.request(encode.getChannel(index));
    if (frame.type === 'channelInfo') return frame.channel;
    if (frame.type === 'error') {
      if (frame.error.code === 2 /* NOT_FOUND */) return null;
      throw new MeshCoreError(frame.error.code, frame.error.name);
    }
    throw new Error(`expected channelInfo, got ${frame.type}`);
  }

  /** Configure a group channel (name + 16-byte secret). */
  async setChannel(index: number, name: string, secret: string | Uint8Array): Promise<void> {
    expectOk(await this.connection.request(encode.setChannel(index, name, secret)));
  }

  // -- login / status / telemetry ----------------------------------------

  /**
   * Log in to a repeater or room server. Sends the request, waits for the
   * device to confirm it queued, then resolves when the correlated
   * LOGIN_SUCCESS push arrives (rejects on LOGIN_FAIL or timeout).
   */
  async login(
    publicKey: string | Uint8Array,
    password: string,
    options: { timeoutMs?: number } = {},
  ): Promise<LoginResult> {
    const prefix = pubKeyPrefixHex(publicKey);
    const timeoutMs = options.timeoutMs ?? 30_000;
    const pushed = this.waitForPush(
      (f) =>
        (f.type === 'loginSuccess' && f.result.pubKeyPrefix === prefix) ||
        (f.type === 'loginFail' && f.pubKeyPrefix === prefix),
      timeoutMs,
    );
    expectOk(await this.connection.request(encode.sendLogin(publicKey, password)));
    const f = await pushed;
    if (f.type === 'loginFail') throw new Error(`MeshCore: login rejected by ${prefix}`);
    if (f.type !== 'loginSuccess') throw new Error(`unexpected ${f.type}`);
    return f.result;
  }

  /** End a repeater/room-server session. */
  async logout(publicKey: string | Uint8Array): Promise<void> {
    expectOk(await this.connection.request(encode.logout(publicKey)));
  }

  /** True if the device currently has an active session to the node. */
  async hasConnection(publicKey: string | Uint8Array): Promise<boolean> {
    const f = await this.connection.request(encode.hasConnection(publicKey));
    if (f.type === 'ok') return true;
    if (f.type === 'error') return false;
    throw new Error(`unexpected ${f.type}`);
  }

  /** Request status from a repeater/sensor node; resolves with the raw blob. */
  async requestStatus(
    publicKey: string | Uint8Array,
    options: { timeoutMs?: number } = {},
  ): Promise<NodeResponse> {
    const prefix = pubKeyPrefixHex(publicKey);
    const pushed = this.waitForPush(
      (f) => f.type === 'statusResponse' && f.response.pubKeyPrefix === prefix,
      options.timeoutMs ?? 30_000,
    );
    expectOk(await this.connection.request(encode.sendStatusReq(publicKey)));
    const f = await pushed;
    if (f.type !== 'statusResponse') throw new Error(`unexpected ${f.type}`);
    return f.response;
  }

  /** Request telemetry from a remote node; resolves with parsed readings. */
  async requestTelemetry(
    publicKey: string | Uint8Array,
    options: { timeoutMs?: number } = {},
  ): Promise<TelemetryResult> {
    const prefix = pubKeyPrefixHex(publicKey);
    const pushed = this.waitForPush(
      (f) => f.type === 'telemetryResponse' && f.response.pubKeyPrefix === prefix,
      options.timeoutMs ?? 30_000,
    );
    expectOk(await this.connection.request(encode.sendTelemetryReq(publicKey)));
    const f = await pushed;
    if (f.type !== 'telemetryResponse') throw new Error(`unexpected ${f.type}`);
    return { ...f.response, readings: parseTelemetry(f.response.data) };
  }

  /** Read this device's own telemetry (replies immediately with a push). */
  async getSelfTelemetry(options: { timeoutMs?: number } = {}): Promise<TelemetryResult> {
    if (!this.selfInfo) throw new Error('call connect() first');
    const prefix = this.selfInfo.publicKey.slice(0, 12); // 6-byte prefix hex
    const pushed = this.waitForPush(
      (f) => f.type === 'telemetryResponse' && f.response.pubKeyPrefix === prefix,
      options.timeoutMs ?? 10_000,
    );
    await this.connection.send(encode.sendSelfTelemetryReq());
    const f = await pushed;
    if (f.type !== 'telemetryResponse') throw new Error(`unexpected ${f.type}`);
    return { ...f.response, readings: parseTelemetry(f.response.data) };
  }

  // -- device / advertising ----------------------------------------------

  /** Read the device clock (epoch seconds). */
  async getDeviceTime(): Promise<CurrentTime> {
    const frame = await this.connection.request(encode.getDeviceTime());
    if (frame.type !== 'currentTime') throw new Error(`expected currentTime, got ${frame.type}`);
    return frame.time;
  }

  /** Set the device clock. */
  async setDeviceTime(epochSeconds: number): Promise<void> {
    expectOk(await this.connection.request(encode.setDeviceTime(epochSeconds)));
  }

  /** Broadcast this node's advertisement (`flood` = network-wide, else zero-hop). */
  async sendSelfAdvert(flood = false): Promise<void> {
    expectOk(await this.connection.request(encode.sendSelfAdvert(flood)));
  }

  /** Update the node name used in advertisements. */
  async setAdvertName(name: string): Promise<void> {
    expectOk(await this.connection.request(encode.setAdvertName(name)));
  }

  /** Query battery voltage and flash storage usage. */
  async getBatteryAndStorage(): Promise<BatteryAndStorage> {
    const frame = await this.connection.request(encode.getBatteryAndStorage());
    if (frame.type !== 'batteryAndStorage') {
      throw new Error(`expected batteryAndStorage, got ${frame.type}`);
    }
    return frame.info;
  }

  /** Set LoRa radio parameters (frequency, bandwidth, SF, CR). */
  async setRadioParams(params: RadioParams): Promise<void> {
    expectOk(await this.connection.request(encode.setRadioParams(params)));
  }

  /** Set radio transmit power in dBm. */
  async setRadioTxPower(dbm: number): Promise<void> {
    expectOk(await this.connection.request(encode.setRadioTxPower(dbm)));
  }

  /**
   * Reboot the device. The device does not reply (it reboots immediately), so
   * this is fire-and-forget and the transport will disconnect shortly after.
   */
  async reboot(): Promise<void> {
    await this.connection.send(encode.reboot());
  }

  // -- internals ----------------------------------------------------------

  /** Resolve when a push frame matching `predicate` arrives (or reject on timeout). */
  private waitForPush(
    predicate: (f: DecodedFrame) => boolean,
    timeoutMs: number,
  ): Promise<DecodedFrame> {
    return new Promise<DecodedFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('MeshCore: timed out waiting for response'));
      }, timeoutMs);
      const off = this.connection.on('push', (f) => {
        if (predicate(f)) {
          clearTimeout(timer);
          off();
          resolve(f);
        }
      });
    });
  }

  private routePush(frame: DecodedFrame): void {
    switch (frame.type) {
      case 'advert':
        this.emitter.emit('advert', frame.publicKey);
        break;
      case 'newAdvert':
        this.emitter.emit('newContact', frame.contact);
        break;
      case 'pathUpdated':
        this.emitter.emit('pathUpdated', frame.publicKey);
        break;
      case 'sendConfirmed':
        this.emitter.emit('sendConfirmed', frame.confirmed);
        break;
      case 'loginSuccess':
        this.emitter.emit('login', frame.result);
        break;
      case 'loginFail':
        this.emitter.emit('loginFailed', frame.pubKeyPrefix);
        break;
      case 'statusResponse':
        this.emitter.emit('statusResponse', frame.response);
        break;
      case 'telemetryResponse':
        this.emitter.emit('telemetryResponse', frame.response);
        break;
      case 'binaryResponse':
        this.emitter.emit('binaryResponse', frame.response);
        break;
      case 'contactDeleted':
        this.emitter.emit('contactDeleted', frame.publicKey);
        break;
      case 'contactsFull':
        this.emitter.emit('contactsFull');
        break;
      case 'messageWaiting':
        if (this.autoSync) void this.autoDrain();
        break;
      default:
        break;
    }
  }

  private async autoDrain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      await this.drainMessages();
    } catch {
      // Surface via 'disconnect'/command errors elsewhere; don't crash the push path.
    } finally {
      this.draining = false;
    }
  }
}

export { ERR_CODE_NAMES };

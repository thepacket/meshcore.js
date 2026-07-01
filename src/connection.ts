/**
 * Frame router over a {@link Transport}.
 *
 * The Companion Radio Protocol is request/response: each command yields one (or,
 * for streamed commands, several) response frames, while push frames (code >=
 * 0x80) may arrive at any time. This class serialises commands, correlates
 * responses, and routes pushes to listeners.
 */
import type { Transport } from './transport/transport.js';
import { decodeFrame } from './protocol/decode.js';
import { PUSH_CODE_MIN } from './protocol/constants.js';
import type { DecodedFrame } from './protocol/types.js';
import { Emitter } from './emitter.js';

type ConnectionEvents = {
  /** Any decoded push frame. */
  push: [DecodedFrame];
  /** A non-push frame arrived with no pending request (protocol desync). */
  unhandled: [DecodedFrame];
  /** The transport dropped. */
  disconnect: [];
};

interface Collector {
  frames: DecodedFrame[];
  isTerminal: (f: DecodedFrame) => boolean;
  resolve: (frames: DecodedFrame[]) => void;
}

export class Connection {
  private readonly emitter = new Emitter<ConnectionEvents>();
  private readonly waiters: Array<(f: DecodedFrame) => void> = [];
  private collector: Collector | null = null;
  /** Command serialisation lock. */
  private lock: Promise<void> = Promise.resolve();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly transport: Transport) {
    this.unsubscribers.push(transport.onFrame((raw) => this.handleFrame(raw)));
    this.unsubscribers.push(transport.onDisconnect(() => this.emitter.emit('disconnect')));
  }

  on = this.emitter.on.bind(this.emitter);
  once = this.emitter.once.bind(this.emitter);
  off = this.emitter.off.bind(this.emitter);

  get connected(): boolean {
    return this.transport.connected;
  }

  private handleFrame(raw: Uint8Array): void {
    // Route pushes purely on the code byte, before decoding cost.
    if (raw.length > 0 && raw[0]! >= PUSH_CODE_MIN) {
      this.emitter.emit('push', decodeFrame(raw));
      return;
    }
    const decoded = decodeFrame(raw);
    if (this.collector) {
      this.collector.frames.push(decoded);
      if (this.collector.isTerminal(decoded)) {
        const c = this.collector;
        this.collector = null;
        c.resolve(c.frames);
      }
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter(decoded);
    else this.emitter.emit('unhandled', decoded);
  }

  /** Run `fn` with exclusive access to the command channel. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    // Keep the chain alive regardless of individual command failures.
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Send a command and resolve with the next single response frame. */
  request(frame: Uint8Array, timeoutMs = 10_000): Promise<DecodedFrame> {
    return this.serialize(
      () =>
        new Promise<DecodedFrame>((resolve, reject) => {
          const timer = setTimeout(() => {
            const i = this.waiters.indexOf(onFrame);
            if (i >= 0) this.waiters.splice(i, 1);
            reject(new Error('MeshCore: command timed out'));
          }, timeoutMs);
          const onFrame = (f: DecodedFrame): void => {
            clearTimeout(timer);
            resolve(f);
          };
          this.waiters.push(onFrame);
          this.transport.send(frame).catch((err) => {
            clearTimeout(timer);
            const i = this.waiters.indexOf(onFrame);
            if (i >= 0) this.waiters.splice(i, 1);
            reject(err);
          });
        }),
    );
  }

  /**
   * Send a command and collect response frames until `isTerminal` matches
   * (inclusive). Used for streamed replies like the contacts list.
   */
  requestCollect(
    frame: Uint8Array,
    isTerminal: (f: DecodedFrame) => boolean,
    timeoutMs = 30_000,
  ): Promise<DecodedFrame[]> {
    return this.serialize(
      () =>
        new Promise<DecodedFrame[]>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.collector = null;
            reject(new Error('MeshCore: streamed command timed out'));
          }, timeoutMs);
          this.collector = {
            frames: [],
            isTerminal,
            resolve: (frames) => {
              clearTimeout(timer);
              resolve(frames);
            },
          };
          this.transport.send(frame).catch((err) => {
            clearTimeout(timer);
            this.collector = null;
            reject(err);
          });
        }),
    );
  }

  /** Fire-and-forget send (no response expected). */
  send(frame: Uint8Array): Promise<void> {
    return this.serialize(() => this.transport.send(frame));
  }

  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.emitter.removeAll();
  }
}

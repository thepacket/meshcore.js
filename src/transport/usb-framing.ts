/**
 * USB/serial framing for the Companion Radio Protocol.
 *
 * Unlike BLE (one frame per characteristic value), the USB serial link is a
 * byte stream where each frame is length-prefixed. From the firmware
 * (`src/helpers/ArduinoSerialInterface.cpp`), as seen from the **app**:
 *
 *   - app -> device: `<` (0x3C) + len_LSB + len_MSB + payload
 *   - device -> app: `>` (0x3E) + len_LSB + len_MSB + payload
 *
 * Length is a little-endian uint16 of the payload size.
 */

export const FRAME_TO_DEVICE = 0x3c; // '<'
export const FRAME_FROM_DEVICE = 0x3e; // '>'

/** Upper bound on a single frame; larger declared lengths are treated as a
 * desync and cause a resync rather than an unbounded allocation. */
export const MAX_USB_FRAME_SIZE = 1024;

/** Wrap a payload in an app -> device (`<`) USB frame. */
export function encodeUsbFrame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(3 + payload.length);
  out[0] = FRAME_TO_DEVICE;
  out[1] = payload.length & 0xff;
  out[2] = (payload.length >> 8) & 0xff;
  out.set(payload, 3);
  return out;
}

const enum State {
  Idle,
  HeaderFound,
  Len1Found,
  Collecting,
}

/**
 * Incremental parser for the device -> app (`>`) byte stream. Feed it chunks
 * (of any size, including splits mid-frame) and it returns any complete frames.
 */
export class UsbFrameParser {
  private state = State.Idle;
  private frameLen = 0;
  private buf: Uint8Array = new Uint8Array(0);
  private rxLen = 0;

  /** Push a chunk of received bytes; returns zero or more complete frames. */
  push(chunk: Uint8Array): Uint8Array[] {
    const frames: Uint8Array[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i]!;
      switch (this.state) {
        case State.Idle:
          if (c === FRAME_FROM_DEVICE) this.state = State.HeaderFound;
          break;
        case State.HeaderFound:
          this.frameLen = c; // LSB
          this.state = State.Len1Found;
          break;
        case State.Len1Found:
          this.frameLen |= c << 8; // MSB
          if (this.frameLen === 0) {
            this.state = State.Idle; // empty frame — ignore
          } else if (this.frameLen > MAX_USB_FRAME_SIZE) {
            this.state = State.Idle; // implausible: resync
          } else {
            this.buf = new Uint8Array(this.frameLen);
            this.rxLen = 0;
            this.state = State.Collecting;
          }
          break;
        case State.Collecting:
          this.buf[this.rxLen++] = c;
          if (this.rxLen >= this.frameLen) {
            frames.push(this.buf);
            this.state = State.Idle;
          }
          break;
      }
    }
    return frames;
  }

  /** Discard any partially-received frame and return to scanning. */
  reset(): void {
    this.state = State.Idle;
    this.rxLen = 0;
    this.frameLen = 0;
  }
}

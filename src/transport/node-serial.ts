/**
 * Node.js serial (USB) transport for MeshCore companion devices.
 *
 * Uses the length-prefixed USB framing (see usb-framing.ts). The `serialport`
 * package is an optional peer dependency, imported lazily so browser bundles
 * and BLE-only users are unaffected. A compatible port may also be injected
 * (useful for testing or custom stream sources).
 */
import type { Transport } from './transport.js';
import { UsbFrameParser, encodeUsbFrame } from './usb-framing.js';

/** Minimal surface of a `serialport` SerialPort that we depend on. */
export interface SerialPortLike {
  readonly isOpen: boolean;
  open(callback?: (err: Error | null) => void): void;
  close(callback?: (err: Error | null) => void): void;
  write(data: Uint8Array, callback?: (err: Error | null | undefined) => void): boolean;
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export interface NodeSerialOptions {
  /** Serial device path, e.g. "/dev/tty.usbmodem1101" or "COM3". */
  path?: string;
  /** Baud rate (default 115200). */
  baudRate?: number;
  /** Inject an already-constructed port (skips the `serialport` import). */
  port?: SerialPortLike;
}

export class NodeSerialTransport implements Transport {
  private port?: SerialPortLike;
  private readonly parser = new UsbFrameParser();
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private isConnected = false;

  constructor(private readonly options: NodeSerialOptions = {}) {
    this.port = options.port;
  }

  get connected(): boolean {
    return this.isConnected && (this.port?.isOpen ?? false);
  }

  /** List available serial ports (requires the `serialport` package). */
  static async list(): Promise<Array<{ path: string; manufacturer?: string }>> {
    const { SerialPort } = await importSerialPort();
    return SerialPort.list();
  }

  async connect(): Promise<void> {
    if (!this.port) {
      if (!this.options.path) throw new Error('NodeSerialTransport: `path` is required');
      const { SerialPort } = await importSerialPort();
      this.port = new SerialPort({
        path: this.options.path,
        baudRate: this.options.baudRate ?? 115200,
        autoOpen: false,
      }) as unknown as SerialPortLike;
    }

    const port = this.port;
    port.on('data', (chunk) => {
      for (const frame of this.parser.push(chunk)) {
        for (const l of [...this.frameListeners]) l(frame);
      }
    });
    port.on('close', () => {
      this.isConnected = false;
      for (const l of [...this.disconnectListeners]) l();
    });
    port.on('error', () => {
      /* surfaced via write callbacks / close */
    });

    if (!port.isOpen) {
      await new Promise<void>((resolve, reject) => {
        port.open((err) => (err ? reject(err) : resolve()));
      });
    }
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    const port = this.port;
    if (!port || !port.isOpen) return;
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.port || !this.connected) throw new Error('transport not connected');
    const port = this.port;
    const wire = encodeUsbFrame(frame);
    await new Promise<void>((resolve, reject) => {
      port.write(wire, (err) => (err ? reject(err) : resolve()));
    });
  }

  onFrame(listener: (frame: Uint8Array) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }
}

interface SerialPortModule {
  SerialPort: {
    new (opts: { path: string; baudRate: number; autoOpen: boolean }): unknown;
    list(): Promise<Array<{ path: string; manufacturer?: string }>>;
  };
}

async function importSerialPort(): Promise<SerialPortModule> {
  try {
    // @ts-ignore — optional peer dependency, may not be installed
    return (await import(/* @vite-ignore */ 'serialport')) as unknown as SerialPortModule;
  } catch {
    throw new Error(
      "NodeSerialTransport requires the 'serialport' package. Install it with: npm i serialport",
    );
  }
}

/**
 * Web Bluetooth transport for MeshCore companion devices.
 *
 * MeshCore exposes the Nordic UART Service (NUS):
 *   - Service  6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   - RX       6E400002-… (write)  — app -> device
 *   - TX       6E400003-… (notify) — device -> app
 *
 * Each characteristic value is treated as one whole protocol frame (BLE framing
 * per the Companion Radio Protocol; the USB `>`/`<` length prefix is not used).
 */
import type { Transport } from './transport.js';

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX_CHARACTERISTIC = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX_CHARACTERISTIC = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export interface WebBluetoothOptions {
  /** Filter advertised device names by prefix (e.g. "MeshCore"). */
  namePrefix?: string;
  /** Provide an already-selected device (skip the chooser). */
  device?: BluetoothDevice;
}

export class WebBluetoothTransport implements Transport {
  private device?: BluetoothDevice;
  private rx?: BluetoothRemoteGATTCharacteristic;
  private tx?: BluetoothRemoteGATTCharacteristic;
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly onValueChanged = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const frame = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    for (const l of [...this.frameListeners]) l(frame);
  };
  private readonly onGattDisconnected = (): void => {
    for (const l of [...this.disconnectListeners]) l();
  };

  constructor(private readonly options: WebBluetoothOptions = {}) {
    this.device = options.device;
  }

  get connected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  async connect(): Promise<void> {
    if (!this.device) {
      const bluetooth = (globalThis.navigator as Navigator | undefined)?.bluetooth;
      if (!bluetooth) {
        throw new Error('Web Bluetooth is not available in this environment');
      }
      const filters: BluetoothLEScanFilter[] = this.options.namePrefix
        ? [{ namePrefix: this.options.namePrefix }]
        : [{ services: [NUS_SERVICE] }];
      this.device = await bluetooth.requestDevice({
        filters,
        optionalServices: [NUS_SERVICE],
      });
    }

    const gatt = this.device.gatt;
    if (!gatt) throw new Error('selected device has no GATT server');

    this.device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
    const server = await gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    this.rx = await service.getCharacteristic(NUS_RX_CHARACTERISTIC);
    this.tx = await service.getCharacteristic(NUS_TX_CHARACTERISTIC);

    this.tx.addEventListener('characteristicvaluechanged', this.onValueChanged);
    await this.tx.startNotifications();
  }

  async disconnect(): Promise<void> {
    this.tx?.removeEventListener('characteristicvaluechanged', this.onValueChanged);
    try {
      await this.tx?.stopNotifications();
    } catch {
      // ignore — device may already be gone
    }
    this.device?.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
    this.device?.gatt?.disconnect();
    this.rx = undefined;
    this.tx = undefined;
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.rx) throw new Error('transport not connected');
    // The browser performs a GATT long-write, fragmenting across the ATT MTU;
    // the device reassembles it into a single characteristic value (one frame).
    // Copy into a fresh ArrayBuffer-backed view to satisfy BufferSource typing.
    const buf = frame.slice() as Uint8Array<ArrayBuffer>;
    if (this.rx.writeValueWithoutResponse) {
      await this.rx.writeValueWithoutResponse(buf);
    } else {
      await this.rx.writeValue(buf);
    }
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

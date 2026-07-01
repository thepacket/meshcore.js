/**
 * Transport abstraction over the Companion Radio Protocol link.
 *
 * A transport delivers and receives whole protocol *frames* (the framing/MTU
 * details are the transport's concern). The Web Bluetooth transport treats each
 * BLE characteristic value as one frame; a future USB/serial transport would
 * handle the `>`/`<` length-prefixed framing internally.
 */
export interface Transport {
  /** Establish the link. Resolves once frames can be sent/received. */
  connect(): Promise<void>;

  /** Tear down the link. */
  disconnect(): Promise<void>;

  /** True while the underlying link is usable. */
  readonly connected: boolean;

  /** Send one whole frame (app -> device). */
  send(frame: Uint8Array): Promise<void>;

  /** Register a listener for inbound frames (device -> app). Returns an unsubscribe fn. */
  onFrame(listener: (frame: Uint8Array) => void): () => void;

  /** Register a listener for unexpected disconnects. Returns an unsubscribe fn. */
  onDisconnect(listener: () => void): () => void;
}

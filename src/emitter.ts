/**
 * Minimal typed event emitter (browser + node, no dependencies).
 *
 * `Events` maps event name -> listener argument tuple.
 */
// Internal listener storage is intentionally loosely typed; the public methods
// preserve full type safety for callers.
type AnyListener = (...args: unknown[]) => void;

export class Emitter<Events extends Record<string, unknown[]>> {
  private readonly listeners = new Map<keyof Events, Set<AnyListener>>();

  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as AnyListener);
    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): void {
    this.listeners.get(event)?.delete(listener as AnyListener);
  }

  once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): () => void {
    const wrapped = (...args: Events[K]): void => {
      off();
      listener(...args);
    };
    const off = this.on(event, wrapped);
    return off;
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy so listeners can unsubscribe during emit.
    for (const l of [...set]) l(...args);
  }

  removeAll(): void {
    this.listeners.clear();
  }
}

import type { NetInfoPort } from "@/domain/ports/netInfo.port";

/**
 * In-memory `NetInfoPort` for container + hook tests.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Offline UX on
 *       subscription screens
 *
 * Tests dial in the current connection state via `setConnected(boolean)`;
 * the adapter notifies all subscribers on every transition. Initial
 * default is `true` (online) — flip explicitly before mount for an
 * "offline at startup" scenario, or call `setConnected(false)` after
 * subscription to simulate the user dropping connection mid-flow.
 *
 * Mirrors the pattern from `MockPaymentsAdapter` — tests own the state
 * and inspect post-conditions.
 */
export class InMemoryNetInfoAdapter implements NetInfoPort {
  private connected: boolean;
  private listeners: Set<(connected: boolean) => void> = new Set();

  constructor(initialConnected: boolean = true) {
    this.connected = initialConnected;
  }

  /**
   * Force the adapter's connectivity state. Fires all active
   * subscribers IFF the state actually changed (no double-fire on
   * idempotent flips, which would race React's setState in containers).
   */
  setConnected(next: boolean): void {
    if (this.connected === next) return;
    this.connected = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  async isConnected(): Promise<boolean> {
    return this.connected;
  }

  subscribe(listener: (connected: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test-only: how many active subscribers (for leak assertions). */
  get subscriberCount(): number {
    return this.listeners.size;
  }
}

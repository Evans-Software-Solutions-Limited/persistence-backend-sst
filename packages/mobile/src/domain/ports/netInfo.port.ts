/**
 * NetInfoPort — abstraction over the platform's network-reachability API.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Offline UX on
 *       subscription screens
 * Satisfies: requirements.md AC 11.1
 *
 * Wrapping `@react-native-community/netinfo` behind a port keeps it out
 * of the `useOnlineStatus` hook's import graph, which means:
 *
 * 1. Tests can inject an `InMemoryNetInfoAdapter` via the existing
 *    `Adapters` context — no need to mock the package at the jest level.
 * 2. The hook stays free of native module imports, which jest-expo's
 *    transform pipeline otherwise has to whitelist.
 *
 * Implementations:
 *   - `RNNetInfoAdapter` (prod, `adapters/netInfo/rnNetInfo.adapter.ts`)
 *   - `InMemoryNetInfoAdapter` (tests,
 *     `adapters/netInfo/__tests__/InMemoryNetInfoAdapter.ts`)
 */
export interface NetInfoPort {
  /**
   * Returns the current connectivity state. `true` when the device is
   * both connected to a network AND that network is reachable (i.e. the
   * legacy `isInternetReachable` semantics — `NetInfo` reports `true`
   * even when behind a captive portal otherwise).
   *
   * Returns a Promise to match `NetInfo.fetch()` shape. Synchronous
   * consumers should subscribe via `subscribe` instead.
   */
  isConnected(): Promise<boolean>;

  /**
   * Subscribes to connectivity transitions. The listener is invoked
   * with the new `connected` boolean on every transition (and may be
   * invoked once on subscribe with the current value — adapters
   * document their own semantics there).
   *
   * Returns an `unsubscribe` function the caller MUST invoke on
   * cleanup to prevent leaks (typical RN pattern).
   */
  subscribe(listener: (connected: boolean) => void): () => void;
}

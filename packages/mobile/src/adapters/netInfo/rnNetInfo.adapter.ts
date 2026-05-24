import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import type { NetInfoPort } from "@/domain/ports/netInfo.port";

/**
 * Production `NetInfoPort` backed by `@react-native-community/netinfo`.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Offline UX on
 *       subscription screens
 * Satisfies: requirements.md AC 11.1
 *
 * Treats "connected" as `isConnected === true && isInternetReachable !== false`.
 * `isInternetReachable` is `null` until the first probe completes, so we
 * accept `null` as "online enough to try" — the failure case (truly
 * offline) is the one we need to detect fast, and `isConnected` is the
 * faster signal on RN's side. Only an explicit `false` from
 * `isInternetReachable` (captive portals, airline mode with WiFi-only
 * routers, etc.) downgrades to offline.
 */
function stateToOnline(state: NetInfoState): boolean {
  if (state.isConnected !== true) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

export class RNNetInfoAdapter implements NetInfoPort {
  async isConnected(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return stateToOnline(state);
  }

  subscribe(listener: (connected: boolean) => void): () => void {
    return NetInfo.addEventListener((state) => {
      listener(stateToOnline(state));
    });
  }
}

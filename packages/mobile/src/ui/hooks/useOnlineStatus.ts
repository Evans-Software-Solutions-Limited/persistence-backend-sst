import { useEffect, useState } from "react";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * Returns `true` when the device is online (per the configured
 * `NetInfoPort` adapter), `false` otherwise.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Offline UX on
 *       subscription screens
 * Satisfies: requirements.md AC 11.1
 *
 * - Initial render returns `true` (optimistic — same default as
 *   `MySubscription` cached state). The first `subscribe` callback
 *   refines it once the underlying adapter probes the platform.
 * - Subsequent `setConnected` transitions on the adapter (RN's
 *   `addEventListener` callback OR in-memory test `setConnected`) flip
 *   the value.
 * - Cleans up the subscription on unmount; multiple consumers don't
 *   leak listeners.
 *
 * Why optimistic-default-`true` not `null`:
 *   - The container's pre-flight check should NOT block on the first
 *     network probe. If the probe never resolves (jest, captive portal),
 *     the user sits on a doomed loader. Default-online + downgrade-on-
 *     transition keeps the happy path snappy.
 *   - Brad's explicit call: this is real-user UX, not abuse defense.
 *     A user who taps Subscribe in the first 50ms of a cold start
 *     should hit Apple Pay just like before.
 */
export function useOnlineStatus(): boolean {
  const { netInfo } = useAdapters();
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    let mounted = true;
    let subscribeFired = false;

    // Kick off a one-shot probe; refines the initial-render optimistic
    // default — UNLESS the subscribe stream has already produced a
    // value, in which case the probe's snapshot is stale and must not
    // clobber the fresher signal (Inspector Brad PR #72 medium-severity
    // find — sweep #1).
    netInfo
      .isConnected()
      .then((connected) => {
        if (mounted && !subscribeFired) setOnline(connected);
      })
      .catch(() => {
        // Swallow probe failures — we default to online and let the
        // subscription event stream correct us. Any thrown error here
        // would otherwise surface in the React tree as an unhandled
        // promise rejection.
      });

    const unsubscribe = netInfo.subscribe((connected) => {
      if (mounted) {
        subscribeFired = true;
        setOnline(connected);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [netInfo]);

  return online;
}

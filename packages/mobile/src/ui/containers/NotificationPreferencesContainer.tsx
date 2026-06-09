import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Linking } from "react-native";
import { useRouter } from "expo-router";

import type { NotificationType } from "@/domain/models/notification";
import type { NotificationPreferences } from "@/domain/models/notification-preferences";
import {
  getPreferencesQuery,
  refreshPreferences,
} from "@/application/notifications/queries/preferences.query";
import { updateNotificationPreferencesCommand } from "@/application/notifications/commands/update-preferences.command";
import { NotificationPreferencesPresenter } from "@/ui/presenters/NotificationPreferencesPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * <NotificationPreferencesContainer> — offline-first preferences wiring.
 *
 * Reads the cached opt-in map synchronously and refreshes from the server
 * on open. Toggles are optimistic (cache + enqueue; the sync worker flushes
 * the partial-merge POST and resets the cache to the server's merged
 * column). Surfaces a permission-denial banner when OS notifications are
 * off.
 *
 * Revised (Inspector Brad): we no longer POST `DEFAULT_OPT_IN` on a null
 * cache. That branch fired not just on first-ever open but on every
 * reinstall / data-wipe / post-sign-out `clearAll` — and an all-true merge
 * would silently re-enable categories the user had explicitly disabled on
 * the server. Instead we just `refreshPreferences`: existing users get
 * their stored prefs back, and brand-new users get an empty map that
 * `isTypeEnabled` already reads as "all on" (so AC 3.7's UI default holds
 * without a destructive write). The first explicit toggle drives the first
 * server write.
 *
 * Spec: specs/09-notifications-social/design.md § NotificationPreferencesPresenter
 *       requirements.md STORY-003 (AC 3.7 default-write reconciled — see above)
 */

export function NotificationPreferencesContainer() {
  const { api, storage, notifications } = useAdapters();
  const router = useRouter();

  const [version, setVersion] = useState(0);
  const reread = useCallback(() => setVersion((v) => v + 1), []);
  const [permissionGranted, setPermissionGranted] = useState(true);

  const preferences = useMemo<NotificationPreferences>(() => {
    void version;
    return getPreferencesQuery(storage) ?? {};
  }, [storage, version]);

  // Background refresh of the stored prefs from the server (once on open).
  // No first-open default write — see the Inspector Brad note in the header.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await refreshPreferences(api, storage);
      if (!cancelled && result.ok) reread();
    })();
    return () => {
      cancelled = true;
    };
  }, [api, storage, reread]);

  // Permission state: read on mount AND every time the app returns to the
  // foreground. The banner deep-links the user to OS Settings; when they
  // enable notifications and come back, the app foregrounds but this screen
  // never unmounted — a mount-only read would leave the banner falsely
  // showing "off". AppState 'active' is the same trigger useSyncWorker uses
  // for "returned from another app" (Inspector Brad).
  useEffect(() => {
    let cancelled = false;
    const readPermission = async () => {
      const status = await notifications.getPermissionStatus();
      if (!cancelled) setPermissionGranted(status === "granted");
    };
    void readPermission();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void readPermission();
    });
    return () => {
      cancelled = true;
      // `addEventListener` returns a subscription on RN 0.65+, but guard
      // defensively (older RN / test mocks can return undefined).
      sub?.remove?.();
    };
  }, [notifications]);

  const onToggle = useCallback(
    (type: NotificationType, enabled: boolean) => {
      updateNotificationPreferencesCommand(storage, { [type]: enabled });
      reread();
    },
    [storage, reread],
  );

  const onOpenSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <NotificationPreferencesPresenter
      preferences={preferences}
      onToggle={onToggle}
      permissionGranted={permissionGranted}
      onOpenSettings={onOpenSettings}
      onBack={onBack}
    />
  );
}

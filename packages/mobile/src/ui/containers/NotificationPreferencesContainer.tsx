import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking } from "react-native";
import { useRouter } from "expo-router";

import type { NotificationType } from "@/domain/models/notification";
import {
  DEFAULT_OPT_IN,
  type NotificationPreferences,
} from "@/domain/models/notification-preferences";
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
 * Reads the cached opt-in map synchronously, writes `DEFAULT_OPT_IN` on
 * first-ever open (AC 3.7), and toggles optimistically (cache + enqueue;
 * the sync worker flushes the partial-merge POST and resets the cache to
 * the server's merged column). Surfaces a permission-denial banner when OS
 * notifications are off.
 *
 * Spec: specs/09-notifications-social/design.md § NotificationPreferencesPresenter
 *       requirements.md STORY-003
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

  // First-open default write OR background refresh, plus a permission read.
  useEffect(() => {
    let cancelled = false;

    if (getPreferencesQuery(storage) === null) {
      // First time this device has opened Preferences — persist the opt-in
      // defaults so the stored column matches the UI. We deliberately do
      // NOT GET-refresh here: the enqueued POST returns the merged column
      // on flush (captured by the sync worker), and a server that has no
      // row yet would otherwise clobber the just-written defaults.
      updateNotificationPreferencesCommand(storage, DEFAULT_OPT_IN);
      reread();
    } else {
      void (async () => {
        const result = await refreshPreferences(api, storage);
        if (!cancelled && result.ok) reread();
      })();
    }

    void (async () => {
      const status = await notifications.getPermissionStatus();
      if (!cancelled) setPermissionGranted(status === "granted");
    })();

    return () => {
      cancelled = true;
    };
  }, [api, storage, notifications, reread]);

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

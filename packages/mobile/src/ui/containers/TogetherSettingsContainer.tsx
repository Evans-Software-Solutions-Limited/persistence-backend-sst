import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useTogetherSettings } from "@/state/together-settings";
import { TogetherSettingsPresenter } from "@/ui/presenters/TogetherSettingsPresenter";
import { loadPartners } from "./TogetherHubContainer";
import { useLiveTogetherSharing } from "@/ui/hooks/useLiveTogetherSharing";
import type { TogetherSocialApi } from "@/domain/ports/togetherSocial.port";

/** Bounded page walk of the blocked list. */
export async function loadBlocked(social: TogetherSocialApi) {
  const people: { userId: string; name: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await social.blocked(cursor);
    if (!result.ok) throw result.error;
    for (const p of result.value.data)
      people.push({
        userId: p.userId,
        name: p.displayName?.trim() || "Blocked person",
      });
    if (!result.value.nextCursor) break;
    cursor = result.value.nextCursor;
  }
  return people;
}

/** Canvas row 4 "Together settings": the live session's sharing, defaults for every new session, and who can find you. */
export function TogetherSettingsContainer() {
  const { api, storage, togetherLobby, togetherCloud } = useAdapters();
  const social = api.togetherSocial;
  const userId = useAuth().session?.userId ?? null;
  const settings = useTogetherSettings();
  const live = useLiveTogetherSharing({
    userId,
    lobby: togetherLobby,
    cloud: togetherCloud,
    storage,
  });
  // The store rehydrates once per account; until it has, the switches would
  // show the shipped defaults and an edit would be dropped.
  useEffect(() => {
    if (userId && settings.userId !== userId) void settings.rehydrate(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const settingsReady = settings.userId === userId && settings.hydrated;
  const [discoverable, setDiscoverable] = useState<boolean | null>(null);
  const [partnersCount, setPartnersCount] = useState<number | null>(null);
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const load = useCallback(() => {
    if (!social || !userId) return;
    const version = ++generation.current;
    const live = () => version === generation.current;
    void (async () => {
      const [profile, partners, blocked] = await Promise.all([
        social.getProfile(),
        loadPartners(social, userId).catch(() => null),
        loadBlocked(social).catch(() => null),
      ]);
      if (!live()) return;
      setDiscoverable(profile.ok ? profile.value.discoverable : null);
      setPartnersCount(partners ? partners.length : null);
      setBlockedCount(blocked ? blocked.length : null);
    })();
  }, [social, userId]);
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        generation.current++;
      };
    }, [load]),
  );
  useEffect(() => () => void generation.current++, []);
  const onDiscoverable = (value: boolean) => {
    if (!social || busy) return;
    const version = generation.current;
    setBusy(true);
    setNotice("");
    setDiscoverable(value);
    void social
      .profile(randomUUID(), value)
      .then((result) => {
        if (version !== generation.current) return;
        if (!result.ok) {
          setDiscoverable(!value);
          setNotice(
            "Could not change that. Check your connection and try again.",
          );
        } else setDiscoverable(result.value.discoverable);
      })
      .finally(() => {
        if (version === generation.current) setBusy(false);
      });
  };
  return (
    <TogetherSettingsPresenter
      live={live}
      audience={settings.audience}
      onAudience={(audience) => void settings.setDefaults({ audience })}
      sharing={settings.sharing}
      onSharing={(key, value) =>
        void settings.setDefaults({ sharing: { [key]: value } })
      }
      discoverable={discoverable}
      onDiscoverable={onDiscoverable}
      partnersCount={partnersCount}
      blockedCount={blockedCount}
      onPartners={() => router.push("/(app)/together/partners" as never)}
      onBlocked={() => router.push("/(app)/together/blocked" as never)}
      busy={busy || !settingsReady}
      notice={notice}
      onBack={() => router.back()}
    />
  );
}

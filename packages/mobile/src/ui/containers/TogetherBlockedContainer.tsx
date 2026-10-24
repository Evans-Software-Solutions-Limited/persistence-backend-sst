import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import {
  TogetherBlockedPresenter,
  type TogetherBlockedPerson,
} from "@/ui/presenters/TogetherBlockedPresenter";
import { loadBlocked } from "./TogetherSettingsContainer";

/** Together settings › Blocked people (PER-60). */
export function TogetherBlockedContainer() {
  const { api } = useAdapters();
  const social = api.togetherSocial;
  const userId = useAuth().session?.userId ?? null;
  const [people, setPeople] = useState<TogetherBlockedPerson[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const load = useCallback(() => {
    if (!social || !userId) return;
    const version = ++generation.current;
    void loadBlocked(social)
      .then((list) => {
        if (version === generation.current) setPeople(list);
      })
      .catch(() => {
        if (version === generation.current) {
          setPeople([]);
          setNotice("Could not load blocked people. Check your connection.");
        }
      });
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
  const unblock = (target: string) => {
    if (!social || busy) return;
    const version = generation.current;
    setBusy(true);
    setNotice("");
    void social
      .block(randomUUID(), target, false)
      .then((result) => {
        if (version !== generation.current) return;
        if (result.ok)
          setPeople((list) => list?.filter((p) => p.userId !== target) ?? null);
        else
          setNotice("Could not unblock. Check your connection and try again.");
      })
      .finally(() => {
        if (version === generation.current) setBusy(false);
      });
  };
  return (
    <TogetherBlockedPresenter
      people={people}
      busy={busy}
      notice={notice}
      onUnblock={unblock}
      onBack={() => router.back()}
    />
  );
}

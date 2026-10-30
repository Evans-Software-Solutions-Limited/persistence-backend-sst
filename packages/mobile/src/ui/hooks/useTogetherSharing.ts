import { useEffect, useRef, useState } from "react";
import {
  applySharingChange,
  holds,
  refusalFor,
  sharingState,
  type SharingBase,
  type SharingChange,
  type SharingPerson,
  type SharingRefusal,
  type TogetherSharingState,
} from "@/ui/presenters/togetherSharing";

/** A live session's sharing: who else is here, what is granted, how to change it. */
export interface TogetherSharingSource {
  /** Changes when the session does, so a late write can't land on the next one. */
  sessionId: string;
  people: SharingPerson[];
  base: SharingBase;
  /**
   * Rejects when the session refuses the change. `before` is what the
   * switches showed, so a write touches only what the tap changed.
   */
  write(target: SharingBase, before: SharingBase): Promise<void>;
}

/**
 * Switches move on tap (PER-60, row 4): the target shows at once and holds
 * until its write settles; a refusal puts the switch back with one notice.
 */
export function useTogetherSharing(source: TogetherSharingSource | null): {
  state: TogetherSharingState | null;
  change(change: SharingChange): void;
  /** The sheet closed: its notice has been seen. */
  dismiss(): void;
} {
  const [optimistic, setOptimistic] = useState<{
    sessionId: string;
    base: SharingBase;
  } | null>(null);
  const [refused, setRefused] = useState<{
    sessionId: string;
    refusal: SharingRefusal;
    change: SharingChange;
  } | null>(null);
  const latest = useRef(0);
  /** The newest tap per switch (the chips share Share previous values'). */
  const latestFor = useRef(new Map<string, number>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dismiss = () => setRefused(null);
  if (!source) return { state: null, change: () => {}, dismiss };
  const sessionId = source.sessionId;
  const shown =
    optimistic?.sessionId === sessionId ? optimistic.base : source.base;
  const change = (c: SharingChange) => {
    const target = applySharingChange(shown, source.people, c);
    const request = ++latest.current;
    const group = "recipient" in c ? "previous" : c.key;
    latestFor.current.set(group, request);
    setOptimistic({ sessionId, base: target });
    setRefused(null);
    source.write(target, shown).then(
      () => {
        if (mounted.current && request === latest.current) setOptimistic(null);
      },
      () => {
        if (!mounted.current) return;
        if (request === latest.current) setOptimistic(null);
        // A newer tap on the same switch replaced this one: not news. A tap
        // on another switch didn't resend this change, so it still counts.
        if (latestFor.current.get(group) !== request) return;
        setRefused({ sessionId, refusal: refusalFor(c), change: c });
      },
    );
  };
  // A failed write that still holds (Online keeps an offline change queued)
  // was not refused: only a switch that went back gets the notice.
  const wentBack =
    refused?.sessionId === sessionId &&
    !holds(shown, source.people, refused.change);
  return {
    state: sharingState(
      shown,
      source.people,
      wentBack ? refused.refusal : null,
    ),
    change,
    dismiss,
  };
}

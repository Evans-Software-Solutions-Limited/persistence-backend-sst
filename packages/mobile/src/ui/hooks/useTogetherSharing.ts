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
  /** Rejects when the session refuses the change. */
  write(target: SharingBase): Promise<void>;
}

/**
 * Switches move on tap (PER-60, row 4): the target shows at once and holds
 * until its write settles; a refusal puts the switch back with one notice.
 */
export function useTogetherSharing(source: TogetherSharingSource | null): {
  state: TogetherSharingState | null;
  change(change: SharingChange): void;
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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!source) return { state: null, change: () => {} };
  const sessionId = source.sessionId;
  const shown =
    optimistic?.sessionId === sessionId ? optimistic.base : source.base;
  const change = (c: SharingChange) => {
    const target = applySharingChange(shown, source.people, c);
    const request = ++latest.current;
    setOptimistic({ sessionId, base: target });
    setRefused(null);
    source.write(target).then(
      () => {
        if (mounted.current && request === latest.current) setOptimistic(null);
      },
      () => {
        if (!mounted.current) return;
        if (request === latest.current) setOptimistic(null);
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
  };
}

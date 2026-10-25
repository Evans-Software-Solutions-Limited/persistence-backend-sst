import { randomUUID } from "expo-crypto";
import { useEffect, useReducer, useRef } from "react";
import type { SetSyncState } from "@/ui/components/session/SetLogger";
import type { TogetherSharedSnapshot } from "@/domain/ports/togetherShared.port";
import { togetherPartnerAccess } from "@/ui/presenters/togetherPartnerAccess";

/** What the viewer typed into a partner's set row. */
export type TogetherPartnerDraft = {
  reps: number | null;
  weightKg: number | null;
  /** Logged values when the edit began (`""` on an empty row); a draft over a changed set is not shown. */
  base: string;
};

/** One partner's fill-in state, as the partner view reads and drives it. */
export type TogetherPartnerOutbox = {
  drafts: Readonly<Record<string, TogetherPartnerDraft>>;
  delivery: Readonly<Record<string, SetSyncState>>;
  /** A set could not be sent; the view words it. */
  failed: boolean;
  added: Readonly<Record<string, number>>;
  rowId(planExerciseId: string, index: number): string;
  minted(planExerciseId: string): number;
  edit(
    setId: string,
    values: Omit<TogetherPartnerDraft, "base">,
    base: string,
  ): void;
  /** Queues the row; it is sent when every earlier set has landed or failed. */
  commit(setId: string, planExerciseId: string): void;
  addRow(planExerciseId: string): void;
};

/** A handed-over set the partner neither applies nor rejects in this long is Not sent. */
export const PARTNER_SET_TIMEOUT_MS = 15_000;

export const togetherValuesKey = (row: {
  reps: number | null;
  weightKg: number | null;
}) => `${row.reps ?? ""}|${row.weightKg ?? ""}`;

type Owner = {
  ids: Record<string, string[]>;
  added: Record<string, number>;
  drafts: Record<string, TogetherPartnerDraft>;
  delivery: Record<string, SetSyncState>;
  queue: { setId: string; planExerciseId: string }[];
  inflight: {
    setId: string;
    reps: number;
    weightKg: number;
    revision: number;
    grantVersion: number;
    token: number;
  } | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Values of each send that ended Not sent, to recognise a late echo. */
  failedSends: Record<string, string>;
};
const fresh = (): Owner => ({
  ids: {},
  added: {},
  drafts: {},
  delivery: {},
  queue: [],
  inflight: null,
  timer: null,
  failedSends: {},
});

/**
 * Fill-in delivery for every partner in a Together session (PER-60). It lives
 * in the container, not the partner view, so a set queued or in flight keeps
 * going when the viewer switches back to their own workout or to another
 * partner. One set per partner is in flight; the next goes out against the
 * revision after the echo. "Saved" means the partner's projection echoed it.
 */
export function useTogetherPartnerOutbox(p: {
  snapshot: TogetherSharedSnapshot | null;
  accountId: string;
  /** The Together session; state never carries over to another one. */
  sessionId?: string;
  /** An extra gate from the container (Online: the partner allows fill-in). */
  canLog?(ownerId: string): boolean;
  send(
    ownerId: string,
    operation: Record<string, unknown>,
    observedRevision: number,
  ): Promise<void>;
}): (ownerId: string) => TogetherPartnerOutbox {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const owners = useRef(new Map<string, Owner>());
  const latest = useRef(p);
  latest.current = p;
  // Another account, another session or none at all never inherits the
  // last one's rows, dots or queued sets.
  const identity = p.snapshot ? `${p.accountId}|${p.sessionId ?? ""}` : null;
  const current = useRef(identity);
  if (current.current !== identity) {
    current.current = identity;
    for (const o of owners.current.values()) {
      o.inflight = null;
      if (o.timer) clearTimeout(o.timer);
    }
    owners.current = new Map();
  }
  const tokens = useRef(0);
  const state = (ownerId: string) => {
    let o = owners.current.get(ownerId);
    if (!o) owners.current.set(ownerId, (o = fresh()));
    return o;
  };
  const access = (ownerId: string) => {
    const { snapshot, accountId, canLog } = latest.current;
    if (!snapshot) return null;
    const a = togetherPartnerAccess(snapshot, ownerId, accountId);
    return { ...a, editable: a.editable && (canLog?.(ownerId) ?? true) };
  };
  const settle = (o: Owner) => {
    o.inflight = null;
    if (o.timer) clearTimeout(o.timer);
    o.timer = null;
  };
  const fail = (o: Owner, setId: string, sent?: string) => {
    if (sent) o.failedSends[setId] = sent;
    else delete o.failedSends[setId];
    o.delivery = { ...o.delivery, [setId]: "notsent" };
  };
  const clear = (o: Owner, setId: string) => {
    const { [setId]: _gone, ...rest } = o.delivery;
    o.delivery = rest;
  };
  const loggedSet = (ownerId: string, setId: string) =>
    Object.values(access(ownerId)?.projection?.exercises ?? {})
      .flatMap((e) => e.sets)
      .find((set) => set.setId === setId);

  /** Sends the next queued set against the revision on screen now. */
  const pump = (ownerId: string) => {
    const o = state(ownerId);
    const a = access(ownerId);
    while (!o.inflight && o.queue.length && a?.editable && a.projection) {
      const next = o.queue.shift()!;
      const logged = loggedSet(ownerId, next.setId);
      const loggedKey = logged ? togetherValuesKey(logged) : "";
      const draft = o.drafts[next.setId];
      const values = draft && draft.base === loggedKey ? draft : logged;
      if (
        !values ||
        values.reps === null ||
        values.weightKg === null ||
        (logged && togetherValuesKey(values) === loggedKey)
      ) {
        clear(o, next.setId);
        continue;
      }
      const token = ++tokens.current;
      const sentKey = togetherValuesKey(values);
      const revision = a.projection.revision;
      o.inflight = {
        setId: next.setId,
        reps: values.reps,
        weightKg: values.weightKg,
        revision,
        grantVersion: a.grantVersion,
        token,
      };
      // Nearby can drop an intent without moving the revision; never let one
      // stuck set hold back every later one.
      o.timer = setTimeout(() => {
        if (o.inflight?.token !== token) return;
        settle(o);
        fail(o, next.setId, sentKey);
        pump(ownerId);
        rerender();
      }, PARTNER_SET_TIMEOUT_MS);
      o.delivery = { ...o.delivery, [next.setId]: "sending" };
      void latest.current
        .send(
          ownerId,
          {
            type: "upsertSet",
            planExerciseId: next.planExerciseId,
            set: {
              setId: next.setId,
              reps: values.reps,
              weightKg: values.weightKg,
              completed: true,
            },
          },
          revision,
        )
        // Resolving only means it was handed over (Nearby publishes an intent
        // the owner may still reject); "saved" waits for the echo. A refusal
        // may still land later (Online retries its outbox), so keep the values.
        .catch(() => {
          if (o.inflight?.token !== token) return;
          settle(o);
          fail(o, next.setId, sentKey);
          pump(ownerId);
          rerender();
        });
    }
  };

  const snapshotKey = p.snapshot
    ? JSON.stringify([
        p.snapshot.athletes.map((a) => [a.userId, a.revision, a.exercises]),
        p.snapshot.grants
          .filter((g) => g.recipientId === p.accountId)
          .map((g) => [g.ownerId, g.version, g.consent]),
        [...owners.current.keys()].map((id) => p.canLog?.(id) ?? true),
      ])
    : "";
  useEffect(() => {
    let changed = false;
    for (const [ownerId, o] of owners.current) {
      const a = access(ownerId);
      const before = JSON.stringify([o.delivery, o.drafts, o.inflight]);
      const sent = o.inflight;
      if (sent && a?.projection) {
        const echoed = loggedSet(ownerId, sent.setId);
        const base = togetherValuesKey(sent);
        if (echoed && togetherValuesKey(echoed) === base) {
          settle(o);
          clear(o, sent.setId);
          const draft = o.drafts[sent.setId];
          // A correction typed while this was sending stays and is sent next;
          // a draft that landed as it is goes, so it can never come back.
          if (draft && togetherValuesKey(draft) !== base)
            o.drafts = { ...o.drafts, [sent.setId]: { ...draft, base } };
          else if (draft) {
            const { [sent.setId]: _landed, ...rest } = o.drafts;
            o.drafts = rest;
          }
        } else if (
          // Old values still showing is normal before a correction lands; only
          // a revision move or a grant change (or the timeout) ends the send.
          a.projection.revision > sent.revision ||
          sent.grantVersion !== a.grantVersion
        ) {
          // The owner moved on without applying it (stale), or changed what we
          // may do, which makes them drop intents sent under the old grant.
          settle(o);
          fail(o, sent.setId, base);
        }
      }
      // Fill-in is gone only when the partner's grant is in view and says so.
      // While their data is merely hidden (Online reconnecting), drafts stay
      // and the queue waits; the in-flight set still has its timeout.
      const { snapshot, accountId } = latest.current;
      const grantInView = !!snapshot?.grants.some(
        (g) => g.ownerId === ownerId && g.recipientId === accountId,
      );
      if (!a?.editable && grantInView) {
        for (const q of o.queue) fail(o, q.setId);
        o.queue = [];
        o.drafts = {};
      }
      // A set marked Not sent that did land after all (a late echo) is saved.
      for (const [setId, sentKey] of Object.entries(o.failedSends)) {
        const logged = loggedSet(ownerId, setId);
        if (
          o.delivery[setId] === "notsent" &&
          logged &&
          togetherValuesKey(logged) === sentKey
        ) {
          delete o.failedSends[setId];
          clear(o, setId);
          const draft = o.drafts[setId];
          if (draft && togetherValuesKey(draft) === sentKey) {
            const { [setId]: _landed, ...rest } = o.drafts;
            o.drafts = rest;
          }
        }
      }
      // A Not sent dot whose typed values are no longer shown (the partner
      // changed that set since) points at nothing the viewer can retry.
      if (a?.editable)
        for (const [setId, state] of Object.entries(o.delivery)) {
          if (state !== "notsent") continue;
          const logged = loggedSet(ownerId, setId);
          const draft = o.drafts[setId];
          if (
            !draft ||
            draft.base !== (logged ? togetherValuesKey(logged) : "")
          ) {
            delete o.failedSends[setId];
            clear(o, setId);
          }
        }
      pump(ownerId);
      if (JSON.stringify([o.delivery, o.drafts, o.inflight]) !== before)
        changed = true;
    }
    if (changed) rerender();
    // The projections, the grants and the container's gate drive delivery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey]);
  useEffect(
    () => () => {
      for (const o of owners.current.values()) settle(o);
    },
    [],
  );

  return (ownerId) => {
    const o = state(ownerId);
    return {
      drafts: o.drafts,
      delivery: o.delivery,
      // The error line lasts exactly as long as a row shows Not sent.
      failed: Object.values(o.delivery).includes("notsent"),
      added: o.added,
      rowId: (planExerciseId, index) => {
        const pool = (o.ids[planExerciseId] ??= []);
        while (pool.length <= index) {
          const id = randomUUID();
          // Row ids key the rows; never let a repeat collapse two of them.
          pool.push(pool.includes(id) ? `${id}-${pool.length}` : id);
        }
        return pool[index]!;
      },
      minted: (planExerciseId) => o.ids[planExerciseId]?.length ?? 0,
      edit: (setId, values, base) => {
        o.drafts = { ...o.drafts, [setId]: { ...values, base } };
        rerender();
      },
      commit: (setId, planExerciseId) => {
        if (!access(ownerId)?.editable) return;
        // A row with only reps or only kg is not a set yet (every blur commits).
        const draft = o.drafts[setId];
        if (draft && (draft.reps === null || draft.weightKg === null)) return;
        if (!o.queue.some((q) => q.setId === setId))
          o.queue.push({ setId, planExerciseId });
        o.delivery = { ...o.delivery, [setId]: "sending" };
        pump(ownerId);
        rerender();
      },
      addRow: (planExerciseId) => {
        o.added = {
          ...o.added,
          [planExerciseId]: (o.added[planExerciseId] ?? 0) + 1,
        };
        rerender();
      },
    };
  };
}

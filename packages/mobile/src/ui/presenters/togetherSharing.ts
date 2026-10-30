/**
 * Canvas row 4 (PER-60): what you share in a live session, as three switches
 * and the previous-value recipients. Both transports reduce to this model, so
 * the in-session sheet and Together settings' live card behave the same.
 *
 * The switches speak for everyone in the session. Each reads on while anyone
 * holds that grant, so a grant the joining defaults gave a newcomer never sits
 * behind a switch that says Off; turning a switch off revokes it for everyone,
 * on grants it to everyone, and the chips narrow previous values. A write only
 * touches what the tap changed, so a chip never rewrites anyone's numbers.
 */

import type { TogetherSharingConsent } from "@/domain/ports/togetherShared.port";
import type { TogetherAvatarTone } from "./TogetherAthleteAvatar";
import { TOGETHER_PARTNER_TONES } from "./TogetherAthleteAvatar";
import { listNames } from "./summaryFormat";

export type SharingKey = "numbers" | "previous" | "logging";

/** Someone else in the session, in seat order. */
export interface SharingPerson {
  userId: string;
  name: string;
  tone: TogetherAvatarTone;
  /**
   * Finished their own workout but still in the Online roster: nothing new can
   * be granted to them (the server refuses the whole list), so they get no
   * chip and switches turned on leave them out.
   */
  finished?: boolean;
}

/** What is granted: the previous values per recipient. */
export interface SharingBase {
  numbers: boolean;
  logging: boolean;
  previous: Readonly<Record<string, boolean>>;
}

export type SharingChange =
  | { key: SharingKey; value: boolean }
  | { recipient: string; value: boolean };

/** A change the session refused: the switch is back, with one notice. */
export interface SharingRefusal {
  key: SharingKey;
  wanted: boolean;
}

export interface TogetherSharingState {
  numbers: boolean;
  previous: boolean;
  logging: boolean;
  /** Partners still training, who can be granted something new. */
  recipients: (SharingPerson & { on: boolean })[];
  /** Nobody else in the session at all, finished or not. */
  alone: boolean;
  refused: SharingRefusal | null;
}

/** Partners in seat order, named, with the strip's ring colours. */
export function sharingPeople(
  members: readonly { userId: string; status?: string }[],
  accountId: string,
  name: (userId: string, seat: number) => string,
): SharingPerson[] {
  return members
    .map((m, seat) => ({ ...m, seat }))
    .filter((m) => m.userId !== accountId)
    .map((m, i) => ({
      userId: m.userId,
      name: name(m.userId, m.seat),
      tone: TOGETHER_PARTNER_TONES[i % TOGETHER_PARTNER_TONES.length]!,
      ...(m.status !== undefined && m.status !== "active"
        ? { finished: true }
        : {}),
    }));
}

export function sharingState(
  base: SharingBase,
  people: readonly SharingPerson[],
  refused: SharingRefusal | null = null,
): TogetherSharingState {
  const recipients = people
    .filter((p) => !p.finished)
    .map((p) => ({ ...p, on: !!base.previous[p.userId] }));
  return {
    numbers: base.numbers,
    logging: base.logging,
    previous: people.some((p) => base.previous[p.userId]),
    recipients,
    alone: !people.length,
    refused,
  };
}

/** The grants a change asks for. Turning previous values on picks everyone. */
export function applySharingChange(
  base: SharingBase,
  people: readonly SharingPerson[],
  change: SharingChange,
): SharingBase {
  if ("recipient" in change)
    return {
      ...base,
      previous: { ...base.previous, [change.recipient]: change.value },
    };
  if (change.key === "previous")
    return {
      ...base,
      // Turning it on picks everyone still training; off clears everyone.
      previous: Object.fromEntries(
        people.map((p) => [p.userId, change.value ? !p.finished : false]),
      ),
    };
  return { ...base, [change.key]: change.value };
}

/** Whether the grants already say what a change asked for. */
export function holds(
  base: SharingBase,
  people: readonly SharingPerson[],
  change: SharingChange,
) {
  if ("recipient" in change)
    return !!base.previous[change.recipient] === change.value;
  if (change.key === "previous")
    return sharingState(base, people).previous === change.value;
  return base[change.key] === change.value;
}

export function refusalFor(change: SharingChange): SharingRefusal {
  return "recipient" in change
    ? { key: "previous", wanted: change.value }
    : { key: change.key, wanted: change.value };
}

const REFUSED_NAME: Record<SharingKey, string> = {
  numbers: "your numbers",
  previous: "previous values",
  logging: "fill-in",
};

/** Canvas phone 3: "Couldn't turn on fill-in. The session didn't accept it, so it's switched back off." */
export function refusedCopy(r: SharingRefusal) {
  return `Couldn’t turn ${r.wanted ? "on" : "off"} ${REFUSED_NAME[r.key]}. The session didn’t accept it, so it’s switched back ${r.wanted ? "off" : "on"}.`;
}

/** The live card's Previous values line. */
export function previousSummary(state: TogetherSharingState) {
  const picked = state.recipients.filter((r) => r.on);
  if (!picked.length) return "Off";
  if (picked.length === state.recipients.length)
    return "Everyone in the session";
  return `To ${listNames(picked.map((r) => r.name))}`;
}

// ── Nearby: one grant per recipient ──

type Grant = {
  ownerId: string;
  recipientId: string;
  consent: TogetherSharingConsent;
};
const NONE: TogetherSharingConsent = {
  numbers: false,
  prev: false,
  logging: false,
};
const grantFor = (
  grants: readonly Grant[],
  accountId: string,
  recipientId: string,
) =>
  grants.find((g) => g.ownerId === accountId && g.recipientId === recipientId)
    ?.consent ?? NONE;

export function nearbySharingBase(
  grants: readonly Grant[],
  accountId: string,
  people: readonly SharingPerson[],
): SharingBase {
  const each = people.map((p) => grantFor(grants, accountId, p.userId));
  return {
    numbers: each.some((c) => c.numbers),
    logging: each.some((c) => c.logging),
    previous: Object.fromEntries(
      people.map((p, i) => [p.userId, each[i]!.prev]),
    ),
  };
}

/**
 * The per-recipient grants a tap changes: only the parts that differ between
 * what was shown (`before`) and the target; everything else stays as granted.
 */
export function nearbySharingWrites(
  grants: readonly Grant[],
  accountId: string,
  people: readonly SharingPerson[],
  target: SharingBase,
  before: SharingBase,
): { recipientId: string; consent: TogetherSharingConsent }[] {
  return people.flatMap((p) => {
    const current = grantFor(grants, accountId, p.userId);
    const id = p.userId;
    const consent = {
      numbers:
        target.numbers === before.numbers ? current.numbers : target.numbers,
      prev:
        !!target.previous[id] === !!before.previous[id]
          ? current.prev
          : !!target.previous[id],
      logging:
        target.logging === before.logging ? current.logging : target.logging,
    };
    return current.numbers === consent.numbers &&
      current.prev === consent.prev &&
      current.logging === consent.logging
      ? []
      : [{ recipientId: p.userId, consent }];
  });
}

// ── Online: recipient lists plus the session-wide fill-in flag ──

type CloudOwn = {
  allowPartnerLogging: boolean;
  numbersConsent?: { recipientIds: readonly string[] };
  previousConsent?: { recipientIds: readonly string[] };
};

export function cloudSharingBase(
  own: CloudOwn,
  people: readonly SharingPerson[],
): SharingBase {
  const numbers = own.numbersConsent?.recipientIds ?? [];
  const previous = own.previousConsent?.recipientIds ?? [];
  return {
    numbers: people.some((p) => numbers.includes(p.userId)),
    logging: own.allowPartnerLogging,
    previous: Object.fromEntries(
      people.map((p) => [p.userId, previous.includes(p.userId)]),
    ),
  };
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * The server calls a tap needs: only what differs between what was shown
 * (`before`) and the target; untouched recipients keep their grants.
 */
export function cloudSharingWrites(
  own: CloudOwn,
  people: readonly SharingPerson[],
  target: SharingBase,
  before: SharingBase,
): { numbers?: string[]; previous?: string[]; logging?: boolean } {
  const granted = own.numbersConsent?.recipientIds ?? [];
  const numbers =
    target.numbers === before.numbers
      ? [...granted]
      : target.numbers
        ? people.filter((p) => !p.finished).map((p) => p.userId)
        : [];
  // The server refuses a list naming anyone not still training, so the list
  // sent only ever names partners who are.
  const previous = people
    .filter(
      (p) =>
        !p.finished &&
        (!!target.previous[p.userId] === !!before.previous[p.userId]
          ? (own.previousConsent?.recipientIds ?? []).includes(p.userId)
          : target.previous[p.userId]),
    )
    .map((p) => p.userId);
  return {
    ...(sameIds(numbers, own.numbersConsent?.recipientIds ?? [])
      ? {}
      : { numbers }),
    // Sent only when the tap touched previous values: rewriting a list that
    // still names someone who has left would be refused.
    ...(!people.some(
      (p) => !!target.previous[p.userId] !== !!before.previous[p.userId],
    ) || sameIds(previous, own.previousConsent?.recipientIds ?? [])
      ? {}
      : { previous }),
    // Compared with what was shown, like the others: a stale optimistic
    // base still saying on must not re-grant fill-in the server turned off
    // when a partner joined (approveJoin never grants future joiners).
    ...(target.logging === before.logging ||
    target.logging === own.allowPartnerLogging
      ? {}
      : { logging: target.logging }),
  };
}

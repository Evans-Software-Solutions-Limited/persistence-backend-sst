/**
 * Canvas row 4 (PER-60): what you share in a live session, as three switches
 * and the previous-value recipients. Both transports reduce to this model, so
 * the in-session sheet and Together settings' live card behave the same.
 *
 * The switches speak for everyone in the session: Show my numbers and Let
 * others fill in my sets read on only when they are on for everyone; Share
 * previous values reads on while anyone is picked, and the chips narrow it.
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
  recipients: (SharingPerson & { on: boolean })[];
  refused: SharingRefusal | null;
}

/** Partners in seat order, named, with the strip's ring colours. */
export function sharingPeople(
  members: readonly { userId: string }[],
  accountId: string,
  name: (userId: string, seat: number) => string,
): SharingPerson[] {
  return members
    .map((m, seat) => ({ userId: m.userId, seat }))
    .filter((m) => m.userId !== accountId)
    .map((m, i) => ({
      userId: m.userId,
      name: name(m.userId, m.seat),
      tone: TOGETHER_PARTNER_TONES[i % TOGETHER_PARTNER_TONES.length]!,
    }));
}

export function sharingState(
  base: SharingBase,
  people: readonly SharingPerson[],
  refused: SharingRefusal | null = null,
): TogetherSharingState {
  const recipients = people.map((p) => ({
    ...p,
    on: !!base.previous[p.userId],
  }));
  return {
    numbers: base.numbers,
    logging: base.logging,
    previous: recipients.some((r) => r.on),
    recipients,
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
      previous: Object.fromEntries(people.map((p) => [p.userId, change.value])),
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
    numbers: each.length > 0 && each.every((c) => c.numbers),
    logging: each.length > 0 && each.every((c) => c.logging),
    previous: Object.fromEntries(
      people.map((p, i) => [p.userId, each[i]!.prev]),
    ),
  };
}

/** The per-recipient grants that differ from what the target asks for. */
export function nearbySharingWrites(
  grants: readonly Grant[],
  accountId: string,
  people: readonly SharingPerson[],
  target: SharingBase,
): { recipientId: string; consent: TogetherSharingConsent }[] {
  return people.flatMap((p) => {
    const current = grantFor(grants, accountId, p.userId);
    const consent = {
      numbers: target.numbers,
      prev: !!target.previous[p.userId],
      logging: target.logging,
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
    numbers:
      people.length > 0 && people.every((p) => numbers.includes(p.userId)),
    logging: own.allowPartnerLogging,
    previous: Object.fromEntries(
      people.map((p) => [p.userId, previous.includes(p.userId)]),
    ),
  };
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** The three server calls a target needs; unchanged ones are left out. */
export function cloudSharingWrites(
  own: CloudOwn,
  people: readonly SharingPerson[],
  target: SharingBase,
): { numbers?: string[]; previous?: string[]; logging?: boolean } {
  const numbers = target.numbers ? people.map((p) => p.userId) : [];
  const previous = people
    .filter((p) => target.previous[p.userId])
    .map((p) => p.userId);
  return {
    ...(sameIds(numbers, own.numbersConsent?.recipientIds ?? [])
      ? {}
      : { numbers }),
    ...(sameIds(previous, own.previousConsent?.recipientIds ?? [])
      ? {}
      : { previous }),
    ...(target.logging === own.allowPartnerLogging
      ? {}
      : { logging: target.logging }),
  };
}

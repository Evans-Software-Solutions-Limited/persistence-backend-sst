import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  coachFormRequests,
  coachForms,
  coachSessionAttendees,
  coachSessions,
  profiles,
  ptClientRelationships,
  workouts,
  type CoachSession,
  type CoachSessionAttendeeStatus,
  type CoachSessionKind,
} from "@persistence/db";
import { randomUUID } from "node:crypto";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import { safeTimeZone } from "../scheduler/zonedTime";
import { localDayBounds, shiftLikeLocal, weeklyStarts } from "./sessionTimes";

/**
 * Coach sessions (PER-123, BE-I2, design I C4): the coach's bookings, their
 * attendees, the calendar, Today's schedule and the athlete's upcoming
 * sessions.
 *
 * Every coach read and write filters by `trainer_id = caller`; every athlete
 * read goes through the caller's own attendee rows on an ACTIVE relationship.
 * So coach B never sees coach A's sessions, and an athlete stops seeing a
 * coach's sessions once coaching ends.
 *
 * A weekly repeat is one row per occurrence sharing `series_id` (at most 26),
 * so each can be moved or cancelled on its own. Edits and cancels take
 * `scope`: `this` (the one occurrence) or `series` (this occurrence and the
 * later ones in its series that aren't cancelled; earlier ones are history).
 */

export const MAX_ATTENDEES = 50;
export const CALENDAR_MAX_DAYS = 62;
export const LOCATION_MAX = 200;
export const NOTES_MAX = 2000;
export const VIDEO_URL_MAX = 2000;

/** Attendee statuses that are still booked (get reminders and pushes). */
export const BOOKED_STATUSES: CoachSessionAttendeeStatus[] = [
  "invited",
  "accepted",
];

export interface AttendeeDTO {
  clientId: string;
  relationshipId: string;
  name: string | null;
  avatarUrl: string | null;
  status: CoachSessionAttendeeStatus;
  remindedAt: string | null;
}

export interface CoachSessionDTO {
  id: string;
  kind: CoachSessionKind;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  location: string | null;
  videoUrl: string | null;
  workout: { id: string; name: string } | null;
  seriesId: string | null;
  notes: string | null;
  reminderMinutes: number | null;
  cancelledAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  attendees: AttendeeDTO[];
}

/** A form request due in the calendar range (design C's requests). */
export interface CalendarFormDueDTO {
  requestId: string;
  formId: string;
  formTitle: string;
  client: { id: string; name: string | null; avatarUrl: string | null };
  dueAt: string;
  status: string;
  late: boolean;
}

/** The athlete's view of one session: their own booking, never others'. */
export interface AthleteCoachSessionDTO {
  id: string;
  kind: CoachSessionKind;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  location: string | null;
  videoUrl: string | null;
  workout: { id: string; name: string } | null;
  seriesId: string | null;
  reminderMinutes: number | null;
  cancelledAt: string | null;
  revision: number;
  updatedAt: string;
  /** The athlete's own booking status. */
  status: CoachSessionAttendeeStatus;
  coach: { id: string; name: string | null; avatarUrl: string | null };
}

export interface SessionFields {
  kind: CoachSessionKind;
  startsAt: Date;
  durationMin: number;
  location: string | null;
  videoUrl: string | null;
  workoutId: string | null;
  notes: string | null;
  reminderMinutes: number | null;
}

/** A booked attendee to tell about a change. */
export interface NotifyAttendee {
  clientId: string;
  relationshipId: string;
}

/** What a write changed, for the coach events and athlete pushes. */
export interface SessionChange {
  action: "booked" | "moved" | "cancelled";
  session: CoachSessionDTO;
  attendees: NotifyAttendee[];
  /** Occurrences the change covers (a series create or edit). */
  occurrences: number;
}

const endsAt = (s: { startsAt: Date; durationMin: number }) =>
  new Date(s.startsAt.getTime() + s.durationMin * 60_000).toISOString();

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** The full rows for some sessions, attendees included, by start time. */
export async function loadSessions(
  db: DbOrTx,
  trainerId: string,
  ids: string[],
): Promise<CoachSessionDTO[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ session: coachSessions, workoutName: workouts.name })
    .from(coachSessions)
    .leftJoin(workouts, eq(workouts.id, coachSessions.workoutId))
    .where(
      and(
        inArray(coachSessions.id, ids),
        eq(coachSessions.trainerId, trainerId),
      ),
    )
    .orderBy(asc(coachSessions.startsAt), asc(coachSessions.id));
  const attendees = await db
    .select({
      sessionId: coachSessionAttendees.sessionId,
      clientId: coachSessionAttendees.clientId,
      relationshipId: coachSessionAttendees.relationshipId,
      status: coachSessionAttendees.status,
      remindedAt: coachSessionAttendees.remindedAt,
      name: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(coachSessionAttendees)
    .innerJoin(profiles, eq(profiles.id, coachSessionAttendees.clientId))
    .where(inArray(coachSessionAttendees.sessionId, ids))
    .orderBy(asc(coachSessionAttendees.createdAt), asc(profiles.fullName));
  const bySession = new Map<string, AttendeeDTO[]>();
  for (const a of attendees) {
    const list = bySession.get(a.sessionId) ?? [];
    list.push({
      clientId: a.clientId,
      relationshipId: a.relationshipId,
      name: a.name,
      avatarUrl: a.avatarUrl,
      status: a.status,
      remindedAt: iso(a.remindedAt),
    });
    bySession.set(a.sessionId, list);
  }
  return rows.map(({ session: s, workoutName }) => ({
    id: s.id,
    kind: s.kind,
    startsAt: s.startsAt.toISOString(),
    endsAt: endsAt(s),
    durationMin: s.durationMin,
    location: s.location,
    videoUrl: s.videoUrl,
    workout:
      s.workoutId && workoutName !== null
        ? { id: s.workoutId, name: workoutName }
        : null,
    seriesId: s.seriesId,
    notes: s.notes,
    reminderMinutes: s.reminderMinutes,
    cancelledAt: iso(s.cancelledAt),
    revision: s.revision,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    attendees: bySession.get(s.id) ?? [],
  }));
}

/** The coach's time zone (repeats and Today use it). */
export async function trainerTimeZone(
  db: DbOrTx,
  trainerId: string,
): Promise<string> {
  const rows = await db
    .select({ timezone: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.id, trainerId))
    .limit(1);
  return safeTimeZone(rows[0]?.timezone);
}

/** True when the workout is the caller's own (the coach wrote it). */
export async function isOwnWorkout(
  trainerId: string,
  workoutId: string,
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.createdBy, trainerId)))
    .limit(1);
  return rows.length === 1;
}

/** A booked attendee: the client and the relationship they're booked via. */
export interface AttendeeRef {
  clientId: string;
  relationshipId: string;
}

/** Sessions of a series, or the one session, by the first row's id. */
async function seriesOrSingle(
  db: DbOrTx,
  trainerId: string,
  first: CoachSession,
): Promise<CoachSessionDTO[]> {
  if (!first.seriesId) return loadSessions(db, trainerId, [first.id]);
  const ids = await db
    .select({ id: coachSessions.id })
    .from(coachSessions)
    .where(
      and(
        eq(coachSessions.trainerId, trainerId),
        eq(coachSessions.seriesId, first.seriesId),
      ),
    );
  return loadSessions(
    db,
    trainerId,
    ids.map((r) => r.id),
  );
}

/** A create replayed with the same Idempotency-Key: its sessions. */
export async function findCreated(
  trainerId: string,
  clientRequestId: string,
  db: DbOrTx = getDb(),
): Promise<CoachSessionDTO[] | null> {
  const rows = await db
    .select()
    .from(coachSessions)
    .where(
      and(
        eq(coachSessions.trainerId, trainerId),
        eq(coachSessions.clientRequestId, clientRequestId),
      ),
    )
    .limit(1);
  const first = rows[0];
  return first ? seriesOrSingle(db, trainerId, first) : null;
}

export interface CreateResult {
  sessions: CoachSessionDTO[];
  /** False when this was a replay: nothing new to announce. */
  created: boolean;
  /** The attendees actually booked (still active when written). */
  attendees: AttendeeRef[];
}

/**
 * The attendees whose relationship is still active, inside the write's
 * transaction. The rows are locked FOR SHARE, so offboarding (which updates
 * the relationship) waits for this booking to commit and then cancels it;
 * a relationship that ended first is left out (Inspector Brad, #568).
 */
async function stillActive(
  tx: DbOrTx,
  attendees: AttendeeRef[],
): Promise<AttendeeRef[]> {
  if (attendees.length === 0) return [];
  const rows = await tx
    .select({ id: ptClientRelationships.id })
    .from(ptClientRelationships)
    .where(
      and(
        inArray(
          ptClientRelationships.id,
          attendees.map((a) => a.relationshipId),
        ),
        eq(ptClientRelationships.status, "active"),
      ),
    )
    .for("share");
  const live = new Set(rows.map((r) => r.id));
  return attendees.filter((a) => live.has(a.relationshipId));
}

/**
 * Book a session, or a weekly repeat of `repeatCount` occurrences, with its
 * attendees. The first row carries the Idempotency-Key; a concurrent replay
 * that loses the race returns the winner's rows.
 */
export async function createSessions(
  trainerId: string,
  fields: SessionFields,
  attendees: AttendeeRef[],
  repeatCount: number,
  clientRequestId: string | null,
): Promise<CreateResult> {
  return getDb().transaction(async (tx) => {
    const tz = await trainerTimeZone(tx, trainerId);
    const starts =
      repeatCount > 1
        ? weeklyStarts(fields.startsAt, repeatCount, tz)
        : [fields.startsAt];
    const seriesId = repeatCount > 1 ? randomUUID() : null;
    const now = new Date();
    const values = starts.map((startsAt, i) => ({
      trainerId,
      ...fields,
      startsAt,
      seriesId,
      clientRequestId: i === 0 ? clientRequestId : null,
      createdAt: now,
      updatedAt: now,
    }));
    const inserted = await tx
      .insert(coachSessions)
      .values(values[0]!)
      .onConflictDoNothing()
      .returning({ id: coachSessions.id });
    if (!inserted[0]) {
      // Same key, created by a concurrent request.
      const replay = await findCreated(trainerId, clientRequestId!, tx);
      return { sessions: replay ?? [], created: false, attendees: [] };
    }
    const booked = await stillActive(tx, attendees);
    const ids = [inserted[0].id];
    if (values.length > 1) {
      const rest = await tx
        .insert(coachSessions)
        .values(values.slice(1))
        .returning({ id: coachSessions.id });
      ids.push(...rest.map((r) => r.id));
    }
    if (booked.length > 0) {
      await tx.insert(coachSessionAttendees).values(
        ids.flatMap((sessionId) =>
          booked.map((a) => ({
            sessionId,
            clientId: a.clientId,
            relationshipId: a.relationshipId,
            status: "invited" as const,
            createdAt: now,
            updatedAt: now,
          })),
        ),
      );
    }
    return {
      sessions: await loadSessions(tx, trainerId, ids),
      created: true,
      attendees: booked,
    };
  });
}

export type SessionScope = "this" | "series";

/** The session and, for `series`, the later live occurrences of its series. */
async function targetsFor(
  tx: DbOrTx,
  trainerId: string,
  session: CoachSession,
  scope: SessionScope,
): Promise<CoachSession[]> {
  if (scope === "this" || !session.seriesId) return [session];
  return tx
    .select()
    .from(coachSessions)
    .where(
      and(
        eq(coachSessions.trainerId, trainerId),
        eq(coachSessions.seriesId, session.seriesId),
        isNull(coachSessions.cancelledAt),
        gte(coachSessions.startsAt, session.startsAt),
      ),
    )
    .orderBy(asc(coachSessions.startsAt))
    .for("update");
}

async function lockOwn(
  tx: DbOrTx,
  trainerId: string,
  sessionId: string,
): Promise<CoachSession | null> {
  const rows = await tx
    .select()
    .from(coachSessions)
    .where(
      and(
        eq(coachSessions.id, sessionId),
        eq(coachSessions.trainerId, trainerId),
      ),
    )
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

export type SessionPatch = Partial<SessionFields> & {
  /** Replaces the attendee list when present. */
  attendees?: AttendeeRef[];
};

export type PatchResult =
  | { ok: true; sessions: CoachSessionDTO[]; changes: SessionChange[] }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "session_cancelled"; current: CoachSessionDTO }
  | { ok: false; reason: "revision_conflict"; current: CoachSessionDTO }
  | { ok: false; reason: "own_training_attendees" };

/**
 * Edit a session (`this`) or it and the later occurrences of its series
 * (`series`). A move shifts every target the same way in the coach's local
 * time; a move or a new reminder time lets the reminder go out again. A new
 * attendee list books the added clients and takes the removed ones off
 * (`cancelled`), per occurrence.
 */
export async function patchSessions(
  trainerId: string,
  sessionId: string,
  scope: SessionScope,
  patch: SessionPatch,
  expectedRevision: number | undefined,
): Promise<PatchResult> {
  return getDb().transaction(async (tx): Promise<PatchResult> => {
    const session = await lockOwn(tx, trainerId, sessionId);
    if (!session) return { ok: false, reason: "not_found" };
    const current = async () =>
      (await loadSessions(tx, trainerId, [session.id]))[0]!;
    if (session.cancelledAt) {
      return {
        ok: false,
        reason: "session_cancelled",
        current: await current(),
      };
    }
    if (
      expectedRevision !== undefined &&
      expectedRevision !== session.revision
    ) {
      return {
        ok: false,
        reason: "revision_conflict",
        current: await current(),
      };
    }
    const kind = patch.kind ?? session.kind;
    const targets = await targetsFor(tx, trainerId, session, scope);
    const targetIds = targets.map((t) => t.id);
    const existing = await tx
      .select()
      .from(coachSessionAttendees)
      .where(inArray(coachSessionAttendees.sessionId, targetIds));
    if (kind === "own_training") {
      const wanted =
        patch.attendees ??
        existing.filter((a) => BOOKED_STATUSES.includes(a.status));
      if (wanted.length > 0)
        return { ok: false, reason: "own_training_attendees" };
    }

    const tz = await trainerTimeZone(tx, trainerId);
    const now = new Date();
    const moves =
      (patch.startsAt !== undefined &&
        patch.startsAt.getTime() !== session.startsAt.getTime()) ||
      (patch.durationMin !== undefined &&
        patch.durationMin !== session.durationMin);
    const resetReminder =
      (patch.startsAt !== undefined &&
        patch.startsAt.getTime() !== session.startsAt.getTime()) ||
      (patch.reminderMinutes !== undefined &&
        patch.reminderMinutes !== session.reminderMinutes);
    const { attendees: requested, startsAt, ...fields } = patch;
    // Only clients still coached when this commits are booked (see
    // stillActive); one whose coaching just ended is left off.
    const wantedAttendees = requested
      ? await stillActive(tx, requested)
      : undefined;

    const added = new Map<string, AttendeeRef[]>();
    const removed = new Map<string, AttendeeRef[]>();
    for (const target of targets) {
      const newStart =
        startsAt === undefined
          ? target.startsAt
          : target.id === session.id
            ? startsAt
            : shiftLikeLocal(target.startsAt, session.startsAt, startsAt, tz);
      await tx
        .update(coachSessions)
        .set({
          ...fields,
          startsAt: newStart,
          revision: sql`${coachSessions.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(coachSessions.id, target.id));
      if (resetReminder) {
        await tx
          .update(coachSessionAttendees)
          .set({ remindedAt: null, updatedAt: now })
          .where(eq(coachSessionAttendees.sessionId, target.id));
      }
      if (wantedAttendees) {
        const mine = existing.filter((a) => a.sessionId === target.id);
        const wantedIds = new Set(wantedAttendees.map((a) => a.relationshipId));
        const toAdd = wantedAttendees.filter(
          (w) =>
            !mine.some(
              (a) =>
                a.relationshipId === w.relationshipId &&
                a.status !== "cancelled",
            ),
        );
        const toRemove = mine.filter(
          (a) => a.status !== "cancelled" && !wantedIds.has(a.relationshipId),
        );
        if (toAdd.length > 0) {
          await tx
            .insert(coachSessionAttendees)
            .values(
              toAdd.map((a) => ({
                sessionId: target.id,
                clientId: a.clientId,
                relationshipId: a.relationshipId,
                status: "invited" as const,
                createdAt: now,
                updatedAt: now,
              })),
            )
            .onConflictDoUpdate({
              target: [
                coachSessionAttendees.sessionId,
                coachSessionAttendees.relationshipId,
              ],
              set: { status: "invited", remindedAt: null, updatedAt: now },
            });
        }
        if (toRemove.length > 0) {
          await tx
            .update(coachSessionAttendees)
            .set({ status: "cancelled", updatedAt: now })
            .where(
              and(
                eq(coachSessionAttendees.sessionId, target.id),
                inArray(
                  coachSessionAttendees.relationshipId,
                  toRemove.map((a) => a.relationshipId),
                ),
              ),
            );
        }
        added.set(target.id, toAdd);
        removed.set(
          target.id,
          toRemove.map((a) => ({
            clientId: a.clientId,
            relationshipId: a.relationshipId,
          })),
        );
      }
    }

    const sessions = await loadSessions(tx, trainerId, targetIds);
    const first = sessions.find((s) => s.id === session.id)!;
    const changes: SessionChange[] = [];
    const firstAdded = added.get(session.id) ?? [];
    const firstRemoved = removed.get(session.id) ?? [];
    const addedIds = new Set(firstAdded.map((a) => a.relationshipId));
    if (moves) {
      // Everyone still booked hears the new time, except those just added,
      // who hear "booked" instead.
      changes.push({
        action: "moved",
        session: first,
        attendees: first.attendees
          .filter(
            (a) =>
              BOOKED_STATUSES.includes(a.status) &&
              !addedIds.has(a.relationshipId),
          )
          .map(({ clientId, relationshipId }) => ({
            clientId,
            relationshipId,
          })),
        occurrences: sessions.length,
      });
    }
    if (firstAdded.length > 0) {
      changes.push({
        action: "booked",
        session: first,
        attendees: firstAdded,
        occurrences: sessions.length,
      });
    }
    if (firstRemoved.length > 0) {
      changes.push({
        action: "cancelled",
        session: first,
        attendees: firstRemoved,
        occurrences: sessions.length,
      });
    }
    return { ok: true, sessions, changes };
  });
}

export interface CancelResult {
  /** Sessions this call cancelled (empty when already cancelled or unknown). */
  sessions: CoachSessionDTO[];
  changes: SessionChange[];
}

/**
 * Cancel a session (`this`) or it and the later live occurrences of its
 * series (`series`). Idempotent: an unknown, someone else's or already
 * cancelled session changes nothing.
 */
export async function cancelSessions(
  trainerId: string,
  sessionId: string,
  scope: SessionScope,
): Promise<CancelResult> {
  return getDb().transaction(async (tx) => {
    const session = await lockOwn(tx, trainerId, sessionId);
    if (!session || session.cancelledAt) return { sessions: [], changes: [] };
    const targets = await targetsFor(tx, trainerId, session, scope);
    const ids = targets.map((t) => t.id);
    const now = new Date();
    await tx
      .update(coachSessions)
      .set({
        cancelledAt: now,
        revision: sql`${coachSessions.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(inArray(coachSessions.id, ids), isNull(coachSessions.cancelledAt)),
      );
    const sessions = await loadSessions(tx, trainerId, ids);
    const first = sessions.find((s) => s.id === session.id)!;
    const attendees = first.attendees
      .filter((a) => BOOKED_STATUSES.includes(a.status))
      .map(({ clientId, relationshipId }) => ({ clientId, relationshipId }));
    return {
      sessions,
      changes:
        attendees.length > 0
          ? [
              {
                action: "cancelled" as const,
                session: first,
                attendees,
                occurrences: sessions.length,
              },
            ]
          : [],
    };
  });
}

/**
 * The coach's calendar for [from, to): every session in range (cancelled ones
 * too, with `cancelledAt`, so an offline cache can drop them) and the forms
 * due in range (design C's requests, not cancelled).
 */
export async function coachCalendar(
  trainerId: string,
  from: Date,
  to: Date,
): Promise<{ sessions: CoachSessionDTO[]; formsDue: CalendarFormDueDTO[] }> {
  const db = getDb();
  const ids = await db
    .select({ id: coachSessions.id })
    .from(coachSessions)
    .where(
      and(
        eq(coachSessions.trainerId, trainerId),
        gte(coachSessions.startsAt, from),
        lt(coachSessions.startsAt, to),
      ),
    );
  const forms = await db
    .select({
      requestId: coachFormRequests.id,
      formId: coachFormRequests.formId,
      formTitle: coachForms.title,
      clientId: coachFormRequests.clientId,
      clientName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      dueAt: coachFormRequests.dueAt,
      status: coachFormRequests.status,
      late: coachFormRequests.late,
    })
    .from(coachFormRequests)
    .innerJoin(coachForms, eq(coachForms.id, coachFormRequests.formId))
    .innerJoin(profiles, eq(profiles.id, coachFormRequests.clientId))
    .where(
      and(
        eq(coachFormRequests.trainerId, trainerId),
        ne(coachFormRequests.status, "cancelled"),
        gte(coachFormRequests.dueAt, from),
        lt(coachFormRequests.dueAt, to),
      ),
    )
    .orderBy(asc(coachFormRequests.dueAt), asc(coachFormRequests.id));
  return {
    sessions: await loadSessions(
      db,
      trainerId,
      ids.map((r) => r.id),
    ),
    formsDue: forms.map((f) => ({
      requestId: f.requestId,
      formId: f.formId,
      formTitle: f.formTitle,
      client: { id: f.clientId, name: f.clientName, avatarUrl: f.avatarUrl },
      dueAt: f.dueAt!.toISOString(),
      status: f.status,
      late: f.late,
    })),
  };
}

/** Today's bookings in the coach's time zone, not cancelled (Today, C2). */
export async function todaySchedule(
  trainerId: string,
  now: Date = new Date(),
): Promise<CoachSessionDTO[]> {
  const db = getDb();
  const tz = await trainerTimeZone(db, trainerId);
  const { start, end } = localDayBounds(now, tz);
  const ids = await db
    .select({ id: coachSessions.id })
    .from(coachSessions)
    .where(
      and(
        eq(coachSessions.trainerId, trainerId),
        isNull(coachSessions.cancelledAt),
        gte(coachSessions.startsAt, start),
        lt(coachSessions.startsAt, end),
      ),
    );
  return loadSessions(
    db,
    trainerId,
    ids.map((r) => r.id),
  );
}

const coachProfile = {
  id: profiles.id,
  name: profiles.fullName,
  avatarUrl: profiles.avatarUrl,
};

/**
 * The athlete's sessions in [from, to) from their active coaches: their own
 * booking only (never other attendees, never the coach's notes). Cancelled
 * sessions and bookings stay in the list with their state, so an offline
 * cache can update.
 */
export async function athleteSessions(
  clientId: string,
  from: Date,
  to: Date,
): Promise<AthleteCoachSessionDTO[]> {
  return athleteRows(
    clientId,
    and(gte(coachSessions.startsAt, from), lt(coachSessions.startsAt, to))!,
  );
}

/** One of the athlete's sessions by id, on the same terms as the list. */
export async function athleteSession(
  clientId: string,
  sessionId: string,
): Promise<AthleteCoachSessionDTO | null> {
  const rows = await athleteRows(clientId, eq(coachSessions.id, sessionId));
  return rows[0] ?? null;
}

async function athleteRows(
  clientId: string,
  filter: SQL,
): Promise<AthleteCoachSessionDTO[]> {
  const rows = await getDb()
    .select({
      session: coachSessions,
      status: coachSessionAttendees.status,
      workoutName: workouts.name,
      coach: coachProfile,
    })
    .from(coachSessionAttendees)
    .innerJoin(
      coachSessions,
      eq(coachSessions.id, coachSessionAttendees.sessionId),
    )
    .innerJoin(
      ptClientRelationships,
      eq(ptClientRelationships.id, coachSessionAttendees.relationshipId),
    )
    .innerJoin(profiles, eq(profiles.id, coachSessions.trainerId))
    .leftJoin(workouts, eq(workouts.id, coachSessions.workoutId))
    .where(
      and(
        eq(coachSessionAttendees.clientId, clientId),
        eq(ptClientRelationships.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
        isNull(profiles.deletedAt),
        filter,
      ),
    )
    .orderBy(asc(coachSessions.startsAt), asc(coachSessions.id));
  return rows.map(({ session: s, status, workoutName, coach }) => ({
    id: s.id,
    kind: s.kind,
    startsAt: s.startsAt.toISOString(),
    endsAt: endsAt(s),
    durationMin: s.durationMin,
    location: s.location,
    videoUrl: s.videoUrl,
    workout:
      s.workoutId && workoutName !== null
        ? { id: s.workoutId, name: workoutName }
        : null,
    seriesId: s.seriesId,
    reminderMinutes: s.reminderMinutes,
    cancelledAt: iso(s.cancelledAt),
    revision: s.revision,
    updatedAt: s.updatedAt.toISOString(),
    status,
    coach,
  }));
}

export type RespondResult =
  | { ok: true; session: AthleteCoachSessionDTO }
  | {
      ok: false;
      reason:
        | "not_found"
        | "session_cancelled"
        | "not_booked"
        | "session_started";
    };

type RespondRefusal = Extract<RespondResult, { ok: false }>["reason"];

interface Booking {
  relationshipId: string;
  attendeeStatus: CoachSessionAttendeeStatus;
  startsAt: Date;
  cancelledAt: Date | null;
}

/** Why a response is refused, or null when it may be recorded. */
function refusalFor(
  booking: Booking | null,
  status: "accepted" | "declined",
  now: Date,
): RespondRefusal | null {
  if (!booking) return "not_found";
  if (booking.cancelledAt) return "session_cancelled";
  if (booking.attendeeStatus === "cancelled") return "not_booked";
  // The same answer again is a harmless replay, even after the start.
  if (booking.attendeeStatus !== status && booking.startsAt <= now) {
    return "session_started";
  }
  return null;
}

/**
 * The athlete accepts or declines their booking. Idempotent; allowed until
 * the session starts. Writes no coach event (Brad, 25 Nov).
 *
 * The UPDATE carries every precondition itself (still booked, session not
 * cancelled and not started, relationship active), so a coach removing the
 * athlete, cancelling the session or coaching ending between the read and
 * the write always wins (Inspector Brad, #568). When it updates nothing,
 * the booking is read again and refused the same way the check would.
 */
export async function respondToSession(
  clientId: string,
  sessionId: string,
  status: "accepted" | "declined",
  now: Date = new Date(),
): Promise<RespondResult> {
  const db = getDb();
  let booking = await readBooking(clientId, sessionId);
  let refusal = refusalFor(booking, status, now);
  if (refusal) return { ok: false, reason: refusal };
  if (booking!.attendeeStatus !== status) {
    const live = db
      .select({ id: coachSessions.id })
      .from(coachSessions)
      .where(
        and(
          eq(coachSessions.id, sessionId),
          isNull(coachSessions.cancelledAt),
          gt(coachSessions.startsAt, now),
        ),
      );
    const active = db
      .select({ id: ptClientRelationships.id })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.clientId, clientId),
          eq(ptClientRelationships.status, "active"),
        ),
      );
    const updated = await db
      .update(coachSessionAttendees)
      .set({ status, updatedAt: now })
      .where(
        and(
          eq(coachSessionAttendees.sessionId, sessionId),
          eq(coachSessionAttendees.clientId, clientId),
          eq(coachSessionAttendees.relationshipId, booking!.relationshipId),
          ne(coachSessionAttendees.status, "cancelled"),
          inArray(coachSessionAttendees.sessionId, live),
          inArray(coachSessionAttendees.relationshipId, active),
        ),
      )
      .returning({ sessionId: coachSessionAttendees.sessionId });
    if (updated.length === 0) {
      booking = await readBooking(clientId, sessionId);
      refusal = refusalFor(booking, status, now);
      // Nothing changed, and not because the same answer landed first.
      if (refusal || booking!.attendeeStatus !== status) {
        return { ok: false, reason: refusal ?? "session_started" };
      }
    }
  }
  // By id, so a move landing meanwhile still finds it (Inspector Brad, #568).
  const session = await athleteSession(clientId, sessionId);
  if (!session) return { ok: false, reason: "not_found" };
  return { ok: true, session };
}

/**
 * The athlete's booking on a session, through an active relationship with a
 * coach whose account isn't deleted: the same terms as the athlete's list,
 * so a session they can't see can't be answered either (404).
 */
async function readBooking(
  clientId: string,
  sessionId: string,
): Promise<Booking | null> {
  const rows = await getDb()
    .select({
      relationshipId: coachSessionAttendees.relationshipId,
      attendeeStatus: coachSessionAttendees.status,
      startsAt: coachSessions.startsAt,
      cancelledAt: coachSessions.cancelledAt,
    })
    .from(coachSessionAttendees)
    .innerJoin(
      coachSessions,
      eq(coachSessions.id, coachSessionAttendees.sessionId),
    )
    .innerJoin(
      ptClientRelationships,
      eq(ptClientRelationships.id, coachSessionAttendees.relationshipId),
    )
    .innerJoin(profiles, eq(profiles.id, coachSessions.trainerId))
    .where(
      and(
        eq(coachSessionAttendees.sessionId, sessionId),
        eq(coachSessionAttendees.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
        isNull(profiles.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Offboarding (design I): coaching ended, so this relationship's bookings on
 * sessions that haven't started are cancelled. Sessions themselves stay (a
 * group session goes on for the others). Returns how many were cancelled.
 */
export async function cancelBookingsForRelationship(
  tx: DbOrTx,
  relationshipId: string,
  now: Date = new Date(),
): Promise<number> {
  const future = tx
    .select({ id: coachSessions.id })
    .from(coachSessions)
    .where(gt(coachSessions.startsAt, now));
  const rows = await tx
    .update(coachSessionAttendees)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        eq(coachSessionAttendees.relationshipId, relationshipId),
        ne(coachSessionAttendees.status, "cancelled"),
        inArray(coachSessionAttendees.sessionId, future),
      ),
    )
    .returning({ sessionId: coachSessionAttendees.sessionId });
  return rows.length;
}

import type {
  TogetherHostDetails,
  TogetherPlanRow,
} from "../../domain/ports/togetherLobby.port";
import type { WorkoutSession } from "../../domain/models/session";

/**
 * Session code and plan preview helpers (PER-60, canvas rows 1/1b/1c).
 *
 * The code is six characters from an alphabet without 0/O and 1/I, shown as
 * `4KQ-928`, stored and compared upper case without the dash. Nearby hosts
 * mint their own and send it inside the signed summary and invitation; Online
 * sessions get theirs from the backend. The plan rows are what a joiner sees
 * under "The plan" before consenting: at most 20 rows, names cut at 80.
 */
export const SESSION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const PLAN_ROWS_MAX = 20;
export const PLAN_NAME_MAX = 80;

export function newSessionCode(randomBytes: (length: number) => Uint8Array) {
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++)
    code += SESSION_CODE_ALPHABET[bytes[i]! % SESSION_CODE_ALPHABET.length];
  return code;
}
/** "4kq 928", "4KQ-928" → "4KQ928"; anything that is not a code → undefined. */
export function normaliseSessionCode(input: string): string | undefined {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return CODE_RE.test(code) ? code : undefined;
}
export function formatSessionCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

export function isPlanRows(value: unknown): value is TogetherPlanRow[] {
  return (
    Array.isArray(value) &&
    value.length <= PLAN_ROWS_MAX &&
    value.every(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as TogetherPlanRow).name === "string" &&
        (row as TogetherPlanRow).name.trim().length > 0 &&
        (row as TogetherPlanRow).name.length <= PLAN_NAME_MAX &&
        Number.isInteger((row as TogetherPlanRow).sets) &&
        (row as TogetherPlanRow).sets >= 1 &&
        (row as TogetherPlanRow).sets <= 100 &&
        ((row as TogetherPlanRow).reps === null ||
          (Number.isInteger((row as TogetherPlanRow).reps) &&
            ((row as TogetherPlanRow).reps as number) >= 0 &&
            ((row as TogetherPlanRow).reps as number) <= 10000)),
    )
  );
}
/** Optional advert details: absent on older hosts, otherwise well formed. */
export function isHostDetails(p: Record<string, unknown>): boolean {
  return (
    (p.startedAt === undefined ||
      (Number.isSafeInteger(p.startedAt) && (p.startedAt as number) > 0)) &&
    (p.plan === undefined || isPlanRows(p.plan)) &&
    (p.code === undefined ||
      (typeof p.code === "string" && CODE_RE.test(p.code)))
  );
}

/** The live workout as plan rows: name, planned sets, the first planned reps. */
export function hostDetailsFrom(session: {
  startedAt: string;
  exercises: WorkoutSession["exercises"];
}): TogetherHostDetails {
  const startedAt = Date.parse(session.startedAt);
  return {
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    plan: [...session.exercises]
      .filter((e) => !e.isSubstituted)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, PLAN_ROWS_MAX)
      .map((e) => ({
        name: e.exerciseName.trim().slice(0, PLAN_NAME_MAX) || "Exercise",
        sets: Math.min(100, Math.max(1, e.sets.length)),
        reps: e.sets.find((s) => s.reps !== null)?.reps ?? null,
      })),
  };
}
/** "4 × 6" when reps are planned, "4 sets" when not. */
export function planRowLabel(row: TogetherPlanRow): string {
  return row.reps === null
    ? `${row.sets} ${row.sets === 1 ? "set" : "sets"}`
    : `${row.sets} × ${row.reps}`;
}
/** "started 18 minutes ago", "started just now", "started 2 hours ago". */
export function startedAgo(startedAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - startedAt) / 60000));
  if (minutes < 1) return "started just now";
  if (minutes < 60)
    return `started ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  return `started ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

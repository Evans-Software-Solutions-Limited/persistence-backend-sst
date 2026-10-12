import type { BootstrapSectionKey } from "@/domain/models/bootstrap";

/**
 * What the bootstrap wrote this process lifetime, per user and section.
 *
 * Several hooks hardcode "stale" and fetch on every mount; on a cold start
 * that mount happens right after the bootstrap has written the same data.
 * They consult this before fetching. It is memory only: a fresh process
 * starts empty, which is exactly the cold-start case the bootstrap serves.
 * Sections that keep part of their result off SQLite (derived habit rows,
 * the optimistic unread count) stash it here as `value`.
 */
type Entry = { at: number; value?: unknown };
const entries = new Map<string, Entry>();
const key = (userId: string, section: BootstrapSectionKey) =>
  `${userId}:${section}`;

export function rememberBootstrapSection(
  userId: string,
  section: BootstrapSectionKey,
  at: number,
  value?: unknown,
): void {
  entries.set(key(userId, section), { at, value });
}

/** The entry when it was written within `maxAgeMs` of `now`, else null. */
export function recallBootstrapSection<T = unknown>(
  userId: string,
  section: BootstrapSectionKey,
  maxAgeMs: number,
  now: number = Date.now(),
): { at: number; value: T | undefined } | null {
  const entry = entries.get(key(userId, section));
  if (!entry || now - entry.at > maxAgeMs) return null;
  return { at: entry.at, value: entry.value as T | undefined };
}

export function forgetBootstrapSections(userId: string): void {
  for (const k of [...entries.keys()])
    if (k.startsWith(`${userId}:`)) entries.delete(k);
}

/** How long a bootstrap write satisfies a mount-time read. */
export const BOOTSTRAP_FRESH_MS = 5 * 60 * 1000;

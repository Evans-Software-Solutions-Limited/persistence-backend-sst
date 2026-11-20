/**
 * Remove NUL bytes (U+0000) from client text before it reaches Postgres.
 *
 * JSON allows "\u0000" and `t.String()` accepts it, but Postgres `text`
 * rejects it (22021, invalid byte sequence for encoding "UTF8": 0x00), so it
 * used to throw inside an insert: a 500 that every re-send of an offline
 * queue entry hits again. Names carrying one come from AI output or pasted
 * text, never typing, so stripping keeps the user's data (Inspector Brad,
 * #542).
 */
export function stripNul(value: string): string {
  return value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;
}

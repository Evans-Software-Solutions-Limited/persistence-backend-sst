/**
 * PER-125: rewrite a `local-…` id once its create has synced, in the queued
 * invited-client rows and the cached profiles. Shared by the SQLite adapter
 * and its in-memory double so both swap identically.
 *
 * Local ids are random (`local-<time><random>`), so a plain text swap can't
 * hit anything else (the same reasoning as `swapLocalNutritionPlanId`).
 */

/** Queue entity types for invited clients (see `coachClientProfiles.command.ts`). */
export const COACH_CLIENT_QUEUE_ENTITIES = [
  "coach_client_profile",
  "coach_client_setup",
  "coach_client_settings",
] as const;

/** The queued set-up rows: their `items[].refId` may name a local id. */
export const COACH_CLIENT_SETUP_QUEUE_ENTITY = "coach_client_setup";

export type QueueRowText = {
  entityId: string | null;
  endpoint: string;
  payload: string;
};

/** `text` with every `localId` swapped for `serverId`. */
export function swapText(text: string, localId: string, serverId: string) {
  return text.split(localId).join(serverId);
}

/** The row with the id swapped everywhere; null when it doesn't mention it. */
export function swapIdInRow(
  row: QueueRowText,
  localId: string,
  serverId: string,
): QueueRowText | null {
  const mentions =
    (row.entityId?.includes(localId) ?? false) ||
    row.endpoint.includes(localId) ||
    row.payload.includes(localId);
  if (!mentions || localId === serverId) return null;
  return {
    entityId:
      row.entityId === null ? null : swapText(row.entityId, localId, serverId),
    endpoint: swapText(row.endpoint, localId, serverId),
    payload: swapText(row.payload, localId, serverId),
  };
}

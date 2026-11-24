/**
 * PER-129: rewrite a coach form's (or send rule's) `local-…` id in one queued
 * row once its create has synced. Shared by the SQLite adapter and its
 * in-memory double so both swap identically.
 */

/** Queue entity types for coach forms (see `coachForms.command.ts`). */
export const COACH_FORMS_QUEUE_ENTITIES = [
  "coach_form",
  "coach_form_schedule",
  "coach_client_form_setup",
  "coach_form_review",
] as const;

export type QueueRowIds = {
  entityId: string | null;
  endpoint: string;
  payload: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The row with `localId` swapped for `serverId` in its entity id segments,
 * its endpoint path segments and its payload's `payloadKey`; null when the
 * row doesn't mention the local id.
 */
export function swapIdInQueueRow(
  row: QueueRowIds,
  localId: string,
  serverId: string,
  payloadKey: "formId" | "scheduleId",
): QueueRowIds | null {
  let changed = false;
  let entityId = row.entityId;
  if (entityId !== null) {
    const parts = entityId.split(":");
    if (parts.includes(localId)) {
      entityId = parts.map((p) => (p === localId ? serverId : p)).join(":");
      changed = true;
    }
  }
  const segment = new RegExp(`/${escapeRegExp(localId)}(?=/|\\?|$)`, "g");
  const endpoint = row.endpoint.replace(segment, `/${serverId}`);
  if (endpoint !== row.endpoint) changed = true;
  let payload = row.payload;
  try {
    const body = JSON.parse(row.payload) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      (body as Record<string, unknown>)[payloadKey] === localId
    ) {
      payload = JSON.stringify({
        ...(body as Record<string, unknown>),
        [payloadKey]: serverId,
      });
      changed = true;
    }
  } catch {
    // An unreadable payload is left for the drain's generic failure path.
  }
  return changed ? { entityId, endpoint, payload } : null;
}

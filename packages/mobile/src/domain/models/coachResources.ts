/**
 * PER-143 (APP-I1): coach resources on the phone. Wire shapes mirror the
 * merged BE-I1 routes (PER-122, `coaching/resources/resourcesHandlers.ts`)
 * 1:1, camelCase on the wire:
 *
 *   GET  /trainers/me/resources                         → { resources }
 *   POST /trainers/me/resources                         → CoachResource
 *   DELETE /trainers/me/resources/:id                   (from every client)
 *   POST /trainers/me/resources/assign                  → { created }
 *   GET  /trainers/me/clients/:clientId/resources       → { resources }
 *   DELETE /trainers/me/clients/:clientId/resources/:assignmentId
 *   POST /trainers/me/media/uploads {purpose:'resource'} → MediaUpload
 *   GET  /users/me/resources                            → { resources }
 *   POST /users/me/resources/:assignmentId/opened
 */

import type { ApiError } from "@/shared/errors/result";

export type ResourceKind = "file" | "link";

/** A coach library resource (C5b). Files carry `mime`/`bytes`, links `url`. */
export type CoachResource = {
  id: string;
  kind: ResourceKind;
  title: string;
  url: string | null;
  mediaId: string | null;
  mime: string | null;
  bytes: number | null;
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One resource on a client's Resources tab (C3.7b), opened or not. */
export type ClientResource = {
  assignmentId: string;
  clientId: string;
  resource: CoachResource;
  assignedAt: string;
  openedAt: string | null;
};

/** One resource the athlete has (Coach tab), with a short-lived file link. */
export type AthleteResource = {
  assignmentId: string;
  resourceId: string;
  kind: ResourceKind;
  title: string;
  /** The link, or a presigned view link for a file (expires). */
  url: string | null;
  urlExpiresAt: string | null;
  mime: string | null;
  bytes: number | null;
  coach: { id: string; name: string; avatarUrl: string | null };
  assignedAt: string;
  openedAt: string | null;
};

export type NewResourceInput = {
  kind: ResourceKind;
  title: string;
  url?: string | null;
  mediaId?: string | null;
};

/** `POST /trainers/me/media/uploads` (design F): a presigned PUT. */
export type ResourceMediaUpload = {
  mediaId: string;
  contentType: string;
  bytes: number;
  status: "pending" | "ready";
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: string;
  } | null;
};

/** A refused create keeps the server's body, so a 422 lands on the form. */
export type ResourceSaveError = ApiError & { body?: unknown };

/**
 * Why an assign was refused. `resources_off` is C3.9's Resources switch
 * (PER-150): nothing in the request was assigned.
 */
export type AssignRefusal =
  | { kind: "resources_off"; clientIds: string[] }
  | { kind: "not_your_client"; clientIds: string[] }
  | { kind: "not_found" }
  | { kind: "offline" }
  | { kind: "other"; message: string };

import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import {
  coachFormRequests,
  coachFormResponses,
  privateMedia,
  type PrivateMedia,
  type PrivateMediaPurpose,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../repositories/personalRecordsRepository";
import {
  visibleRequests,
  type CoachView,
} from "../coaching/forms/requestsRepository";
import {
  checkUpload,
  deleteKeys,
  MAX_PHOTO_BYTES,
  presignUpload,
  presignView,
  type PresignedUpload,
  type ViewLink,
} from "./privateMediaStore";

/**
 * Single private uploads (PER-121, backend design F "private media service"):
 *
 *   - `form_answer`: a photo answering a coach form's photo question
 *     (design C). JPEG only, ≤ 10 MB. Key `forms/<userId>/<mediaId>.jpg`.
 *   - `resource`: a coach's library file (design I, used by BE-I1 / PER-122).
 *     PDF, JPEG or PNG, ≤ 25 MB. Key `resources/<trainerId>/<mediaId>/file.<ext>`
 *     (the resource row doesn't exist yet when the file is uploaded, so the
 *     media id stands in for design I's `<resourceId>`).
 *
 * Every read and write filters by the owner. An upload is `pending` until
 * `finaliseMedia` has checked the object with HeadObject.
 */

export interface PurposeRule {
  contentTypes: readonly string[];
  maxBytes: number;
}

export const PURPOSE_RULES: Record<PrivateMediaPurpose, PurposeRule> = {
  form_answer: { contentTypes: ["image/jpeg"], maxBytes: MAX_PHOTO_BYTES },
  resource: {
    contentTypes: ["application/pdf", "image/jpeg", "image/png"],
    maxBytes: 25 * 1024 * 1024,
  },
};

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function mediaKey(
  ownerId: string,
  mediaId: string,
  purpose: PrivateMediaPurpose,
  contentType: string,
): string {
  return purpose === "form_answer"
    ? `forms/${ownerId}/${mediaId}.jpg`
    : // contentType was validated against PURPOSE_RULES.resource.
      `resources/${ownerId}/${mediaId}/file.${EXTENSIONS[contentType]!}`;
}

export type UploadRequestError = { at: string; message: string };

export function validateUploadRequest(
  purpose: PrivateMediaPurpose,
  contentType: string,
  bytes: number,
): UploadRequestError[] {
  const rule = PURPOSE_RULES[purpose];
  const errors: UploadRequestError[] = [];
  if (!rule.contentTypes.includes(contentType.toLowerCase())) {
    errors.push({
      at: "contentType",
      message: `must be ${rule.contentTypes.join(", ")}`,
    });
  }
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > rule.maxBytes) {
    errors.push({
      at: "bytes",
      message: `must be 1 to ${rule.maxBytes} bytes`,
    });
  }
  return errors;
}

export interface MediaUploadDTO {
  mediaId: string;
  purpose: PrivateMediaPurpose;
  contentType: string;
  bytes: number;
  status: "pending" | "ready";
  /** null once the upload is complete. */
  upload: PresignedUpload | null;
}

async function uploadDto(
  row: PrivateMedia,
  now: Date,
): Promise<MediaUploadDTO> {
  return {
    mediaId: row.id,
    purpose: row.purpose,
    contentType: row.contentType,
    bytes: row.bytes,
    status: row.status as MediaUploadDTO["status"],
    upload:
      row.status === "pending"
        ? await presignUpload(row.s3Key, row.contentType, row.bytes, now)
        : null,
  };
}

async function findByClientRequest(
  ownerId: string,
  clientRequestId: string,
): Promise<PrivateMedia | null> {
  const rows = await getDb()
    .select()
    .from(privateMedia)
    .where(
      and(
        eq(privateMedia.ownerId, ownerId),
        eq(privateMedia.clientRequestId, clientRequestId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * `POST /users/me/media/uploads` and `POST /trainers/me/media/uploads`.
 * Validated by the caller. A retry with the same `Idempotency-Key` returns
 * the same media id (and a fresh link while it is still pending).
 */
export async function createUpload(
  ownerId: string,
  purpose: PrivateMediaPurpose,
  contentType: string,
  bytes: number,
  clientRequestId: string | null,
  now = new Date(),
): Promise<{ replay: boolean; media: MediaUploadDTO }> {
  if (clientRequestId) {
    const existing = await findByClientRequest(ownerId, clientRequestId);
    if (existing)
      return { replay: true, media: await uploadDto(existing, now) };
  }
  const type = contentType.toLowerCase();
  const id = crypto.randomUUID();
  const rows = await getDb()
    .insert(privateMedia)
    .values({
      id,
      ownerId,
      purpose,
      s3Key: mediaKey(ownerId, id, purpose, type),
      contentType: type,
      bytes,
      status: "pending",
      clientRequestId,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  const row =
    rows[0] ?? (await findByClientRequest(ownerId, clientRequestId!))!;
  return { replay: !rows[0], media: await uploadDto(row, now) };
}

export type FinaliseResult =
  | { ok: true; media: PrivateMedia }
  | {
      ok: false;
      reason:
        | "not_found"
        | "missing"
        | "wrong_type"
        | "too_large"
        | "size_mismatch";
    };

/**
 * Check a pending upload with HeadObject and mark it ready. A ready upload is
 * returned as it is. A wrong type or size deletes the object and the row, so
 * the phone uploads again with a new media id. Used by the form photo answer
 * path and by BE-I1 (PER-122) when a resource file is saved.
 */
export async function finaliseMedia(
  ownerId: string,
  mediaId: string,
  purpose: PrivateMediaPurpose,
): Promise<FinaliseResult> {
  const rows = await getDb()
    .select()
    .from(privateMedia)
    .where(
      and(
        eq(privateMedia.id, mediaId),
        eq(privateMedia.ownerId, ownerId),
        eq(privateMedia.purpose, purpose),
      ),
    )
    .limit(1);
  return rows[0] ? finaliseRow(rows[0]) : { ok: false, reason: "not_found" };
}

async function finaliseRow(
  row: PrivateMedia,
): Promise<Exclude<FinaliseResult, { reason: "not_found" }>> {
  if (row.status === "ready") return { ok: true, media: row };
  const check = await checkUpload(row.s3Key, {
    contentTypes: [row.contentType],
    maxBytes: PURPOSE_RULES[row.purpose].maxBytes,
    bytes: row.bytes,
  });
  if (!check.ok) {
    // checkUpload already deleted a bad staged object.
    if (check.reason !== "missing") {
      await getDb()
        .delete(privateMedia)
        .where(
          and(
            eq(privateMedia.id, row.id),
            eq(privateMedia.ownerId, row.ownerId),
          ),
        );
    }
    return { ok: false, reason: check.reason };
  }
  await getDb()
    .update(privateMedia)
    .set({ status: "ready" })
    .where(
      and(eq(privateMedia.id, row.id), eq(privateMedia.ownerId, row.ownerId)),
    );
  return { ok: true, media: { ...row, status: "ready" } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A photo answer's media id: `{mediaId}` or a bare id. Null otherwise. */
export function photoAnswerMediaId(value: unknown): string | null {
  const raw =
    typeof value === "string"
      ? value
      : value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof (value as { mediaId?: unknown }).mediaId === "string"
        ? (value as { mediaId: string }).mediaId
        : null;
  return raw !== null && UUID.test(raw) ? raw.toLowerCase() : null;
}

/**
 * Before a form response is saved: HeadObject every pending photo answer the
 * athlete owns, outside the response's transaction (S3 calls never run while
 * the request row is locked). Anything that fails stays not-ready and the
 * submit answers 422.
 */
export async function finalisePhotoAnswers(
  clientId: string,
  answers: unknown,
): Promise<void> {
  if (
    answers === null ||
    typeof answers !== "object" ||
    Array.isArray(answers)
  ) {
    return;
  }
  const ids = new Set<string>();
  for (const value of Object.values(answers as Record<string, unknown>)) {
    const id = photoAnswerMediaId(value);
    if (id) ids.add(id);
  }
  if (ids.size === 0) return;
  const pending = await getDb()
    .select({ id: privateMedia.id })
    .from(privateMedia)
    .where(
      and(
        eq(privateMedia.ownerId, clientId),
        eq(privateMedia.purpose, "form_answer"),
        eq(privateMedia.status, "pending"),
        inArray(privateMedia.id, [...ids]),
      ),
    );
  for (const row of pending) {
    await finaliseMedia(clientId, row.id, "form_answer");
  }
}

export type PhotoAnswerProblem = { mediaId: string; message: string };

/**
 * Inside the submit transaction: lock the photo answers' media rows and check
 * each is the athlete's own, uploaded, and not already in another response.
 */
export async function lockPhotoAnswers(
  tx: DbOrTx,
  clientId: string,
  mediaIds: string[],
): Promise<PhotoAnswerProblem[]> {
  if (mediaIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(privateMedia)
    .where(
      and(
        eq(privateMedia.ownerId, clientId),
        eq(privateMedia.purpose, "form_answer"),
        inArray(privateMedia.id, mediaIds),
      ),
    )
    .for("update");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const problems: PhotoAnswerProblem[] = [];
  const seen = new Set<string>();
  for (const id of mediaIds) {
    const row = byId.get(id);
    if (seen.has(id)) {
      problems.push({
        mediaId: id,
        message: "must be a different photo for each question",
      });
    } else if (!row) {
      problems.push({ mediaId: id, message: "must be a photo you uploaded" });
    } else if (row.status !== "ready") {
      problems.push({ mediaId: id, message: "must be a finished upload" });
    } else if (row.formResponseId) {
      problems.push({
        mediaId: id,
        message: "must not be used in another response",
      });
    }
    seen.add(id);
  }
  return problems;
}

export async function attachPhotoAnswers(
  tx: DbOrTx,
  clientId: string,
  mediaIds: string[],
  responseId: string,
): Promise<void> {
  if (mediaIds.length === 0) return;
  await tx
    .update(privateMedia)
    .set({ formResponseId: responseId })
    .where(
      and(
        eq(privateMedia.ownerId, clientId),
        inArray(privateMedia.id, mediaIds),
        isNull(privateMedia.formResponseId),
      ),
    );
}

export type ViewResult =
  | { ok: true; media: { mediaId: string; contentType: string } & ViewLink }
  | { ok: false; status: 404; code: "media_not_found" }
  | { ok: false; status: 409; code: "upload_incomplete"; reason: string };

/** The owner's own view of their upload (completes a pending one first). */
export async function ownerView(
  ownerId: string,
  mediaId: string,
  seconds: number,
  now = new Date(),
): Promise<ViewResult> {
  const rows = await getDb()
    .select()
    .from(privateMedia)
    .where(and(eq(privateMedia.id, mediaId), eq(privateMedia.ownerId, ownerId)))
    .limit(1);
  if (!rows[0]) return { ok: false, status: 404, code: "media_not_found" };
  const done = await finaliseRow(rows[0]);
  if (!done.ok) {
    return {
      ok: false,
      status: 409,
      code: "upload_incomplete",
      reason: done.reason,
    };
  }
  const link = await presignView(done.media.s3Key, seconds, now);
  return {
    ok: true,
    media: {
      mediaId: done.media.id,
      contentType: done.media.contentType,
      ...link,
    },
  };
}

/**
 * A coach's view of a client's photo answer: only a ready `form_answer` the
 * client submitted in a response this coach can see — the same
 * `visibleRequests` rule as the forms' response list (current coaching cycle,
 * or an exit form). The handler only builds an ACTIVE view: photos are never
 * shown to a coach after coaching ends (Brad, design F), exit forms included.
 */
export async function coachFormAnswerView(
  view: Extract<CoachView, { kind: "active" }>,
  mediaId: string,
  seconds: number,
  now = new Date(),
): Promise<ViewResult> {
  const rows = await getDb()
    .select({ key: privateMedia.s3Key, contentType: privateMedia.contentType })
    .from(privateMedia)
    .innerJoin(
      coachFormResponses,
      eq(coachFormResponses.id, privateMedia.formResponseId),
    )
    .innerJoin(
      coachFormRequests,
      eq(coachFormRequests.id, coachFormResponses.requestId),
    )
    .where(
      and(
        eq(privateMedia.id, mediaId),
        eq(privateMedia.ownerId, view.clientId),
        eq(privateMedia.purpose, "form_answer"),
        eq(privateMedia.status, "ready"),
        eq(coachFormResponses.clientId, view.clientId),
        visibleRequests(view),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, status: 404, code: "media_not_found" };
  const link = await presignView(row.key, seconds, now);
  return {
    ok: true,
    media: { mediaId, contentType: row.contentType, ...link },
  };
}

/** Pending uploads older than this are removed; so are unused form photos. */
export const STALE_UPLOAD_MS = 2 * 24 * 60 * 60 * 1000;
export const UNUSED_FORM_PHOTO_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Nightly: delete uploads that were never completed (2 days), and form
 * photos that were uploaded but never sent in a response (7 days). Resource
 * files are left to BE-I1. Returns how many were removed.
 */
export async function purgeStaleMedia(now = new Date()): Promise<number> {
  const pendingCutoff = new Date(now.getTime() - STALE_UPLOAD_MS);
  const unusedCutoff = new Date(now.getTime() - UNUSED_FORM_PHOTO_MS);
  // Rows first, objects second, in one transaction: a submit attaching one
  // of these photos waits on the row lock and then finds it gone, so no
  // response can point at a deleted object; an S3 failure rolls the rows
  // back so the next night retries (Inspector Brad, #553).
  return getDb().transaction(async (tx) => {
    const stale = tx
      .select({ id: privateMedia.id })
      .from(privateMedia)
      .where(
        and(
          isNull(privateMedia.formResponseId),
          or(
            and(
              eq(privateMedia.status, "pending"),
              lt(privateMedia.createdAt, pendingCutoff),
            ),
            and(
              eq(privateMedia.purpose, "form_answer"),
              lt(privateMedia.createdAt, unusedCutoff),
            ),
          ),
        ),
      )
      .limit(500);
    const removed = await tx
      .delete(privateMedia)
      .where(
        and(
          inArray(privateMedia.id, stale),
          isNull(privateMedia.formResponseId),
        ),
      )
      .returning({ key: privateMedia.s3Key });
    await deleteKeys(removed.map((r) => r.key));
    return removed.length;
  });
}

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Resource } from "sst";

/**
 * The private media store (PER-121, backend design F): the only code that
 * talks to the private `CoachPrivateMedia` bucket (infra/storage.ts).
 *
 * Upload: a presigned PUT pinned to the key, `Content-Type`, `Content-Length`
 * and the `upload=pending` tag. The phone sends the exact headers returned in
 * `headers`; any other key, type, size or tag fails S3's signature check.
 * The bucket's lifecycle rule deletes objects still tagged `upload=pending`
 * after a day, so an upload that is never completed goes on its own.
 *
 * Complete: `checkUpload` reads the object with HeadObject and checks its
 * type and size, then re-tags it `upload=complete`.
 *
 * View: presigned GETs, minted per request after the caller's access check
 * and never stored.
 */

export const UPLOAD_URL_SECONDS = 10 * 60;
export const OWNER_VIEW_SECONDS = 15 * 60;
export const COACH_VIEW_SECONDS = 5 * 60;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PENDING_TAG = "upload=pending";

// SST's generated `sst-env.d.ts` only learns about a new resource after the
// next `sst dev` / `sst deploy`; this cast keeps `tsc` green until then
// (same pattern as profilesAvatarHandler.ts).
function bucketName(): string {
  return (
    Resource as Resource & {
      CoachPrivateMedia: { name: string };
    }
  ).CoachPrivateMedia.name;
}

// One client per cold start. `WHEN_REQUIRED`: the SDK's default CRC32 of an
// EMPTY body would otherwise be baked into every presigned PUT URL, and S3
// would reject the real upload's checksum.
let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

// The presigner and client-s3 resolve different @smithy/types copies in the
// lockfile, so their Client types don't unify; at runtime they are the same
// SDK. Type-only bridge.
type PresignClient = Parameters<typeof getSignedUrl>[0];
type PresignCommand = Parameters<typeof getSignedUrl>[1];

/** Tests only. */
export function setS3ClientForTests(next: S3Client | null): void {
  client = next;
}

export interface PresignedUpload {
  url: string;
  method: "PUT";
  /** Send exactly these headers with the PUT. */
  headers: Record<string, string>;
  expiresAt: string;
}

export async function presignUpload(
  key: string,
  contentType: string,
  bytes: number,
  now = new Date(),
): Promise<PresignedUpload> {
  const url = await getSignedUrl(
    s3() as unknown as PresignClient,
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      ContentType: contentType,
      ContentLength: bytes,
      Tagging: PENDING_TAG,
    }) as unknown as PresignCommand,
    {
      expiresIn: UPLOAD_URL_SECONDS,
      // Pin type and size into the signature. The tag must stay a signed
      // HEADER: S3 ignores x-amz-tagging when it is hoisted into the query.
      signableHeaders: new Set(["content-type", "content-length"]),
      unhoistableHeaders: new Set(["x-amz-tagging"]),
    },
  );
  return {
    url,
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes),
      "x-amz-tagging": PENDING_TAG,
    },
    expiresAt: new Date(
      now.getTime() + UPLOAD_URL_SECONDS * 1000,
    ).toISOString(),
  };
}

export interface ViewLink {
  url: string;
  expiresAt: string;
}

export async function presignView(
  key: string,
  seconds: number,
  now = new Date(),
): Promise<ViewLink> {
  const url = await getSignedUrl(
    s3() as unknown as PresignClient,
    new GetObjectCommand({
      Bucket: bucketName(),
      Key: key,
    }) as unknown as PresignCommand,
    { expiresIn: seconds },
  );
  return {
    url,
    expiresAt: new Date(now.getTime() + seconds * 1000).toISOString(),
  };
}

export type UploadCheck =
  | { ok: true; bytes: number }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "wrong_type" | "too_large" | "size_mismatch" };

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/**
 * HeadObject the upload and check it against what the link pinned. A good
 * object is re-tagged `upload=complete` so the lifecycle rule keeps it.
 * Any other S3 error is thrown (the caller answers 5xx; complete is retried).
 */
export async function checkUpload(
  key: string,
  expected: {
    contentTypes: readonly string[];
    maxBytes: number;
    bytes: number;
  },
): Promise<UploadCheck> {
  let head;
  try {
    head = await s3().send(
      new HeadObjectCommand({ Bucket: bucketName(), Key: key }),
    );
  } catch (err) {
    if (isNotFound(err)) return { ok: false, reason: "missing" };
    throw err;
  }
  const type = (head.ContentType ?? "").toLowerCase();
  const size = head.ContentLength ?? 0;
  if (!expected.contentTypes.includes(type)) {
    return { ok: false, reason: "wrong_type" };
  }
  if (size > expected.maxBytes) return { ok: false, reason: "too_large" };
  if (size !== expected.bytes) return { ok: false, reason: "size_mismatch" };
  await s3().send(
    new PutObjectTaggingCommand({
      Bucket: bucketName(),
      Key: key,
      Tagging: { TagSet: [{ Key: "upload", Value: "complete" }] },
    }),
  );
  return { ok: true, bytes: size };
}

/** Delete these keys (missing keys are fine). Throws if S3 reports errors. */
export async function deleteKeys(keys: readonly string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const res = await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucketName(),
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (res.Errors && res.Errors.length > 0) {
      throw new Error(
        `private media delete failed for ${res.Errors.length} object(s)`,
      );
    }
  }
}

/** Delete every object under `prefix`. Returns how many were deleted. */
export async function deletePrefix(prefix: string): Promise<number> {
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucketName(),
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    const keys = (page.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => typeof k === "string");
    await deleteKeys(keys);
    deleted += keys.length;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

/** Every key prefix that holds a user's objects (design F key layout). */
export function userPrefixes(userId: string): string[] {
  return [`progress/${userId}/`, `forms/${userId}/`, `resources/${userId}/`];
}

/**
 * The account purge: delete every object the user owns. Throws on failure,
 * so the purge retries the account on the next night.
 */
export async function deleteAllUserMedia(userId: string): Promise<number> {
  let total = 0;
  for (const prefix of userPrefixes(userId)) {
    total += await deletePrefix(prefix);
  }
  return total;
}

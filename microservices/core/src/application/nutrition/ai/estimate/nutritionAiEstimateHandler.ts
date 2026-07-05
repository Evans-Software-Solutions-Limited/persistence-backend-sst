import Elysia, { t } from "elysia";
import {
  estimateFromPhoto,
  AiUnreadableError,
  AiUnavailableError,
} from "../../services/aiEstimation";
import {
  assertEntitlement,
  EntitlementError,
} from "../../../entitlement/assertEntitlement";
import { AiUsageLogService } from "../../../repositories/aiUsageLogService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const ENDPOINT = "/nutrition/ai/estimate";

// Daily per-user inference ceiling (cross-cuts § 4.3 Revised 2026-07-05).
// A cost backstop with a deliberate profit buffer, NOT a product quota:
// 12 photo estimates/day ≈ 2× the heaviest legitimate use (every meal +
// retries), and a worst-case abuser costs ~£5.50/mo against a £12.99
// premium sub. Counted against ACTUAL inferences only (see the
// reached-model gate on the usage-log write below).
// Fail-safe parse: a mis-set env var (garbage → NaN, "" → 0) must not
// silently disable the cost guard — anything non-finite/non-positive
// falls back to the default.
const parsedPhotoLimit = Number(process.env.AI_PHOTO_DAILY_LIMIT);
const AI_PHOTO_DAILY_LIMIT =
  Number.isFinite(parsedPhotoLimit) && parsedPhotoLimit > 0
    ? parsedPhotoLimit
    : 12;

// 5 MB — the client downscales + compresses to ~150-530 KB before
// sending (design.md § Revised 2026-07-03 "Image transport"), so this
// cap is a generous abuse guard, not the expected steady-state size.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
// Full 8-byte PNG signature (89 50 4E 47 0D 0A 1A 0A).
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Elysia-schema ceiling on the base64 string itself: rejects grossly
// oversized bodies during validation, BEFORE the handler body runs and
// before any decode/stringify allocation. 5MB decoded ≈ 6.67MB encoded;
// 7MB leaves headroom so legitimate near-cap uploads still reach the
// precise MAX_IMAGE_BYTES checks below (which own the 413 semantics).
// Beyond this ceiling the client gets Elysia's standard 422 validation
// error — acceptable: the app never produces such payloads (client
// downscales to ~150-530 KB).
const MAX_IMAGE_BASE64_LENGTH = 7 * 1024 * 1024;

/**
 * Decode base64 → Buffer, or `null` on malformed input. Malformed base64
 * is treated the same as a magic-byte mismatch (400 invalid_image_data)
 * rather than a 500 — it's untrusted client input.
 */
function decodeBase64(imageBase64: string): Buffer | null {
  try {
    const buf = Buffer.from(imageBase64, "base64");
    // Buffer.from with invalid base64 doesn't always throw — it silently
    // drops invalid characters, which can produce a suspiciously short
    // buffer for well-formed-looking input. An empty result is never a
    // valid image.
    if (buf.length === 0) return null;
    return buf;
  } catch {
    return null;
  }
}

function hasMagicBytes(buf: Buffer, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  return magic.every((byte, i) => buf[i] === byte);
}

/**
 * POST /nutrition/ai/estimate — base64 JSON photo → `AiEstimate` (Tier B,
 * M9.5). See specs/13-nutrition-tracking/design.md § Revised 2026-07-03.
 *
 * Order: auth → entitlement (`ai_access`) → size cap → magic-byte check
 * → adapter call → response. `ai_usage_log` is written in a `finally` on
 * every path (success or failure) per cross-cuts § 4.2 — a usage-log
 * write failure never fails the user-facing response.
 */
export const nutritionAiEstimateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(AiUsageLogService)
  .post(
    "/nutrition/ai/estimate",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const startedAt = Date.now();
      const requestSizeBytes = Buffer.byteLength(JSON.stringify(ctx.body));
      let responseSizeBytes: number | null = null;
      // The usage log records ACTUAL inferences (success, 422, 503) — not
      // pre-model rejections (402/400/413/429), which cost nothing and
      // must not consume the daily ceiling.
      let reachedModel = false;

      try {
        const verdict = await assertEntitlement(userId, "ai_access");
        if (!verdict.allowed) {
          throw new EntitlementError(verdict, "ai_access");
        }

        // Daily ceiling. Best-effort under concurrency (the counted rows
        // are committed post-inference), which is fine for a backstop.
        const usedToday = await ctx.AiUsageLogRepository.countForUserToday(
          userId,
          ENDPOINT,
        );
        if (usedToday >= AI_PHOTO_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        const { imageBase64, mediaType, mealType } = ctx.body;

        const decoded = decodeBase64(imageBase64);
        if (decoded === null) {
          // Malformed / empty base64 — distinct from "too large", so it
          // gets the same 400 the magic-byte mismatch below uses rather
          // than a misleading 413.
          ctx.set.status = 400;
          const body = { error: "invalid_image_data" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }

        const encodedBytes = Buffer.byteLength(imageBase64, "utf8");
        if (
          decoded.length > MAX_IMAGE_BYTES ||
          encodedBytes > MAX_IMAGE_BYTES
        ) {
          ctx.set.status = 413;
          const body = { error: "image_too_large" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }

        const magicOk =
          mediaType === "image/jpeg"
            ? hasMagicBytes(decoded, JPEG_MAGIC)
            : hasMagicBytes(decoded, PNG_MAGIC);
        if (!magicOk) {
          ctx.set.status = 400;
          const body = { error: "invalid_image_data" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }

        reachedModel = true;
        const estimate = await estimateFromPhoto({
          imageBase64,
          mediaType,
          mealType,
        });

        const body = { data: estimate };
        responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
        return body;
      } catch (error) {
        if (error instanceof AiUnreadableError) {
          ctx.set.status = 422;
          const body = { error: "ai_unreadable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        if (error instanceof AiUnavailableError) {
          ctx.set.status = 503;
          const body = { error: "ai_unavailable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        // EntitlementError and anything unexpected re-throw for
        // coreErrorHandler to map (402 / 500 respectively). The usage-log
        // write still fires below via `finally`.
        throw error;
      } finally {
        try {
          if (reachedModel) {
            await ctx.AiUsageLogRepository.record({
              userId,
              endpoint: ENDPOINT,
              requestSizeBytes,
              responseSizeBytes,
              ms: Date.now() - startedAt,
            });
          }
        } catch (logError) {
          // Best-effort telemetry (cross-cuts § 4.2) — never fail the
          // user-facing response because the usage-log insert failed.
          console.error(
            `[ai-usage-log] failed to record ${ENDPOINT}: ${
              logError instanceof Error ? logError.message : String(logError)
            }`,
          );
        }
      }
    },
    {
      body: t.Object({
        imageBase64: t.String({
          minLength: 1,
          maxLength: MAX_IMAGE_BASE64_LENGTH,
        }),
        mediaType: t.Union([t.Literal("image/jpeg"), t.Literal("image/png")]),
        mealType: t.Optional(t.String()),
      }),
    },
  );

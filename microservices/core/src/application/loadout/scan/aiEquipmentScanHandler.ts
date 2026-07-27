import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";
import { AiUsageLogService } from "../../repositories/aiUsageLogService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";
import {
  AiUnavailableError,
  AiUnreadableError,
} from "../../nutrition/services/aiBedrockClient";
import {
  decodeBase64,
  hasValidImageMagicBytes,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_BASE64_LENGTH,
} from "../../nutrition/ai/imageValidation";
import {
  scanEquipmentFromPhoto,
  SCAN_EXCLUDED_EQUIPMENT_NAME,
  type ScanCatalogueEntry,
  type ScanDetection,
} from "./equipmentScanModel";

const ENDPOINT = "/ai/equipment-scan";

/**
 * Daily per-user ceiling on equipment scans (AC-10.1, T-3.1).
 *
 * **6/day — recommended by Claude and accepted by Brad 2026-07-27**, against
 * design § 8.1's original proposal of 10. Both the number and the reason it is
 * lower than the re-map's 30 come out of the same arithmetic:
 *
 * | | unit cost | ceiling | worst case / user / month |
 * |---|---|---|---|
 * | re-map (Haiku-class) | $0.0057 | 30/day | $5.13 |
 * | **scan (Opus-class)** | **$0.0272** | **6/day** | **$4.90** |
 *
 * So 6 puts the scan at cost parity with the re-map, and the two Premium+
 * differentiator surfaces together at ~$10/month worst case against £29.99 gross
 * (~£25.49 net of Apple's 15 % Small Business rate, ≈ $32). 10/day would put the
 * scan alone at $8.16 — a quarter of net revenue for one endpoint.
 *
 * ## Why the scan can be tight where the re-map had to be generous
 *
 * Two reasons, and neither is about money:
 *
 * 1. **A scan is a once-per-GYM action, not a daily one.** `saved_gyms` persists
 *    the result, so the legitimate heavy day is setting up two or three gyms
 *    (home, commercial, hotel) at two or three photos each — with retries on a bad
 *    photo, 6 covers a thorough onboarding session. Nothing about training daily
 *    implies scanning daily. § 8.1's proposed 10 came from mirroring Mealprint's
 *    suggest/day-plan/swap ceilings, which are genuinely daily-use surfaces; the
 *    analogy is the weakest part of that proposal.
 * 2. **Hitting this cap does not block a workout.** AC-2.1 (saved gym) and AC-2.2
 *    (manual picklist) are "the floor, not fallbacks" (design § 1b), so a capped
 *    user still builds their gym and still adapts. The re-map has no such
 *    alternative — its bad failure is a real athlete stuck mid-session — which is
 *    exactly why 30 was the right call there and 6 is the right call here.
 *
 * Revisit if § 8.1's 640 px downscale gets measured: E1 ran at 1568 px, and a
 * cheaper unit cost would buy a higher ceiling on the same budget.
 *
 * Fail-safe parse: a mis-set env var (garbage → NaN, "" → 0) must not silently
 * disable the guard, so anything non-finite or non-positive falls back to the
 * default (#156 pattern).
 */
const parsedScanLimit = Number(process.env.AI_EQUIPMENT_SCAN_DAILY_LIMIT);
const AI_EQUIPMENT_SCAN_DAILY_LIMIT =
  Number.isFinite(parsedScanLimit) && parsedScanLimit > 0 ? parsedScanLimit : 6;

/**
 * One selectable row of the draft.
 *
 * `source` distinguishes what the photo evidenced from what the server added:
 * `Bodyweight` is always injected (T-E1.7) and the client can present it
 * differently from a real detection rather than implying the camera saw it.
 */
export interface ScanDetectedItem {
  equipmentTypeId: string;
  name: string;
  confidence: number;
  source: "model" | "injected";
}

/**
 * Collapse repeats and keep the most confident reading of each catalogue id.
 *
 * The prompt asks for one entry per item (rule 2), but a room with three squat
 * racks in it is exactly the kind of thing a vision model enumerates, and a
 * duplicated id would render as a duplicate chip in the draft. Unmatched rows
 * (`equipmentTypeId: null`) are NOT deduplicated by label: two genuinely different
 * unrecognised machines are two facts, and their labels are the model's free text
 * rather than a key.
 */
export function dedupeDetections(
  detections: readonly ScanDetection[],
): ScanDetection[] {
  const byId = new Map<string, ScanDetection>();
  const unmatched: ScanDetection[] = [];

  for (const detection of detections) {
    if (detection.equipmentTypeId === null) {
      unmatched.push(detection);
      continue;
    }
    const existing = byId.get(detection.equipmentTypeId);
    if (!existing || detection.confidence > existing.confidence) {
      byId.set(detection.equipmentTypeId, detection);
    }
  }

  return [...byId.values(), ...unmatched];
}

/**
 * POST /ai/equipment-scan — a photo of a gym → a DRAFT list of equipment the user
 * confirms (spec-21 § 8, AC-2.3). Persists nothing: confirming the draft never
 * implicitly saves a gym, and the ids only become an equipment context when the
 * caller passes them to the preview or saves them as a `saved_gym`.
 *
 * ## Guard order — this IS the cost-safety contract (design § 8.1)
 *
 *   auth → entitlement (`loadout`) → daily ceiling → base64 decode → size cap
 *   → magic-byte check → model → parse → membership validation → 200
 *
 * Every rejection before the model is free, and `reachedModel` keeps all of them
 * (402/400/413/429) out of `ai_usage_log` so they consume no quota. Cloned from
 * `nutritionAiEstimateHandler` deliberately — that order is load-bearing and this
 * endpoint is 5× the unit cost, so it is the wrong place to improvise.
 *
 * ## What reaches the user, and what of it is trusted
 *
 * Matched detections are rendered from the **catalogue's** name, not the model's
 * `label`, so nothing untrusted reaches the UI on the selectable path. Only
 * `unmatched[].label` and `notes` carry the model's own words — both capped, both
 * to be rendered as plain text (see `../modelProse`; the input is a photograph the
 * caller chose, so a photographed instruction is a real injection channel).
 */
export const aiEquipmentScanHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ExerciseService)
  .use(AiUsageLogService)
  .post(
    ENDPOINT,
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const startedAt = Date.now();
      const requestSizeBytes = Buffer.byteLength(JSON.stringify(ctx.body));
      let responseSizeBytes: number | null = null;
      // Usage rows record ACTUAL inferences (success, 422, 503) — never pre-model
      // rejections, which cost nothing and must not burn one of six daily scans.
      let reachedModel = false;

      try {
        const verdict = await assertEntitlement(userId, "loadout");
        if (!verdict.allowed) {
          throw new EntitlementError(verdict, "loadout");
        }

        // Best-effort under concurrency (counted rows are committed
        // post-inference), which is fine for a cost backstop.
        const usedToday = await ctx.AiUsageLogRepository.countForUserToday(
          userId,
          ENDPOINT,
        );
        if (usedToday >= AI_EQUIPMENT_SCAN_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        const { imageBase64, mediaType } = ctx.body;

        const decoded = decodeBase64(imageBase64);
        if (decoded === null) {
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

        if (!hasValidImageMagicBytes(decoded, mediaType)) {
          ctx.set.status = 400;
          const body = { error: "invalid_image_data" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }

        const equipmentTypes = await ctx.ExerciseRepository.getEquipmentTypes();

        // `Bodyweight` is withheld from the model and injected below (T-E1.7).
        const bodyweight = equipmentTypes.find(
          (row) => row.name === SCAN_EXCLUDED_EQUIPMENT_NAME,
        );
        if (!bodyweight) {
          // Loudly, because a silent name-resolution miss is exactly how T-E.10
          // shipped: `seedExercises.ts` dropped unmapped equipment names without a
          // word and left `Leg Press` performable with no equipment at all. If
          // this row is ever renamed, every scan silently stops offering
          // bodyweight work and the adaptation gets worse for no visible reason.
          console.warn(
            `[loadout] equipment_types has no "${SCAN_EXCLUDED_EQUIPMENT_NAME}" row — scans cannot inject it (T-E1.7); check the seed`,
          );
        }

        const catalogue: ScanCatalogueEntry[] = equipmentTypes
          .filter((row) => row.name !== SCAN_EXCLUDED_EQUIPMENT_NAME)
          .map((row) => ({ id: row.id, name: row.name }));

        // Set LAST, immediately before the provider call: anything that can still
        // fail before Bedrock is reached — the catalogue read above, for instance —
        // must not write a usage row, or a DB blip burns one of six daily scans for
        // an inference that never happened.
        reachedModel = true;
        const result = await scanEquipmentFromPhoto({
          imageBase64,
          mediaType,
          catalogue,
        });

        const nameById = new Map(
          catalogue.map((entry) => [entry.id, entry.name]),
        );
        const deduped = dedupeDetections(result.detections);

        const detected: ScanDetectedItem[] = deduped
          .filter(
            (
              detection,
            ): detection is ScanDetection & { equipmentTypeId: string } =>
              detection.equipmentTypeId !== null,
          )
          .map(
            (detection): ScanDetectedItem => ({
              equipmentTypeId: detection.equipmentTypeId,
              // Catalogue name, never the model's label — this is the selectable
              // path, and it has to speak the same vocabulary as the manual
              // picker.
              name: nameById.get(detection.equipmentTypeId) as string,
              confidence: detection.confidence,
              source: "model",
            }),
          )
          .sort(
            (a, b) =>
              b.confidence - a.confidence || a.name.localeCompare(b.name),
          );

        if (bodyweight) {
          // Always present, always first, confidence 1 — it is a property of every
          // room rather than something the photo evidences (T-E1.7).
          detected.unshift({
            equipmentTypeId: bodyweight.id,
            name: bodyweight.name,
            confidence: 1,
            source: "injected",
          });
        }

        const body = {
          data: {
            detected,
            // Informational only, never selectable: telling the user "I saw a
            // landmine attachment but cannot offer it" is honest, and stops a
            // correctly-nulled item reading as a miss. E1 had 6 such items.
            unmatched: deduped
              .filter((detection) => detection.equipmentTypeId === null)
              .map((detection) => ({
                label: detection.label,
                confidence: detection.confidence,
              })),
            notes: result.notes,
            modelId: result.modelId,
          },
        };
        responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
        return body;
      } catch (error) {
        // A hallucinated id, a refusal, a truncated payload or a malformed tool
        // input — all parse failures (§ 1 rule 1), never a fabricated detection.
        if (error instanceof AiUnreadableError) {
          ctx.set.status = 422;
          const body = { error: "ai_unreadable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        if (error instanceof AiUnavailableError) {
          // No fallback, by the same argument the re-map's 503 rests on: there is
          // no cheaper way to read a photograph, and the manual picklist is a
          // better answer than a worse guess under a Premium+ badge. The client
          // must say the scan is unavailable — NOT "try rephrasing", which is the
          // mistake the two nutrition surfaces still make.
          ctx.set.status = 503;
          const body = { error: "ai_unavailable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
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
          // Best-effort telemetry (cross-cuts § 4.2) — never fail the user-facing
          // response because the usage-log insert failed.
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
      }),
    },
  );

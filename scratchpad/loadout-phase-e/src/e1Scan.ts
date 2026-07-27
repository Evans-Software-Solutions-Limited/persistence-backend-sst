/**
 * Phase E · T-E1.2/T-E1.3 — E1: can a vision model read a gym?
 *
 *   AWS_PROFILE=ess-dev AWS_REGION=eu-west-2 E1_PHOTO_DIR=/abs/path/to/photos \
 *     bun scratchpad/loadout-phase-e/src/e1Scan.ts --model=opus
 *
 * Photo + the full seeded `equipment_types` catalogue as the candidate list →
 * forced tool use → ids validated for membership in TypeScript (design § 1, § 8).
 * No route, no endpoint: this is the same contract T-3.3 will implement, measured
 * offline first.
 *
 * ⚠ The dataset is 7 photos, 6 of them stock. Every figure this prints is a
 * CEILING — see `e1Fixtures.ts` and the verdict.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createWithRetry,
  findToolUse,
  getDefaultClient,
  type MessagesCreateParams,
} from "../../../microservices/core/src/application/nutrition/services/aiBedrockClient.ts";
import { loadLibrary } from "./library.ts";
import { assertDevEnvironment, MODELS, PRICE_PER_MTOK } from "./armB.ts";
import { E1_PHOTOS, type E1Photo } from "./e1Fixtures.ts";

const TOOL_NAME = "report_detected_equipment";

type Detection = {
  equipmentTypeId: string | null;
  label: string;
  confidence: number;
};

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    detected: {
      type: "array",
      items: {
        type: "object",
        properties: {
          equipmentTypeId: {
            type: ["string", "null"],
            description:
              "An id copied exactly from the catalogue, or null if the item is not in it.",
          },
          label: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["equipmentTypeId", "label", "confidence"],
      },
    },
    notes: { type: "string" },
  },
  required: ["detected", "notes"],
} as const;

function buildPrompt(
  catalogue: { id: string; name: string; category: string }[],
): string {
  return [
    "This is a photo of a gym — it could be a commercial floor, a hotel gym, a home",
    "garage, or a spare room. Identify the training equipment a person could actually",
    "use in this space.",
    "",
    "EQUIPMENT CATALOGUE — the only ids you may return:",
    ...catalogue.map((row) => `- ${row.id} | ${row.name} (${row.category})`),
    "",
    "Rules:",
    "1. `equipmentTypeId` MUST be copied exactly from the catalogue above.",
    "2. If you can see equipment that is NOT in the catalogue, return it with",
    "   `equipmentTypeId: null` and a short `label`. Do NOT force it onto the nearest",
    "   catalogue row — a punch bag is not a medicine ball.",
    "3. Only report what you can actually SEE in this photo. Do not infer what a gym",
    "   like this usually has.",
    "4. Be careful with look-alikes: a road bicycle is not an exercise bike,",
    "   interlocking rubber floor tiles are not a yoga mat, a bench with an incline",
    "   is still a bench.",
    "5. `confidence` is 0-1: use it honestly. Something half-hidden or in deep shadow",
    "   should score low, not be omitted.",
    "6. One entry per distinct piece of equipment. A rack of ten dumbbells is ONE",
    "   dumbbells entry.",
    "",
    "`notes`: anything a user should confirm — occluded items, things you were unsure",
    "about, parts of the room you cannot see.",
  ].join("\n");
}

type PhotoScore = {
  file: string;
  provenance: string;
  hits: string[];
  misses: string[];
  falsePositives: string[];
  trapsTripped: string[];
  ambiguousDetected: string[];
  /** Null-id detections whose label plausibly matches a `notInCatalogue` item — the escape hatch used CORRECTLY. */
  nullIdOnGroundTruth: string[];
  /** Null-id detections naming something that IS a catalogue row — a FAILURE to use the catalogue, not a success. */
  nullIdDespiteCatalogueRow: string[];
  /** Everything else returned with a null id: furniture, decor, junk. Unscoreable either way. */
  nullIdUnscoreable: string[];
  invalidIds: string[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

function score(
  photo: E1Photo,
  detections: Detection[],
  nameById: Map<string, string>,
): Omit<PhotoScore, "latencyMs" | "inputTokens" | "outputTokens"> {
  const invalidIds: string[] = [];
  const detectedNames = new Set<string>();
  const nullIds: string[] = [];

  for (const detection of detections) {
    if (detection.equipmentTypeId === null) {
      nullIds.push(detection.label);
      continue;
    }
    const name = nameById.get(detection.equipmentTypeId);
    // Membership validation — a non-member id is a 422 in production (design § 1).
    if (!name) {
      invalidIds.push(detection.equipmentTypeId);
      continue;
    }
    detectedNames.add(name);
  }

  const present = new Set(photo.present);
  const ambiguous = new Set(photo.ambiguous);
  const traps = new Set(photo.traps);

  const hits = [...detectedNames].filter((n) => present.has(n)).sort();
  const misses = photo.present.filter((n) => !detectedNames.has(n)).sort();
  const ambiguousDetected = [...detectedNames]
    .filter((n) => ambiguous.has(n))
    .sort();
  // Ambiguous detections are excluded from false positives on purpose.
  const falsePositives = [...detectedNames]
    .filter((n) => !present.has(n) && !ambiguous.has(n))
    .sort();
  const trapsTripped = falsePositives.filter((n) => traps.has(n));

  // A null-id detection is only *correct* if it names something that genuinely has
  // no catalogue row. Splitting three ways rather than counting them all as
  // successes — the raw count rewards volume and hides the opposite failure, a
  // model describing a catalogue row in prose instead of selecting its id.
  // (IB sweep 3, 2026-07-27: 2 of Haiku's 3 "correct" nulls were catalogue rows.)
  // Only the text before the first parenthesis: models put location notes there
  // ("Weight plates (on barbell...)"), and matching the whole string mistook those
  // for the model describing a catalogue row in prose.
  const words = (text: string) => text.split("(")[0].toLowerCase();
  const namesACatalogueRow = (label: string) =>
    [...nameById.values()].some((name) => {
      const head = name.split(" / ")[0].toLowerCase().replace(/s$/, "");
      return head.length > 3 && words(label).includes(head);
    });
  const matchesGroundTruth = (label: string) =>
    photo.notInCatalogue.some((item) =>
      item
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((t) => t.length > 3)
        .some((token) => words(label).includes(token)),
    );

  return {
    file: photo.file,
    provenance: photo.provenance,
    hits,
    misses,
    falsePositives,
    trapsTripped,
    ambiguousDetected,
    nullIdOnGroundTruth: nullIds.filter(matchesGroundTruth),
    nullIdDespiteCatalogueRow: nullIds.filter(
      (l) => !matchesGroundTruth(l) && namesACatalogueRow(l),
    ),
    nullIdUnscoreable: nullIds.filter(
      (l) => !matchesGroundTruth(l) && !namesACatalogueRow(l),
    ),
    invalidIds,
  };
}

async function main(): Promise<void> {
  const modelKey = (process.argv
    .find((a) => a.startsWith("--model="))
    ?.slice(8) ?? "opus") as keyof typeof MODELS;
  const modelId = MODELS[modelKey];
  const photoDir = process.env.E1_PHOTO_DIR;
  if (!photoDir)
    throw new Error("set E1_PHOTO_DIR to the (out-of-repo) photo directory");
  assertDevEnvironment(modelId);

  const library = loadLibrary();
  // Ids are slugs here, same stand-in as E2 — the eval never touches a database.
  const catalogue = library.equipmentTypes.map((row) => ({
    id: row.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    name: row.name,
    category: row.category,
  }));
  const nameById = new Map(catalogue.map((row) => [row.id, row.name]));
  const prompt = buildPrompt(catalogue);
  const client = getDefaultClient();
  const price = PRICE_PER_MTOK[modelId];
  if (!price) throw new Error(`unpriced model id: ${modelId}`);

  const scores: PhotoScore[] = [];
  for (const photo of E1_PHOTOS) {
    const data = readFileSync(join(photoDir, photo.file)).toString("base64");
    const params: MessagesCreateParams = {
      model: modelId,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          input_schema: TOOL_SCHEMA as unknown as Record<string, unknown>,
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
    };

    const startedAt = performance.now();
    const response = await createWithRetry(client, params);
    const latencyMs = Math.round(performance.now() - startedAt);
    const usage = (
      response as unknown as {
        usage?: { input_tokens?: number; output_tokens?: number };
      }
    ).usage;

    const input = findToolUse(response, TOOL_NAME) as { detected?: unknown };
    const detections = Array.isArray(input.detected)
      ? (input.detected as Detection[]).filter(
          (d) => typeof d === "object" && d !== null && "label" in d,
        )
      : [];

    scores.push({
      ...score(photo, detections, nameById),
      latencyMs,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
    });
    console.log(
      `${photo.file} (${photo.provenance}): ${scores.at(-1)!.hits.length}/${photo.present.length} hits, ${scores.at(-1)!.falsePositives.length} FP${scores.at(-1)!.trapsTripped.length > 0 ? ` [traps: ${scores.at(-1)!.trapsTripped.join(", ")}]` : ""}`,
    );
  }

  const totalPresent = E1_PHOTOS.reduce((sum, p) => sum + p.present.length, 0);
  const totalHits = scores.reduce((sum, s) => sum + s.hits.length, 0);
  const real = scores.filter((s) => s.provenance === "real-phone-photo");
  const realPresent = E1_PHOTOS.filter(
    (p) => p.provenance === "real-phone-photo",
  ).reduce((sum, p) => sum + p.present.length, 0);

  const summary = {
    modelId,
    photos: scores.length,
    recall: Number((totalHits / totalPresent).toFixed(3)),
    totalHits,
    totalPresent,
    totalMisses: scores.reduce((sum, s) => sum + s.misses.length, 0),
    totalFalsePositives: scores.reduce(
      (sum, s) => sum + s.falsePositives.length,
      0,
    ),
    trapsTripped: scores.flatMap((s) => s.trapsTripped),
    totalAmbiguousDetected: scores.reduce(
      (sum, s) => sum + s.ambiguousDetected.length,
      0,
    ),
    invalidIdsReturned: scores.reduce((sum, s) => sum + s.invalidIds.length, 0),
    nullLabelledItems: scores.reduce(
      (sum, s) => sum + s.nullLabelled.length,
      0,
    ),
    // The only figure not inflated by stock photography.
    realPhonePhotoRecall:
      realPresent === 0
        ? null
        : Number(
            (
              real.reduce((sum, s) => sum + s.hits.length, 0) / realPresent
            ).toFixed(3),
          ),
    meanLatencyMs: Math.round(
      scores.reduce((sum, s) => sum + s.latencyMs, 0) / scores.length,
    ),
    meanInputTokens: Math.round(
      scores.reduce((sum, s) => sum + s.inputTokens, 0) / scores.length,
    ),
    meanOutputTokens: Math.round(
      scores.reduce((sum, s) => sum + s.outputTokens, 0) / scores.length,
    ),
    // Emitted rather than hand-derived — STATE.md § Lessons: if a doc quotes a
    // measurement, ship the command that regenerates it.
    costPerScanUsd: Number(
      (
        scores.reduce(
          (sum, s) =>
            sum +
            (s.inputTokens / 1_000_000) * price.input +
            (s.outputTokens / 1_000_000) * price.output,
          0,
        ) / scores.length
      ).toFixed(5),
    ),
  };

  console.log(JSON.stringify({ summary, scores }, null, 2));
}

await main();

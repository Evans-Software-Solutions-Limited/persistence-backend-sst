/**
 * Recompute E1's figures from the committed `results/e1-*.json`, with the
 * corrected metric definitions. Free, offline, no Bedrock.
 *
 *   bun scratchpad/loadout-phase-e/src/e1Resummarise.ts
 *
 * Why this exists (same reason as `resummarise.ts` for E2): Inspector Brad's
 * third sweep found two E1 metrics that did not measure what their names claimed.
 *
 *  1. `forcedOntoCatalogue` re-emitted the whole false-positive list whenever the
 *     photo happened to have ANY `notInCatalogue` entry — it never correlated a
 *     non-catalogue item with a forced catalogue match. Dropped entirely: no
 *     published claim needs it, and a broken field in a committed dataset is
 *     worse than no field.
 *  2. `nullLabelled` counted EVERY null-id detection as a success. It isn't one:
 *     a null id naming something that IS a catalogue row is the opposite failure
 *     (describing a row in prose instead of selecting its id), and "Digital Wall
 *     Clock" is neither. Split three ways here.
 *
 * Cost is emitted rather than hand-derived, per STATE.md § Lessons.
 *
 * The scan harness (`e1Scan.ts`) now computes all of this directly, so a future
 * re-run needs no post-processing. This script exists because the AWS SSO session
 * expired before the corrected harness could be re-run, and re-running was not
 * worth blocking on: every corrected figure is derivable from what is committed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadLibrary } from "./library.ts";
import { PRICE_PER_MTOK, MODELS } from "./armB.ts";
import { E1_PHOTOS } from "./e1Fixtures.ts";

const RESULTS_DIR = join(import.meta.dir, "..", "results");

type StoredScore = {
  file: string;
  provenance: string;
  hits: string[];
  misses: string[];
  falsePositives: string[];
  trapsTripped: string[];
  ambiguousDetected: string[];
  nullLabelled: string[];
  invalidIds: string[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

const library = loadLibrary();
const catalogueHeads = library.equipmentTypes.map((row) =>
  row.name.split(" / ")[0].toLowerCase().replace(/s$/, ""),
);

/**
 * Does this free-text label name something that IS a catalogue row?
 *
 * Only the text BEFORE the first parenthesis is considered. Models put location
 * notes in parentheses — "Weight plates (on barbell and likely stored)" is not a
 * model describing a barbell in prose, and matching the whole string flagged it as
 * one. Weight plates genuinely have no catalogue row.
 */
function namesACatalogueRow(label: string): boolean {
  const text = label.split("(")[0].toLowerCase();
  return catalogueHeads.some((head) => head.length > 3 && text.includes(head));
}

function matchesGroundTruth(label: string, notInCatalogue: string[]): boolean {
  const text = label.toLowerCase();
  return notInCatalogue.some((item) =>
    item
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((token) => token.length > 3)
      .some((token) => text.includes(token)),
  );
}

for (const [key, modelId] of Object.entries(MODELS)) {
  const file = `e1-${key}.json`;
  const data = JSON.parse(readFileSync(join(RESULTS_DIR, file), "utf8")) as {
    scores: StoredScore[];
  };
  const price = PRICE_PER_MTOK[modelId]!;
  const byFile = new Map(E1_PHOTOS.map((p) => [p.file, p]));

  let onGroundTruth = 0;
  let despiteCatalogueRow = 0;
  let unscoreable = 0;
  const despiteExamples: string[] = [];

  for (const score of data.scores) {
    const photo = byFile.get(score.file)!;
    for (const label of score.nullLabelled) {
      if (matchesGroundTruth(label, photo.notInCatalogue)) onGroundTruth += 1;
      else if (namesACatalogueRow(label)) {
        despiteCatalogueRow += 1;
        despiteExamples.push(`${score.file}: "${label}"`);
      } else unscoreable += 1;
    }
  }

  const n = data.scores.length;
  const mean = (pick: (s: StoredScore) => number) =>
    data.scores.reduce((sum, s) => sum + pick(s), 0) / n;
  const latency = data.scores.map((s) => s.latencyMs).sort((a, b) => a - b);
  const real = data.scores.filter((s) => s.provenance === "real-phone-photo");
  const realPresent = E1_PHOTOS.filter(
    (p) => p.provenance === "real-phone-photo",
  ).reduce((sum, p) => sum + p.present.length, 0);

  console.log(
    JSON.stringify(
      {
        model: key,
        modelId,
        totalHits: data.scores.reduce((sum, s) => sum + s.hits.length, 0),
        totalPresent: E1_PHOTOS.reduce((sum, p) => sum + p.present.length, 0),
        recall: Number(
          (
            data.scores.reduce((sum, s) => sum + s.hits.length, 0) /
            E1_PHOTOS.reduce((sum, p) => sum + p.present.length, 0)
          ).toFixed(3),
        ),
        realPhonePhotoRecall: Number(
          (
            real.reduce((sum, s) => sum + s.hits.length, 0) / realPresent
          ).toFixed(3),
        ),
        falsePositives: data.scores.reduce(
          (sum, s) => sum + s.falsePositives.length,
          0,
        ),
        trapsTripped: data.scores.flatMap((s) =>
          s.trapsTripped.map((t) => `${s.file}: ${t}`),
        ),
        invalidIdsReturned: data.scores.reduce(
          (sum, s) => sum + s.invalidIds.length,
          0,
        ),
        // The corrected three-way split of null-id detections.
        nullIdOnGroundTruth: onGroundTruth,
        nullIdDespiteCatalogueRow: despiteCatalogueRow,
        nullIdDespiteCatalogueRowExamples: despiteExamples,
        nullIdUnscoreable: unscoreable,
        latencyMeanMs: Math.round(mean((s) => s.latencyMs)),
        latencyMaxMs: latency[latency.length - 1],
        meanInputTokens: Math.round(mean((s) => s.inputTokens)),
        meanOutputTokens: Math.round(mean((s) => s.outputTokens)),
        costPerScanUsd: Number(
          mean(
            (s) =>
              (s.inputTokens / 1_000_000) * price.input +
              (s.outputTokens / 1_000_000) * price.output,
          ).toFixed(5),
        ),
      },
      null,
      2,
    ),
  );
}

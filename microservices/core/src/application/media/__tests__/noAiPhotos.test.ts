import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PER-121 — backend design F test 6: no AI path receives photos, their URLs
 * or a photo count (Brad, 20 Nov 2026: photos are kept out of AI completely).
 *
 * A static check over the real source, so it also catches a FUTURE change:
 *
 *   1. Every module that calls a model (imports the Bedrock/Anthropic client)
 *      plus every module that assembles input for one (imports one of those —
 *      the AI handlers, the job runner, the coach AI summary's evidence) is an
 *      "AI module".
 *   2. Follow every relative import from the AI modules.
 *   3. Nothing reached may be a media module, or mention the photo tables or
 *      the media store.
 *
 * Route aggregators (`*Routes.ts`, `api.ts`) mount everything and are not AI
 * input assembly, so they are not followed.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const AI_CLIENT =
  /from\s+["'](?:@anthropic-ai\/[^"']+|@aws-sdk\/client-bedrock-runtime|[^"']*aiBedrockClient)["']/;
const PHOTO_MARKERS =
  /progressPhotoSets|progressPhotos\b|privateMedia\b|progress_photo|private_media|privateMediaStore|CoachPrivateMedia|\/media\//;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(path));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

const files = sourceFiles(SRC);
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

function relativeImports(file: string): string[] {
  const out: string[] = [];
  const re =
    /(?:import|export)[^"']*?from\s+["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  for (const m of text.get(file)!.matchAll(re)) {
    const spec = m[1] ?? m[2]!;
    const base = resolve(dirname(file), spec);
    const hit = [`${base}.ts`, join(base, "index.ts"), base].find(
      (p) => existsSync(p) && p.endsWith(".ts"),
    );
    if (hit) out.push(hit);
  }
  return out;
}

const isAggregator = (f: string) =>
  /Routes\.ts$/.test(f) || f === join(SRC, "api.ts");

const callers = files.filter((f) => AI_CLIENT.test(text.get(f)!));
const assemblers = files.filter(
  (f) =>
    !isAggregator(f) && relativeImports(f).some((dep) => callers.includes(dep)),
);
const aiModules = [...new Set([...callers, ...assemblers])];

function closure(start: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file) || isAggregator(file)) continue;
    seen.add(file);
    stack.push(...relativeImports(file));
  }
  return seen;
}

describe("design F test 6: photos never reach AI", () => {
  it("finds the AI modules, including the coach AI summary's evidence", () => {
    const names = aiModules.map((f) => relative(SRC, f));
    expect(names).toEqual(
      expect.arrayContaining([
        "application/trainers/services/clientSummaryAi.ts",
        "application/trainers/clients/trainersMeGenerateClientAiSummaryHandler.ts",
        "application/nutrition/services/aiBedrockClient.ts",
      ]),
    );
    // The summary's evidence (PER-115: adherence, programme week, form
    // answers, plan meals) is in the closure.
    const reached = [...closure(aiModules)].map((f) => relative(SRC, f));
    expect(reached).toContain(
      "application/trainers/services/weeklySummaryEvidenceRepository.ts",
    );
  });

  it("no module an AI path imports touches photos, their links or the media store", () => {
    const leaks = [...closure(aiModules)]
      .filter((f) => PHOTO_MARKERS.test(text.get(f)!))
      .map((f) => relative(SRC, f));
    expect(leaks).toEqual([]);
  });

  it("the media modules call no model", () => {
    const media = files.filter((f) =>
      f.includes(`${join("application", "media")}/`),
    );
    expect(media.length).toBeGreaterThan(0);
    const reached = [...closure(media)];
    expect(reached.filter((f) => callers.includes(f))).toEqual([]);
  });
});

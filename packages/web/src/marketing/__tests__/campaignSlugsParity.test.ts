import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAMPAIGNS } from "../config";
import { CAMPAIGN_LANDING_SLUGS } from "../campaign";

/**
 * The admin panel's channel picker offers the slugs the CORE API returns, and
 * the core API keeps its own copy of that list — `CAMPAIGNS` lives here, in a
 * package the API cannot import a value from without a shared package nobody
 * wants for eight words.
 *
 * That duplication has exactly one failure mode: someone adds a slug to one
 * side. Then `/meta` attributes correctly but cannot be added as a channel, or
 * the picker offers a slug that resolves to no landing route. This closes it.
 *
 * Read as TEXT, not imported: `microservices/core` is outside this package's
 * TypeScript project, so an import would resolve under vitest and fail under
 * `tsc -b`. The file it reads is a pure leaf with no imports of its own,
 * written so this parse stays trivial.
 *
 * Resolved from `process.cwd()` (this package's root, where vitest runs) —
 * `import.meta.url` is not a `file:` URL under the jsdom environment.
 */
const CORE_SLUGS_FILE = resolve(
  process.cwd(),
  "../../microservices/core/src/application/admin/marketing/campaignSlugs.ts",
);

function coreSlugs(): string[] {
  const source = readFileSync(CORE_SLUGS_FILE, "utf8");
  const match = /ADMIN_CAMPAIGN_SLUGS[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (!match) {
    throw new Error(
      "Could not find ADMIN_CAMPAIGN_SLUGS in the core campaignSlugs module — " +
        "if it was renamed or reshaped, update this test rather than deleting it.",
    );
  }
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("campaign slugs stay in step across web and core", () => {
  it("finds the list in the core module", () => {
    // Guards the parse itself: a silently-empty result would make every
    // assertion below vacuous.
    expect(coreSlugs().length).toBeGreaterThan(0);
  });

  it("offers exactly the slugs that have a landing route", () => {
    expect([...coreSlugs()].sort()).toEqual([...CAMPAIGN_LANDING_SLUGS].sort());
  });

  it("excludes the /qr fallback bucket, which is not a channel", () => {
    expect(Object.keys(CAMPAIGNS)).toContain("default");
    expect(coreSlugs()).not.toContain("default");
  });
});

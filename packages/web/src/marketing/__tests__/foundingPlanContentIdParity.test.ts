import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FOUNDING_PLANS,
  FOUNDING_PLAN_CONTENT_IDS,
  foundingPlanContentId,
} from "../foundingOffer";

/**
 * The plan id that rides on Meta's `content_name`/`content_ids` is derived
 * TWICE — once here for the browser pixel, once in the core API for the server
 * copy of the same two events (`InitiateCheckout`, `Purchase`).
 *
 * That duplication has exactly one failure mode, and it is a silent one:
 * someone edits one table. The browser and server copies then dedupe on the
 * shared event id, Meta keeps whichever arrived first, and the plan breakdown
 * the ads are optimised on becomes a coin toss. This closes it.
 *
 * Read as TEXT, not imported — `microservices/core` is outside this package's
 * TypeScript project, so an import would resolve under vitest and fail under
 * `tsc -b`. Same approach, and the same reason, as
 * `campaignSlugsParity.test.ts`. Resolved from `process.cwd()` (this package's
 * root, where vitest runs): `import.meta.url` is not a `file:` URL under jsdom.
 */
const CORE_MAP_FILE = resolve(
  process.cwd(),
  "../../microservices/core/src/application/analytics/metaEventMap.ts",
);

function corePlanIds(): Record<string, string> {
  const source = readFileSync(CORE_MAP_FILE, "utf8");
  const match = /FOUNDING_PLAN_CONTENT_IDS[^=]*=\s*\{([^}]*)\}/.exec(source);
  if (!match) {
    throw new Error(
      "Could not find FOUNDING_PLAN_CONTENT_IDS in the core metaEventMap — if " +
        "it was renamed or reshaped (it must stay a FLAT string→string object " +
        "literal), update this test rather than deleting it.",
    );
  }
  return Object.fromEntries(
    [...match[1]!.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [
      m[1]!,
      m[2]!,
    ]),
  );
}

describe("founding plan content ids stay in step across web and core", () => {
  it("finds the table in the core module", () => {
    // Guards the parse itself: a silently-empty result would make the
    // comparison below vacuous, which is the one way this test could pass while
    // the two sides disagree.
    expect(Object.keys(corePlanIds())).toHaveLength(4);
  });

  it("maps every pair to the same id on both sides", () => {
    expect(corePlanIds()).toEqual(FOUNDING_PLAN_CONTENT_IDS);
  });

  it("names every plan the website actually sells", () => {
    // The tables are keyed by tier:months, and the four plans on `/founding`
    // are what a buyer can pick — so an unnamed plan is a purchase Meta could
    // not attribute to a term.
    for (const plan of FOUNDING_PLANS) {
      expect(foundingPlanContentId(plan.tier, plan.months)).toBeDefined();
    }
    expect(Object.keys(FOUNDING_PLAN_CONTENT_IDS)).toHaveLength(
      FOUNDING_PLANS.length,
    );
  });
});

describe("foundingPlanContentId", () => {
  it("names all four web terms", () => {
    expect(foundingPlanContentId("premium", 6)).toBe("premium_6m");
    expect(foundingPlanContentId("premium", 12)).toBe("premium_12m");
    expect(foundingPlanContentId("premium_plus", 6)).toBe("plus_6m");
    expect(foundingPlanContentId("premium_plus", 12)).toBe("plus_12m");
  });

  it("is undefined for anything not sold here", () => {
    // The loose inputs are deliberate: the thanks page reads `tier`/`months`
    // off the status endpoint as a plain string and number.
    expect(foundingPlanContentId("start_up_coach_plus", 6)).toBeUndefined();
    expect(foundingPlanContentId("premium", 3)).toBeUndefined();
    expect(foundingPlanContentId("premium", 6.5)).toBeUndefined();
    expect(foundingPlanContentId("premium", undefined)).toBeUndefined();
    expect(foundingPlanContentId(undefined, 6)).toBeUndefined();
    // A key from `Object.prototype` must not resolve to a plan.
    expect(foundingPlanContentId("constructor", 6)).toBeUndefined();
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __clearJobKindRegistry,
  getJobKind,
  registeredJobKinds,
  registerJobKind,
} from "../registry";

function kind(overrides: Record<string, unknown> = {}) {
  return {
    kind: "k1",
    feature: "loadout",
    ceilingEnv: "K1_LIMIT",
    ceilingDefault: 3,
    ceilingEndpoint: "/k1",
    inferenceEndpoint: "/k1/inference",
    plan: async () => ({ total: 1 }),
    runStep: async () => null,
    finish: async () => null,
    ...overrides,
  } as any;
}

describe("job kind registry", () => {
  beforeEach(() => __clearJobKindRegistry());

  it("ships EMPTY — a kind belongs to the feature that needs it, not to the spine", async () => {
    // Re-imported fresh so this asserts the shipped module state, not the state
    // left by another test file. If a kind ever appears here, the spine has been
    // coupled to a feature.
    __clearJobKindRegistry();
    const { registeredJobKinds: fresh } = await import("../registry");
    expect(fresh()).toEqual([]);
  });

  it("registers and looks up a kind", () => {
    registerJobKind(kind());
    expect(getJobKind("k1")?.kind).toBe("k1");
    expect(registeredJobKinds()).toEqual(["k1"]);
  });

  it("returns undefined for an unregistered kind rather than throwing", () => {
    // The worker turns this into a terminal `unknown_kind` failure; the
    // realistic cause is deploy skew, and crashing would just retry it.
    expect(getJobKind("nope")).toBeUndefined();
  });

  it("REJECTS a duplicate kind at module load — silent shadowing is the failure being prevented", () => {
    registerJobKind(kind());
    expect(() => registerJobKind(kind())).toThrow(/duplicate job kind "k1"/);
  });

  it("REJECTS a kind whose ceiling and inference endpoint keys are the same (AC-4.4)", () => {
    // The whole trap: a job writing N inference rows under its ceiling key
    // trips its own ceiling on the first run. Enforced here rather than left to
    // review, because the failure is silent at runtime.
    expect(() =>
      registerJobKind(
        kind({ ceilingEndpoint: "/same", inferenceEndpoint: "/same" }),
      ),
    ).toThrow(/must differ/);
    expect(registeredJobKinds()).toEqual([]);
  });

  it("keeps registered kinds sorted, so the list is stable for diagnostics", () => {
    registerJobKind(
      kind({ kind: "z", ceilingEndpoint: "/z", inferenceEndpoint: "/z/i" }),
    );
    registerJobKind(
      kind({ kind: "a", ceilingEndpoint: "/a", inferenceEndpoint: "/a/i" }),
    );
    expect(registeredJobKinds()).toEqual(["a", "z"]);
  });
});

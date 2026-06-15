import { describe, it, expect } from "vitest";
import {
  MILESTONES,
  milestonesForPeriod,
  crossedMilestones,
  freezeTokensAfterAdvance,
  FREEZE_TOKEN_CAP,
} from "../milestones";

describe("milestonesForPeriod", () => {
  it("weekly uses weekly tiers; daily/monthly use daily tiers", () => {
    expect(milestonesForPeriod("weekly")).toEqual(MILESTONES.weekly);
    expect(milestonesForPeriod("daily")).toEqual(MILESTONES.daily);
    expect(milestonesForPeriod("monthly")).toEqual(MILESTONES.daily);
  });
});

describe("crossedMilestones", () => {
  it("crosses a single weekly tier on each step", () => {
    expect(crossedMilestones(0, 1, "weekly")).toEqual([1]);
    expect(crossedMilestones(1, 2, "weekly")).toEqual([2]);
    expect(crossedMilestones(3, 4, "weekly")).toEqual([4]);
  });

  it("crosses several at once on a multi-step advance", () => {
    expect(crossedMilestones(0, 4, "weekly")).toEqual([1, 2, 4]);
  });

  it("returns empty when no tier sits in (prev, new]", () => {
    expect(crossedMilestones(4, 5, "weekly")).toEqual([]);
    expect(crossedMilestones(0, 0, "weekly")).toEqual([]);
  });

  it("uses daily tiers for daily streaks", () => {
    expect(crossedMilestones(6, 7, "daily")).toEqual([7]);
    expect(crossedMilestones(5, 6, "daily")).toEqual([]);
  });
});

describe("freezeTokensAfterAdvance", () => {
  it("earns one token every 4th period", () => {
    expect(freezeTokensAfterAdvance(0, 4)).toBe(1);
    expect(freezeTokensAfterAdvance(1, 8)).toBe(2);
    expect(freezeTokensAfterAdvance(0, 3)).toBe(0);
    expect(freezeTokensAfterAdvance(0, 0)).toBe(0);
  });

  it("caps at FREEZE_TOKEN_CAP", () => {
    expect(freezeTokensAfterAdvance(FREEZE_TOKEN_CAP, 8)).toBe(
      FREEZE_TOKEN_CAP,
    );
    expect(freezeTokensAfterAdvance(4, 12)).toBe(4);
  });

  it("does not earn on a non-multiple even with a high balance", () => {
    expect(freezeTokensAfterAdvance(2, 5)).toBe(2);
  });
});

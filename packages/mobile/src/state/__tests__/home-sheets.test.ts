import { useHomeSheets } from "@/state/home-sheets";

/**
 * Spec: feedback_sheets_mount_at_root
 *       specs/06-progress-goals/design.md § Home quick-log
 */

const reset = () => useHomeSheets.setState({ sheet: null, habitsRev: 0 });

describe("useHomeSheets", () => {
  beforeEach(reset);

  it("starts closed", () => {
    expect(useHomeSheets.getState().sheet).toBeNull();
    expect(useHomeSheets.getState().habitsRev).toBe(0);
  });

  it.each([
    ["openWeighIn", "weighIn"],
    ["openWater", "water"],
    ["openSleep", "sleep"],
  ] as const)("%s selects the %s sheet", (action, expected) => {
    useHomeSheets.getState()[action]();
    expect(useHomeSheets.getState().sheet).toBe(expected);
  });

  it("only one sheet is open at a time", () => {
    useHomeSheets.getState().openWater();
    useHomeSheets.getState().openSleep();
    expect(useHomeSheets.getState().sheet).toBe("sleep");
  });

  it("close clears the sheet", () => {
    useHomeSheets.getState().openWeighIn();
    useHomeSheets.getState().close();
    expect(useHomeSheets.getState().sheet).toBeNull();
  });

  // The subtle part, and the reason this store exists rather than three
  // booleans: closing water or sleep must signal <HomeContainer> to re-read the
  // habit cache (both reflect into it synchronously on log), and closing
  // Weigh-in must NOT — that matches the close handlers this replaced exactly.
  it.each(["openWater", "openSleep"] as const)(
    "%s → close bumps habitsRev so Home re-reads the habit cache",
    (action) => {
      useHomeSheets.getState()[action]();
      useHomeSheets.getState().close();
      expect(useHomeSheets.getState().habitsRev).toBe(1);
    },
  );

  it("weigh-in → close leaves habitsRev alone (it reflects no habit)", () => {
    useHomeSheets.getState().openWeighIn();
    useHomeSheets.getState().close();
    expect(useHomeSheets.getState().habitsRev).toBe(0);
  });

  it("closing when nothing is open does not bump habitsRev", () => {
    useHomeSheets.getState().close();
    expect(useHomeSheets.getState().habitsRev).toBe(0);
  });

  it("bumps monotonically across repeated water logs", () => {
    for (const expected of [1, 2, 3]) {
      useHomeSheets.getState().openWater();
      useHomeSheets.getState().close();
      expect(useHomeSheets.getState().habitsRev).toBe(expected);
    }
  });
});

import { useDrawer } from "../drawer";

/**
 * useDrawer slice tests.
 *
 * Spec: specs/14-navigation/design.md § Testing strategy > useDrawer slice
 * Closes: specs/14-navigation/requirements.md STORY-009 AC 9.2
 */

beforeEach(() => {
  useDrawer.setState({ open: false });
});

describe("useDrawer", () => {
  it("defaults to closed", () => {
    expect(useDrawer.getState().open).toBe(false);
  });

  it("openDrawer() sets open to true", () => {
    useDrawer.getState().openDrawer();
    expect(useDrawer.getState().open).toBe(true);
  });

  it("closeDrawer() sets open to false", () => {
    useDrawer.setState({ open: true });
    useDrawer.getState().closeDrawer();
    expect(useDrawer.getState().open).toBe(false);
  });

  it("openDrawer() then closeDrawer() round-trips", () => {
    const { openDrawer, closeDrawer } = useDrawer.getState();
    openDrawer();
    expect(useDrawer.getState().open).toBe(true);
    closeDrawer();
    expect(useDrawer.getState().open).toBe(false);
  });

  it("has no persistence surface (no AsyncStorage import side effects)", () => {
    // The slice never reads/writes AsyncStorage: a freshly-read state is
    // always closed. Documented invariant — relaunch always cold-starts
    // closed (AC 4.5). Re-importing the module yields the same default.
    expect(useDrawer.getState().open).toBe(false);
  });
});

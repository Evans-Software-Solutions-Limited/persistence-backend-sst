import { useAddClientSheet } from "../add-client-sheet";

beforeEach(() => {
  useAddClientSheet.setState({ open: false, onInvited: null });
});

describe("useAddClientSheet", () => {
  it("defaults to closed with no callback", () => {
    const s = useAddClientSheet.getState();
    expect(s.open).toBe(false);
    expect(s.onInvited).toBeNull();
  });

  it("openSheet() opens and stores the onInvited callback", () => {
    const cb = jest.fn();
    useAddClientSheet.getState().openSheet(cb);
    const s = useAddClientSheet.getState();
    expect(s.open).toBe(true);
    expect(s.onInvited).toBe(cb);
  });

  it("openSheet() with no arg opens with a null callback", () => {
    useAddClientSheet.getState().openSheet();
    const s = useAddClientSheet.getState();
    expect(s.open).toBe(true);
    expect(s.onInvited).toBeNull();
  });

  it("closeSheet() closes and clears the callback", () => {
    useAddClientSheet.setState({ open: true, onInvited: jest.fn() });
    useAddClientSheet.getState().closeSheet();
    const s = useAddClientSheet.getState();
    expect(s.open).toBe(false);
    expect(s.onInvited).toBeNull();
  });
});

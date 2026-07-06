import { useAssignWorkoutSheet } from "../assign-workout-sheet";

beforeEach(() => {
  useAssignWorkoutSheet.setState({
    open: false,
    clientId: null,
    onAssigned: null,
  });
});

describe("useAssignWorkoutSheet", () => {
  it("defaults to closed with no clientId or callback", () => {
    const s = useAssignWorkoutSheet.getState();
    expect(s.open).toBe(false);
    expect(s.clientId).toBeNull();
    expect(s.onAssigned).toBeNull();
  });

  it("openSheet() opens with the clientId and stores the callback", () => {
    const cb = jest.fn();
    useAssignWorkoutSheet.getState().openSheet("client-3", cb);
    const s = useAssignWorkoutSheet.getState();
    expect(s.open).toBe(true);
    expect(s.clientId).toBe("client-3");
    expect(s.onAssigned).toBe(cb);
  });

  it("closeSheet() closes and clears clientId + callback", () => {
    useAssignWorkoutSheet.setState({
      open: true,
      clientId: "client-3",
      onAssigned: jest.fn(),
    });
    useAssignWorkoutSheet.getState().closeSheet();
    const s = useAssignWorkoutSheet.getState();
    expect(s.open).toBe(false);
    expect(s.clientId).toBeNull();
    expect(s.onAssigned).toBeNull();
  });
});

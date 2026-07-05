import { useAssignProgramSheet } from "../assign-program-sheet";

beforeEach(() => {
  useAssignProgramSheet.setState({
    open: false,
    programId: null,
    onAssigned: null,
  });
});

describe("useAssignProgramSheet", () => {
  it("defaults to closed with no programId or callback", () => {
    const s = useAssignProgramSheet.getState();
    expect(s.open).toBe(false);
    expect(s.programId).toBeNull();
    expect(s.onAssigned).toBeNull();
  });

  it("openSheet() opens with the programId and stores the onAssigned callback", () => {
    const cb = jest.fn();
    useAssignProgramSheet.getState().openSheet("program-1", cb);
    const s = useAssignProgramSheet.getState();
    expect(s.open).toBe(true);
    expect(s.programId).toBe("program-1");
    expect(s.onAssigned).toBe(cb);
  });

  it("openSheet() with no callback opens with a null onAssigned", () => {
    useAssignProgramSheet.getState().openSheet("program-2");
    const s = useAssignProgramSheet.getState();
    expect(s.open).toBe(true);
    expect(s.programId).toBe("program-2");
    expect(s.onAssigned).toBeNull();
  });

  it("closeSheet() closes and clears programId and callback", () => {
    useAssignProgramSheet.setState({
      open: true,
      programId: "program-1",
      onAssigned: jest.fn(),
    });
    useAssignProgramSheet.getState().closeSheet();
    const s = useAssignProgramSheet.getState();
    expect(s.open).toBe(false);
    expect(s.programId).toBeNull();
    expect(s.onAssigned).toBeNull();
  });
});

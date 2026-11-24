import { render } from "@testing-library/react-native";
import { useCoachLibraryTab } from "@/state/coach-library-tab";
import ProgramsTab from "../programs";

const mockRedirect = jest.fn();
jest.mock("expo-router", () => ({
  Redirect: (p: { href: string }) => {
    mockRedirect(p.href);
    return null;
  },
}));

describe("old Programs tab (PER-129 K shell)", () => {
  it("redirects to Library → Programmes and sets the Library's segment (Inspector Brad #556 sweep 2)", () => {
    // The Library tab stays mounted with ?segment=programmes from an earlier
    // visit, so the param alone doesn't move it off Forms.
    useCoachLibraryTab.setState({ segment: "forms" });
    render(<ProgramsTab />);
    expect(mockRedirect).toHaveBeenCalledWith(
      "/(app)/(tabs)/library?segment=programmes",
    );
    expect(useCoachLibraryTab.getState().segment).toBe("programmes");
  });
});

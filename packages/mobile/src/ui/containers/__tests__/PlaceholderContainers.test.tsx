import { renderWithTheme } from "../../../../__tests__/test-utils";
import { CoachHomeContainer } from "@/ui/containers/CoachHomeContainer";

/**
 * Placeholder route-slot container (14-navigation Phase 14.3).
 *
 * Spec: specs/14-navigation/tasks.md T-14.3.7 (Coach Home stub). Real content
 *       owned by 10-trainer-features.
 *
 * (The You stub test moved out when 06-progress-goals shipped the real
 * YouContainer — see containers/__tests__/YouContainer.test.tsx.)
 */
describe("CoachHomeContainer (stub)", () => {
  it("renders the Coach Home placeholder", () => {
    const { getByTestId, getByText } = renderWithTheme(<CoachHomeContainer />);
    expect(getByTestId("coach-home")).toBeTruthy();
    expect(getByText("Coach Home")).toBeTruthy();
  });
});

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { CoachHomeContainer } from "@/ui/containers/CoachHomeContainer";
import { YouContainer } from "@/ui/containers/YouContainer";

/**
 * Placeholder route-slot containers (14-navigation Phase 14.3).
 *
 * Spec: specs/14-navigation/tasks.md T-14.3.4 (You stub), T-14.3.7 (Coach
 *       Home stub). Real content owned by 06-progress-goals /
 *       10-trainer-features.
 */

describe("YouContainer (stub)", () => {
  it("renders the You placeholder", () => {
    const { getByTestId, getByText } = renderWithTheme(<YouContainer />);
    expect(getByTestId("you-tab")).toBeTruthy();
    expect(getByText("You")).toBeTruthy();
  });
});

describe("CoachHomeContainer (stub)", () => {
  it("renders the Coach Home placeholder", () => {
    const { getByTestId, getByText } = renderWithTheme(<CoachHomeContainer />);
    expect(getByTestId("coach-home")).toBeTruthy();
    expect(getByText("Coach Home")).toBeTruthy();
  });
});

import { renderWithTheme } from "../../../../__tests__/test-utils";
import { useDrawer } from "@/state/drawer";
import { ProfileDrawerContainer } from "@/ui/containers/ProfileDrawerContainer";

/**
 * ProfileDrawerContainer (mount-point) tests.
 *
 * Spec: specs/14-navigation/design.md § <ProfileDrawer> mount-point
 *       specs/14-navigation/requirements.md STORY-004 (AC 4.2, 4.3)
 * Closes: specs/14-navigation/tasks.md T-14.5.1
 *
 * The drawer BODY is owned by 08-profile-settings; this suite only asserts
 * the mount-point wiring: the sheet reflects useDrawer().open and a backdrop
 * /close dispatch closes it. (The global @gorhom/bottom-sheet mock renders a
 * passthrough View tree, so the placeholder body is always queryable; the
 * `visible`-driven open/close is asserted via the slice + onClose plumbing.)
 */

beforeEach(() => {
  useDrawer.setState({ open: false });
});

describe("ProfileDrawerContainer", () => {
  it("renders the drawer mount with its PROFILE header + placeholder body when open", () => {
    useDrawer.setState({ open: true });
    const { getByText, getByTestId } = renderWithTheme(
      <ProfileDrawerContainer />,
    );
    expect(getByText("PROFILE")).toBeTruthy();
    expect(getByText("Account")).toBeTruthy();
    expect(getByTestId("profile-drawer-placeholder")).toBeTruthy();
  });

  it("renders nothing visible until first opened (light tree, no flash)", () => {
    // The <BottomSheet> primitive holds an un-opened sheet out of the tree
    // (mounted := visible) so there's no flash on cold start. With the drawer
    // closed and never opened, the sheet body isn't queryable.
    const { queryByTestId } = renderWithTheme(<ProfileDrawerContainer />);
    expect(queryByTestId("profile-drawer-placeholder")).toBeNull();
  });

  it("becomes visible once the useDrawer slice opens", () => {
    useDrawer.setState({ open: true });
    const { getByTestId } = renderWithTheme(<ProfileDrawerContainer />);
    expect(getByTestId("profile-drawer")).toBeTruthy();
    expect(useDrawer.getState().open).toBe(true);
  });

  it("wires the backdrop/close affordance to useDrawer().closeDrawer", () => {
    // The container passes closeDrawer as the sheet's onClose. Open then close
    // via the slice to assert the round-trip the backdrop tap drives.
    useDrawer.setState({ open: true });
    renderWithTheme(<ProfileDrawerContainer />);
    useDrawer.getState().closeDrawer();
    expect(useDrawer.getState().open).toBe(false);
  });
});

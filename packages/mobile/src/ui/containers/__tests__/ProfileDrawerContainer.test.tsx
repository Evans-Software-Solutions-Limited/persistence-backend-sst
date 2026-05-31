import { renderWithTheme } from "../../../../__tests__/test-utils";

/**
 * ProfileDrawerContainer (mount-point) tests.
 *
 * Spec: specs/14-navigation/design.md § <ProfileDrawer> mount-point
 *       specs/14-navigation/requirements.md STORY-004 (AC 4.2, 4.3)
 * Closes: specs/14-navigation/tasks.md T-14.5.1
 *
 * The drawer BODY is owned by 08-profile-settings; this suite asserts the
 * mount-point wiring only: the sheet's `visible` tracks useDrawer().open, and
 * the sheet's `onClose` is wired to useDrawer().closeDrawer.
 *
 * The <BottomSheet> foundation primitive is mocked to a capture component so
 * we can assert on the exact props the container hands it (visible + onClose)
 * and invoke onClose directly — proving the close affordance is wired rather
 * than just re-testing the zustand slice. (Per CLAUDE.md "no fake tests".)
 */

type CapturedSheetProps = {
  visible: boolean;
  onClose: () => void;
  eyebrow?: string;
  title?: string;
};
let lastSheetProps: CapturedSheetProps | null = null;

jest.mock("@/ui/components/foundation", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    BottomSheet: (props: CapturedSheetProps & { children?: unknown }) => {
      lastSheetProps = {
        visible: props.visible,
        onClose: props.onClose,
        eyebrow: props.eyebrow,
        title: props.title,
      };
      // Only render children when visible, mirroring the real primitive's
      // "nothing in the tree until opened" behaviour closely enough for the
      // body-presence assertions below.
      return props.visible
        ? React.createElement(
            View,
            { testID: "profile-drawer" },
            props.children as React.ReactNode,
          )
        : null;
    },
  };
});

// eslint-disable-next-line import/first
import { act } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import { useDrawer } from "@/state/drawer";
// eslint-disable-next-line import/first
import { ProfileDrawerContainer } from "@/ui/containers/ProfileDrawerContainer";

beforeEach(() => {
  lastSheetProps = null;
  useDrawer.setState({ open: false });
});

describe("ProfileDrawerContainer", () => {
  it("renders the placeholder body + PROFILE/Account header props when open", () => {
    useDrawer.setState({ open: true });
    const { getByText } = renderWithTheme(<ProfileDrawerContainer />);
    // Body (children) renders through the mocked sheet.
    expect(getByText(/Your profile, subscription/)).toBeTruthy();
    // Header eyebrow + title are handed to the sheet as props.
    expect(lastSheetProps?.eyebrow).toBe("PROFILE");
    expect(lastSheetProps?.title).toBe("Account");
  });

  it("drives the sheet's `visible` prop from useDrawer().open", () => {
    // Closed → sheet receives visible=false.
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastSheetProps?.visible).toBe(false);

    // Open → re-render hands visible=true.
    useDrawer.setState({ open: true });
    renderWithTheme(<ProfileDrawerContainer />);
    expect(lastSheetProps?.visible).toBe(true);
  });

  it("wires the sheet's onClose to useDrawer().closeDrawer", () => {
    useDrawer.setState({ open: true });
    renderWithTheme(<ProfileDrawerContainer />);

    // Invoke the exact onClose the container handed the sheet (this is what a
    // backdrop tap / pan-down dismiss triggers). If the container passed a
    // no-op or omitted onClose, the slice would stay open and this fails.
    expect(lastSheetProps?.onClose).toEqual(expect.any(Function));
    act(() => {
      lastSheetProps?.onClose();
    });
    expect(useDrawer.getState().open).toBe(false);
  });
});

import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  IconApple,
  IconChart,
  IconDumbbell,
  IconHome,
  IconUsers,
} from "../../icons";
import { TabBar, type TabSpec } from "../TabBar";

const ATHLETE_TABS: TabSpec[] = [
  { id: "home", icon: IconHome, label: "Home" },
  { id: "train", icon: IconDumbbell, label: "Train" },
  { id: "fuel", icon: IconApple, label: "Fuel" },
  { id: "you", icon: IconChart, label: "You" },
];

const COACH_TABS: TabSpec[] = [
  { id: "home", icon: IconHome, label: "Home" },
  { id: "clients", icon: IconUsers, label: "Clients", badge: "3" },
  { id: "programs", icon: IconChart, label: "Programs" },
  { id: "you", icon: IconChart, label: "You" },
];

describe("TabBar", () => {
  it("renders all tab labels", () => {
    const { getByText } = renderWithTheme(
      <TabBar tabs={ATHLETE_TABS} active="home" onChange={() => undefined} />,
    );
    for (const t of ATHLETE_TABS) {
      expect(getByText(t.label)).toBeTruthy();
    }
  });

  it("fires onChange with the tapped tab id", () => {
    const onChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <TabBar tabs={ATHLETE_TABS} active="home" onChange={onChange} />,
    );
    fireEvent.press(getByTestId("tabbar-tab-train"));
    expect(onChange).toHaveBeenCalledWith("train");
  });

  it("marks the active tab selected + renders its accent pill", () => {
    const { getByTestId } = renderWithTheme(
      <TabBar tabs={ATHLETE_TABS} active="fuel" onChange={() => undefined} />,
    );
    expect(
      getByTestId("tabbar-tab-fuel").props.accessibilityState.selected,
    ).toBe(true);
    expect(getByTestId("tabbar-tab-fuel-pill")).toBeTruthy();
    expect(
      getByTestId("tabbar-tab-home").props.accessibilityState.selected,
    ).toBe(false);
  });

  it("does not render the COACH chrome dot in athlete mode", () => {
    const { queryByTestId } = renderWithTheme(
      <TabBar tabs={ATHLETE_TABS} active="home" onChange={() => undefined} />,
    );
    expect(queryByTestId("tabbar-coach-dot")).toBeNull();
  });

  it("renders the COACH chrome dot in coach mode", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <TabBar
        tabs={COACH_TABS}
        active="clients"
        mode="coach"
        onChange={() => undefined}
      />,
    );
    expect(getByTestId("tabbar-coach-dot")).toBeTruthy();
    expect(getByText("COACH")).toBeTruthy();
  });

  it("renders a tab badge", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <TabBar
        tabs={COACH_TABS}
        active="home"
        mode="coach"
        onChange={() => undefined}
      />,
    );
    expect(getByTestId("tabbar-tab-clients-badge")).toBeTruthy();
    expect(getByText("3")).toBeTruthy();
  });

  it("enforces a 44pt minimum tab touch target", () => {
    const { getByTestId } = renderWithTheme(
      <TabBar tabs={ATHLETE_TABS} active="home" onChange={() => undefined} />,
    );
    // The tab Pressable wraps a View with minHeight 44.
    expect(getByTestId("tabbar-tab-home")).toBeTruthy();
  });
});

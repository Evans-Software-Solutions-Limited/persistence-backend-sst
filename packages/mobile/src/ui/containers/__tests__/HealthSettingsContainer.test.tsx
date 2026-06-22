import { act, fireEvent, render } from "@testing-library/react-native";
import { Pressable, Text, View } from "react-native";
import { useHealthSync } from "@/state/health-sync";
import type { HealthDataState } from "@/ui/hooks/useHealthData";
import { HealthSettingsPresenter } from "@/ui/presenters/HealthSettingsPresenter";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { HealthSettingsContainer } from "../HealthSettingsContainer";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

jest.mock("@/ui/hooks/useHealthData");
const mockUseHealthData = jest.mocked(useHealthData);

// Stub presenter — capture props + expose the two callbacks as pressables.
jest.mock("@/ui/presenters/HealthSettingsPresenter");
const MockPresenter = jest.mocked(HealthSettingsPresenter);
const probe: { last: Parameters<typeof HealthSettingsPresenter>[0] | null } = {
  last: null,
};
MockPresenter.mockImplementation((props) => {
  probe.last = props;
  return (
    <View>
      <Text testID="p-available">{String(props.isAvailable)}</Text>
      <Text testID="p-steps">{String(props.stepsToday)}</Text>
      <Text testID="p-requesting">{String(props.isRequesting)}</Text>
      <Pressable testID="p-connect" onPress={() => void props.onConnect()} />
      <Pressable testID="p-back" onPress={() => props.onBack()} />
    </View>
  );
});

function healthState(over: Partial<HealthDataState> = {}): HealthDataState {
  return {
    stepsToday: 5000,
    stepsHistory: [],
    activeCaloriesToday: null,
    basalCaloriesToday: null,
    standTimeTodayMinutes: null,
    latestBodyWeight: null,
    permissionStatus: {
      steps: "granted",
      calories: "granted",
      bodyWeight: "not_determined",
      heartRate: "not_determined",
    },
    isAvailable: true,
    isReading: false,
    lastReadAt: null,
    requestPermissions: jest.fn(async () => {}),
    read: jest.fn(async () => {}),
    refresh: jest.fn(async () => {}),
    ...over,
  };
}

describe("HealthSettingsContainer", () => {
  beforeEach(() => {
    probe.last = null;
    mockBack.mockClear();
    useHealthSync.setState({ revision: 0 });
  });

  it("maps the health state onto the presenter", () => {
    mockUseHealthData.mockReturnValue(healthState({ stepsToday: 8421 }));
    const { getByTestId } = render(<HealthSettingsContainer />);
    expect(getByTestId("p-available").props.children).toBe("true");
    expect(getByTestId("p-steps").props.children).toBe("8421");
  });

  it("requests permissions on connect and guards against concurrent presses", async () => {
    let resolve!: () => void;
    const requestPermissions = jest.fn(
      () => new Promise<void>((r) => (resolve = r)),
    );
    mockUseHealthData.mockReturnValue(healthState({ requestPermissions }));
    const { getByTestId } = render(<HealthSettingsContainer />);

    await act(async () => {
      fireEvent.press(getByTestId("p-connect"));
    });
    // In flight — a second press must not re-trigger the native sheet.
    expect(getByTestId("p-requesting").props.children).toBe("true");
    await act(async () => {
      fireEvent.press(getByTestId("p-connect"));
    });
    expect(requestPermissions).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve();
    });
    expect(getByTestId("p-requesting").props.children).toBe("false");
    // A successful grant signals Home to force-refresh its rings on next focus.
    expect(useHealthSync.getState().revision).toBe(1);
  });

  it("navigates back from the header", () => {
    mockUseHealthData.mockReturnValue(healthState());
    const { getByTestId } = render(<HealthSettingsContainer />);
    fireEvent.press(getByTestId("p-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

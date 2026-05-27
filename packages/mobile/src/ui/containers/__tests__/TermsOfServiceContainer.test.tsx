import { fireEvent, render } from "@testing-library/react-native";
import { Pressable, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { TermsOfServicePresenter } from "@/ui/presenters/TermsOfServicePresenter";
import { TermsOfServiceContainer } from "../TermsOfServiceContainer";

jest.mock("@/ui/presenters/TermsOfServicePresenter");
const MockPresenter = jest.mocked(TermsOfServicePresenter);

MockPresenter.mockImplementation((props) => (
  <View testID="terms-of-service-presenter-stub">
    <Pressable
      testID="stub-back"
      onPress={() => {
        props.onBack();
      }}
    />
  </View>
));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

function wrap(ui: React.ReactElement) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      {ui}
    </SafeAreaProvider>
  );
}

describe("TermsOfServiceContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBack.mockReset();
  });

  it("renders the presenter", () => {
    const { getByTestId } = render(wrap(<TermsOfServiceContainer />));
    expect(getByTestId("terms-of-service-presenter-stub")).toBeTruthy();
  });

  it("routes back when the presenter fires onBack", () => {
    const { getByTestId } = render(wrap(<TermsOfServiceContainer />));
    fireEvent.press(getByTestId("stub-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import {
  bootstrapMetaAttribution,
  denyMetaAttributionConsent,
  grantMetaAttributionConsent,
  isMetaAttributionConfigured,
} from "@/application/analytics/metaAttribution";
import { useMetaAttribution } from "../useMetaAttribution";

jest.mock("@/application/analytics/metaAttribution", () => ({
  bootstrapMetaAttribution: jest.fn(),
  denyMetaAttributionConsent: jest.fn(async () => undefined),
  grantMetaAttributionConsent: jest.fn(async () => true),
  isMetaAttributionConfigured: jest.fn(),
}));

type AlertButton = { text?: string; onPress?: () => void };

describe("useMetaAttribution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (bootstrapMetaAttribution as jest.Mock).mockResolvedValue("unknown");
    (isMetaAttributionConfigured as jest.Mock).mockReturnValue(true);
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  it("offers an explicit, accurately described choice when configuration exists", async () => {
    renderHook(() => useMetaAttribution());

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
    const [, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0] as [
      string,
      string,
      AlertButton[],
    ];
    expect(message).toContain("device's advertising identifier");
    expect(message).toContain("never sends workouts");

    act(() => buttons.find(({ text }) => text === "Allow")?.onPress?.());
    expect(grantMetaAttributionConsent).toHaveBeenCalledTimes(1);

    act(() => buttons.find(({ text }) => text === "Not now")?.onPress?.());
    expect(denyMetaAttributionConsent).toHaveBeenCalledTimes(1);
  });

  it.each(["granted", "denied"])(
    "does not ask again when consent is already %s",
    async (consent) => {
      (bootstrapMetaAttribution as jest.Mock).mockResolvedValue(consent);
      renderHook(() => useMetaAttribution());

      await waitFor(() =>
        expect(bootstrapMetaAttribution).toHaveBeenCalledTimes(1),
      );
      expect(Alert.alert).not.toHaveBeenCalled();
    },
  );

  it("is silent when Meta native configuration is absent", async () => {
    (isMetaAttributionConfigured as jest.Mock).mockReturnValue(false);
    renderHook(() => useMetaAttribution());

    await waitFor(() =>
      expect(bootstrapMetaAttribution).toHaveBeenCalledTimes(1),
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Pressable, Share, Text, View } from "react-native";
import { TogetherProbePresenter } from "@/ui/presenters/TogetherProbePresenter";
import {
  TogetherProbeContainer,
  isTogetherProbeAllowed,
} from "../TogetherProbeContainer";

jest.mock("@/ui/presenters/TogetherProbePresenter");
const MockPresenter = jest.mocked(TogetherProbePresenter);
MockPresenter.mockImplementation((props) => (
  <View testID="probe-presenter">
    <Text testID="probe-backend">{props.backend}</Text>
    <Text testID="probe-progress">{props.progress}</Text>
    <Text testID="probe-error">{props.error ?? ""}</Text>
    <Text testID="probe-report">
      {props.report ? props.report.generatedAt : "none"}
    </Text>
    <Pressable testID="stub-run" onPress={props.onRun} />
    <Pressable testID="stub-share" onPress={props.onShare} />
    <Pressable testID="stub-toggle" onPress={props.onToggleBackend} />
  </View>
));

let mockVariant: string | undefined = "staging";
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { appVariant: mockVariant } };
    },
  },
}));
jest.mock("expo-device", () => ({ modelName: "iPhone 17" }));
jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    const RN = jest.requireActual(
      "react-native",
    ) as typeof import("react-native");
    return <RN.Text testID="probe-redirect">{href}</RN.Text>;
  },
}));
const mockCloseSync = jest.fn();
jest.mock("expo-sqlite", () => ({
  openDatabaseSync: jest.fn(() => ({ closeSync: mockCloseSync })),
}));

const mockRun = jest.fn();
const mockAssert = jest.fn();
jest.mock("@/diagnostics/together/cryptoProbe", () => ({
  runCryptoProbe: (...args: unknown[]) => mockRun(...args),
  assertFixtureVerifies: () => mockAssert(),
}));

let mockBackendName: "noble" | "native" = "noble";
const mockInstallNative = jest.fn((..._args: unknown[]) => mockBackendName);
const mockInstall = jest.fn();
jest.mock("@/adapters/together/security/cryptoBackend", () => ({
  getCryptoBackend: () => ({ name: mockBackendName }),
  installNativeTogetherCrypto: (...args: unknown[]) =>
    mockInstallNative(...args),
  installCryptoBackend: (...args: unknown[]) => mockInstall(...args),
  nobleCryptoBackend: { name: "noble" },
}));

const devFlag = globalThis as unknown as { __DEV__: boolean };

describe("TogetherProbeContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVariant = "staging";
    mockBackendName = "noble";
    devFlag.__DEV__ = false;
  });
  afterAll(() => {
    devFlag.__DEV__ = true;
  });

  it("is allowed on development builds and non-production variants only", () => {
    expect(isTogetherProbeAllowed("production", false)).toBe(false);
    expect(isTogetherProbeAllowed(null, false)).toBe(false);
    expect(isTogetherProbeAllowed(42, false)).toBe(false);
    expect(isTogetherProbeAllowed("staging", false)).toBe(true);
    expect(isTogetherProbeAllowed("development", false)).toBe(true);
    expect(isTogetherProbeAllowed("production", true)).toBe(true);
  });

  it("redirects production builds to Home without mounting the probe", () => {
    mockVariant = "production";
    const r = render(<TogetherProbeContainer />);
    expect(r.getByTestId("probe-redirect").props.children).toBe(
      "/(app)/(tabs)",
    );
    expect(r.queryByTestId("probe-presenter")).toBeNull();
    expect(mockInstallNative).not.toHaveBeenCalled();
  });

  it("installs the backend on mount, runs the probe with device context and shares the JSON", async () => {
    mockBackendName = "native";
    const report = {
      generatedAt: "2026-10-11T20:00:00.000Z",
      benchmarks: [],
    };
    mockRun.mockImplementation(async (options: { onProgress: Function }) => {
      options.onProgress("ed25519.sign", 0, 9);
      options.onProgress("ed25519.sign", 9, 9);
      return report;
    });
    const shareSpy = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" } as never);
    const r = render(<TogetherProbeContainer />);
    expect(mockInstallNative).toHaveBeenCalledTimes(1);
    expect(r.getByTestId("probe-backend").props.children).toBe("native");

    await act(async () => {
      fireEvent.press(r.getByTestId("stub-run"));
    });
    await waitFor(() =>
      expect(r.getByTestId("probe-report").props.children).toBe(
        report.generatedAt,
      ),
    );
    expect(mockAssert).toHaveBeenCalledTimes(1);
    const options = mockRun.mock.calls[0][0] as {
      environment: Record<string, unknown>;
      database: unknown;
    };
    expect(options.environment).toEqual({
      platform: "ios",
      osVersion: expect.any(String),
      deviceModel: "iPhone 17",
      devBuild: false,
    });
    expect(options.database).toEqual({ closeSync: mockCloseSync });
    expect(mockCloseSync).toHaveBeenCalledTimes(1);
    expect(r.getByTestId("probe-progress").props.children).toBe(
      "Done (9 benchmarks)",
    );

    await act(async () => {
      fireEvent.press(r.getByTestId("stub-share"));
    });
    expect(shareSpy).toHaveBeenCalledWith({
      message: JSON.stringify(report, null, 2),
      title: "Together crypto probe",
    });
    shareSpy.mockRestore();
  });

  it("reports failures, closes the database, ignores share without a report and toggles the backend", async () => {
    mockRun.mockRejectedValue(new Error("fixture broke"));
    const shareSpy = jest.spyOn(Share, "share").mockResolvedValue({} as never);
    const r = render(<TogetherProbeContainer />);
    await act(async () => {
      fireEvent.press(r.getByTestId("stub-run"));
    });
    await waitFor(() =>
      expect(r.getByTestId("probe-error").props.children).toBe(
        "Error: fixture broke",
      ),
    );
    expect(r.getByTestId("probe-progress").props.children).toBe("Failed");
    expect(mockCloseSync).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.press(r.getByTestId("stub-share"));
    });
    expect(shareSpy).not.toHaveBeenCalled();

    // noble → native (forced re-evaluation), then native → noble.
    mockBackendName = "noble";
    await act(async () => {
      fireEvent.press(r.getByTestId("stub-toggle"));
    });
    expect(mockInstallNative).toHaveBeenLastCalledWith(undefined, {
      force: true,
    });
    mockBackendName = "native";
    await act(async () => {
      fireEvent.press(r.getByTestId("stub-toggle"));
    });
    expect(mockInstall).toHaveBeenCalledWith({ name: "noble" });
    expect(r.getByTestId("probe-backend").props.children).toBe("noble");
    expect(r.getByTestId("probe-progress").props.children).toBe("Idle");
    shareSpy.mockRestore();
  });

  it("surfaces a share failure and keeps the report", async () => {
    mockRun.mockResolvedValue({ generatedAt: "x", benchmarks: [] });
    const shareSpy = jest
      .spyOn(Share, "share")
      .mockRejectedValue(new Error("no sheet"));
    const r = render(<TogetherProbeContainer />);
    await act(async () => {
      fireEvent.press(r.getByTestId("stub-run"));
    });
    await waitFor(() =>
      expect(r.getByTestId("probe-report").props.children).toBe("x"),
    );
    await act(async () => {
      fireEvent.press(r.getByTestId("stub-share"));
    });
    expect(r.getByTestId("probe-error").props.children).toBe("no sheet");
    expect(r.getByTestId("probe-report").props.children).toBe("x");
    shareSpy.mockRestore();
  });
});

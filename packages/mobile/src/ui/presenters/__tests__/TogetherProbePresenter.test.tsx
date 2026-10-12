import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherProbePresenter } from "../TogetherProbePresenter";
import type { CryptoProbeReport } from "@/diagnostics/together/cryptoProbe";

const report: CryptoProbeReport = {
  version: "together-crypto-probe-v1",
  generatedAt: "2026-10-11T20:00:00.000Z",
  engine: { hermes: true, runtimeProperties: null, cryptoBackend: "native" },
  environment: {
    platform: "ios",
    osVersion: "27.0",
    deviceModel: "iPhone 17",
    devBuild: false,
  },
  fixture: {
    members: 4,
    rosterBytes: 4488,
    roster2Bytes: 2414,
    clonePayloadBytes: 20480,
    signPayloadBytes: 500,
    aeadPlaintextBytes: 2048,
    sqliteRowBytes: [],
  },
  benchmarks: [
    { name: "ed25519.verify", iterations: 100, totalMs: 3.6, msPerOp: 0.036 },
    {
      name: "SQLite read-all + JSON.parse 4 roster rows",
      iterations: 0,
      totalMs: 0,
      msPerOp: 0,
      skipped: "no database supplied",
    },
  ],
  estimates: [
    {
      participants: 4,
      sender: {
        counts: {
          verifyRoster: 56,
          sign: 12,
          verify: 0,
          keyDerivation: 9,
          aead: 9,
        },
        rosterBenchmark: "verifyRoster(4 members)",
        totalMs: 114.4,
      },
      receiver: {
        counts: {
          verifyRoster: 19,
          sign: 0,
          verify: 1,
          keyDerivation: 1,
          aead: 1,
        },
        rosterBenchmark: "verifyRoster(4 members)",
        totalMs: 33.9,
      },
    },
  ],
};

function props(
  overrides: Partial<React.ComponentProps<typeof TogetherProbePresenter>> = {},
) {
  return {
    engine: "Hermes",
    platform: "ios",
    osVersion: "27.0",
    devBuild: false,
    backend: "native" as const,
    progress: "Idle",
    error: null,
    report: null,
    onRun: jest.fn(),
    onShare: jest.fn(),
    onToggleBackend: jest.fn(),
    ...overrides,
  };
}

describe("TogetherProbePresenter", () => {
  it("shows the engine line, routes the actions and disables Share without a report", () => {
    const p = props();
    const r = renderWithTheme(<TogetherProbePresenter {...p} />);
    expect(
      r.getByText("Engine: Hermes · ios 27.0 · release · crypto: native"),
    ).toBeTruthy();
    expect(r.getByText("Switch to noble (pure JS)")).toBeTruthy();
    fireEvent.press(r.getByTestId("together-probe-run"));
    fireEvent.press(r.getByTestId("together-probe-backend"));
    expect(p.onRun).toHaveBeenCalledTimes(1);
    expect(p.onToggleBackend).toHaveBeenCalledTimes(1);
    fireEvent.press(r.getByTestId("together-probe-share"));
    expect(p.onShare).not.toHaveBeenCalled();
    expect(r.queryByTestId("together-probe-table")).toBeNull();
    expect(r.queryByTestId("together-probe-error")).toBeNull();
  });

  it("renders the report table, skipped rows, estimates, errors and the debug warning", () => {
    const p = props({
      report,
      backend: "noble",
      devBuild: true,
      progress: "Done (9 benchmarks)",
      error: "Error: boom",
    });
    const r = renderWithTheme(<TogetherProbePresenter {...p} />);
    expect(
      r.getByText(
        "Engine: Hermes · ios 27.0 · DEBUG build (numbers misleading) · crypto: noble",
      ),
    ).toBeTruthy();
    expect(r.getByText("Switch to native crypto")).toBeTruthy();
    expect(r.getByText("Done (9 benchmarks)")).toBeTruthy();
    expect(r.getByTestId("together-probe-error").props.children).toBe(
      "Error: boom",
    );
    expect(r.getByText("ed25519.verify")).toBeTruthy();
    expect(r.getByText("0.036")).toBeTruthy();
    expect(r.getByText("3.6")).toBeTruthy();
    expect(r.getByText("skipped")).toBeTruthy();
    expect(r.getAllByText("—")).toHaveLength(2);
    expect(
      r.getByText(
        "Per-set crypto at 4 participants: sender 114 ms · receiver 34 ms",
      ),
    ).toBeTruthy();
    expect(
      r.getByText("Roster 4488 B · clone 20480 B · device iPhone 17"),
    ).toBeTruthy();
    fireEvent.press(r.getByTestId("together-probe-share"));
    expect(p.onShare).toHaveBeenCalledTimes(1);
  });

  it("falls back to an unknown device label", () => {
    const r = renderWithTheme(
      <TogetherProbePresenter
        {...props({
          report: {
            ...report,
            environment: { ...report.environment, deviceModel: null },
          },
        })}
      />,
    );
    expect(
      r.getByText("Roster 4488 B · clone 20480 B · device unknown"),
    ).toBeTruthy();
  });
});

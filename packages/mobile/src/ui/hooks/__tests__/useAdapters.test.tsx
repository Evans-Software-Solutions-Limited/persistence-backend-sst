import React from "react";
import { Text } from "react-native";
import { render, screen, renderHook } from "@testing-library/react-native";
import { useAdapters, AdapterProvider } from "../useAdapters";
import type { Adapters } from "@/shared/types";

// Minimal mock adapters for testing
const mockAdapters = {
  api: {},
  auth: {},
  storage: {},
  health: {},
  notifications: {},
  payments: {},
} as unknown as Adapters;

describe("useAdapters", () => {
  it("throws when used outside AdapterProvider", () => {
    // Suppress console.error from the expected error
    jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useAdapters());
    }).toThrow("useAdapters must be used within an AdapterProvider");

    jest.restoreAllMocks();
  });

  it("returns adapters when used inside AdapterProvider", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AdapterProvider adapters={mockAdapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAdapters(), { wrapper });
    expect(result.current).toBe(mockAdapters);
  });
});

describe("AdapterProvider", () => {
  it("renders children", () => {
    render(
      <AdapterProvider adapters={mockAdapters}>
        <Text>Child</Text>
      </AdapterProvider>,
    );
    expect(screen.getByText("Child")).toBeTruthy();
  });
});

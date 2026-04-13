import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { ErrorBoundary } from "../ErrorBoundary";

function ThrowingChild(): React.ReactElement {
  throw new Error("Test error");
}

function GoodChild(): React.ReactElement {
  return <Text>All good</Text>;
}

// Suppress console.error for expected error boundary logs
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeTruthy();
  });

  it("renders fallback when child throws", () => {
    render(
      <ErrorBoundary fallback={<Text>Something went wrong</Text>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  it("calls onError callback when child throws", () => {
    const onError = jest.fn();
    render(
      <ErrorBoundary onError={onError} fallback={<Text>Error</Text>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe("Test error");
  });

  it("renders null when no fallback provided and child throws", () => {
    const { toJSON } = render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(toJSON()).toBeNull();
  });
});

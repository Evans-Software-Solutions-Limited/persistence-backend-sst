import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
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

  it("renders default fallback when no fallback prop provided and child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("Test error")).toBeTruthy();
    expect(screen.getByText("Try Again")).toBeTruthy();
  });

  it("resets error state when Try Again is pressed", () => {
    // We need a component that throws once then succeeds on re-render
    let shouldThrow = true;
    function ConditionalThrow(): React.ReactElement {
      if (shouldThrow) throw new Error("First render error");
      return <Text>Recovered</Text>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeTruthy();

    // Fix the condition and press retry
    shouldThrow = false;
    fireEvent.press(screen.getByText("Try Again"));

    expect(screen.getByText("Recovered")).toBeTruthy();
  });
});

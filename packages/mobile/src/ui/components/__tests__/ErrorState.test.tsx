import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import { ErrorState } from "../ErrorState";

describe("ErrorState", () => {
  it("renders default title and message", () => {
    const { getByText } = renderWithTheme(
      <ErrorState message="Network error" />,
    );
    expect(getByText("Something went wrong")).toBeTruthy();
    expect(getByText("Network error")).toBeTruthy();
  });

  it("renders custom title", () => {
    const { getByText } = renderWithTheme(
      <ErrorState title="Oops!" message="Something broke" />,
    );
    expect(getByText("Oops!")).toBeTruthy();
  });

  it("renders retry button when onRetry provided", () => {
    const onRetry = jest.fn();
    const { getByText } = renderWithTheme(
      <ErrorState message="Failed" onRetry={onRetry} />,
    );
    expect(getByText("Retry")).toBeTruthy();
  });

  it("does not render retry button when onRetry not provided", () => {
    const { queryByText } = renderWithTheme(<ErrorState message="Failed" />);
    expect(queryByText("Retry")).toBeNull();
  });

  it("renders with testID", () => {
    const { getByTestId } = renderWithTheme(
      <ErrorState message="Error" testID="error" />,
    );
    expect(getByTestId("error")).toBeTruthy();
  });

  it("renders the secondary action and fires onSecondary when both are provided", () => {
    const onSecondary = jest.fn();
    const { getByText } = renderWithTheme(
      <ErrorState
        message="Forbidden"
        secondaryLabel="Switch to athlete mode"
        onSecondary={onSecondary}
      />,
    );
    fireEvent.press(getByText("Switch to athlete mode"));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it("omits the secondary action when only the label is given", () => {
    const { queryByText } = renderWithTheme(
      <ErrorState
        message="Forbidden"
        secondaryLabel="Switch to athlete mode"
      />,
    );
    expect(queryByText("Switch to athlete mode")).toBeNull();
  });
});

import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { RestoreAccountPresenter } from "@/ui/presenters/RestoreAccountPresenter";

describe("RestoreAccountPresenter", () => {
  it("renders the grace-period copy with the formatted purge date", () => {
    renderWithTheme(
      <RestoreAccountPresenter
        purgeAfter="2026-07-31T00:00:00.000Z"
        isRestoring={false}
        onRestore={jest.fn()}
        onSignOut={jest.fn()}
      />,
    );
    expect(screen.getByTestId("restore-account-purge-date")).toBeTruthy();
    expect(screen.getByText(/31 July 2026/)).toBeTruthy();
  });

  it("falls back to generic wording when purgeAfter is null", () => {
    renderWithTheme(
      <RestoreAccountPresenter
        purgeAfter={null}
        isRestoring={false}
        onRestore={jest.fn()}
        onSignOut={jest.fn()}
      />,
    );
    expect(screen.getByText(/in 30 days/)).toBeTruthy();
  });

  it("falls back to generic wording when purgeAfter is an unparseable string", () => {
    renderWithTheme(
      <RestoreAccountPresenter
        purgeAfter="not-a-date"
        isRestoring={false}
        onRestore={jest.fn()}
        onSignOut={jest.fn()}
      />,
    );
    expect(screen.getByText(/in 30 days/)).toBeTruthy();
  });

  it("calls onRestore when the restore button is pressed", () => {
    const onRestore = jest.fn();
    renderWithTheme(
      <RestoreAccountPresenter
        purgeAfter="2026-07-31T00:00:00.000Z"
        isRestoring={false}
        onRestore={onRestore}
        onSignOut={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId("restore-account-restore"));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("calls onSignOut when the sign-out button is pressed", () => {
    const onSignOut = jest.fn();
    renderWithTheme(
      <RestoreAccountPresenter
        purgeAfter="2026-07-31T00:00:00.000Z"
        isRestoring={false}
        onRestore={jest.fn()}
        onSignOut={onSignOut}
      />,
    );
    fireEvent.press(screen.getByTestId("restore-account-sign-out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons and shows a spinner while restoring", () => {
    const onRestore = jest.fn();
    const onSignOut = jest.fn();
    renderWithTheme(
      <RestoreAccountPresenter
        purgeAfter="2026-07-31T00:00:00.000Z"
        isRestoring={true}
        onRestore={onRestore}
        onSignOut={onSignOut}
      />,
    );
    // "Restore my account" text is replaced by the spinner while pending.
    expect(screen.queryByText("Restore my account")).toBeNull();
    fireEvent.press(screen.getByTestId("restore-account-restore"));
    fireEvent.press(screen.getByTestId("restore-account-sign-out"));
    expect(onRestore).not.toHaveBeenCalled();
    expect(onSignOut).not.toHaveBeenCalled();
  });
});

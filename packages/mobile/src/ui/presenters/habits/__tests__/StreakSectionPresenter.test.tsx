import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { StreakSectionPresenter } from "../StreakSectionPresenter";

function render(
  over: Partial<Parameters<typeof StreakSectionPresenter>[0]> = {},
) {
  const props = {
    streak: 12,
    longest: 47,
    freezeTokens: 2,
    atRisk: false,
    skipped: false,
    onSpendFreeze: jest.fn(),
    ...over,
  };
  return { props, ...renderWithTheme(<StreakSectionPresenter {...props} />) };
}

const TID = "habit-streak-section";

describe("StreakSectionPresenter", () => {
  it("renders the collection streak count + normal eyebrow", () => {
    const { getByTestId } = render();
    expect(getByTestId(`${TID}-count`).props.children).toBe(12);
    expect(getByTestId(`${TID}-eyebrow`).props.children).toBe("Habit streak");
  });

  it("normal state: no at-risk banner; CTA is the soft skip prompt", () => {
    const { queryByTestId, getByTestId } = render();
    expect(queryByTestId(`${TID}-at-risk-banner`)).toBeNull();
    expect(getByTestId(`${TID}-freeze-cta`)).toBeTruthy();
  });

  it("at-risk with tokens: shows the warning banner + promotes the eyebrow", () => {
    const { getByTestId } = render({ atRisk: true, freezeTokens: 1 });
    expect(getByTestId(`${TID}-at-risk-banner`)).toBeTruthy();
    expect(getByTestId(`${TID}-eyebrow`).props.children).toBe("Streak at risk");
  });

  it("no tokens: CTA disabled, pressing it is a no-op", () => {
    const { getByTestId, props } = render({ freezeTokens: 0 });
    fireEvent.press(getByTestId(`${TID}-freeze-cta`));
    expect(props.onSpendFreeze).not.toHaveBeenCalled();
  });

  it("has tokens: pressing the CTA spends a freeze", () => {
    const { getByTestId, props } = render({ freezeTokens: 2 });
    fireEvent.press(getByTestId(`${TID}-freeze-cta`));
    expect(props.onSpendFreeze).toHaveBeenCalled();
  });

  it("skipped: CTA is inert (no-op) even with tokens", () => {
    const { getByTestId, props } = render({ freezeTokens: 2, skipped: true });
    fireEvent.press(getByTestId(`${TID}-freeze-cta`));
    expect(props.onSpendFreeze).not.toHaveBeenCalled();
  });

  it("at-risk banner hidden once skipped", () => {
    const { queryByTestId } = render({
      atRisk: true,
      freezeTokens: 1,
      skipped: true,
    });
    expect(queryByTestId(`${TID}-at-risk-banner`)).toBeNull();
  });
});

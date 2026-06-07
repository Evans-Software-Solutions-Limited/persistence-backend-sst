import React from "react";
import { TrainerBannerPresenter } from "../TrainerBannerPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const CLIENT = { initials: "JD", name: "Jane Doe" };

describe("TrainerBannerPresenter", () => {
  it("LIVE state: 'TRAINING LIVE WITH' eyebrow + name + LIVE pill + glow dot", () => {
    const { getByText, getByTestId, queryByTestId } = renderWithTheme(
      <TrainerBannerPresenter withClient={CLIENT} retroactive={false} />,
    );
    expect(getByTestId("trainer-banner-eyebrow").props.children).toBe(
      "TRAINING LIVE WITH",
    );
    expect(getByText("Jane Doe")).toBeTruthy();
    expect(getByTestId("trainer-banner-pill-live")).toBeTruthy();
    expect(getByTestId("trainer-banner-live-dot")).toBeTruthy();
    expect(queryByTestId("trainer-banner-pill-retro")).toBeNull();
  });

  it("defaults to LIVE when retroactive is omitted", () => {
    const { getByTestId } = renderWithTheme(
      <TrainerBannerPresenter withClient={CLIENT} />,
    );
    expect(getByTestId("trainer-banner-eyebrow").props.children).toBe(
      "TRAINING LIVE WITH",
    );
    expect(getByTestId("trainer-banner-pill-live")).toBeTruthy();
  });

  it("RETRO state: 'LOGGING SESSION FOR' eyebrow + RETRO pill, no LIVE dot", () => {
    const { getByText, getByTestId, queryByTestId } = renderWithTheme(
      <TrainerBannerPresenter withClient={CLIENT} retroactive />,
    );
    expect(getByTestId("trainer-banner-eyebrow").props.children).toBe(
      "LOGGING SESSION FOR",
    );
    expect(getByText("Jane Doe")).toBeTruthy();
    expect(getByTestId("trainer-banner-pill-retro")).toBeTruthy();
    expect(queryByTestId("trainer-banner-pill-live")).toBeNull();
    expect(queryByTestId("trainer-banner-live-dot")).toBeNull();
  });

  it("renders the client initials in the avatar", () => {
    const { getByText } = renderWithTheme(
      <TrainerBannerPresenter withClient={CLIENT} retroactive={false} />,
    );
    expect(getByText("JD")).toBeTruthy();
  });
});

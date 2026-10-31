import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { IconX } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import {
  TOGETHER_INVITE_QR,
  TogetherInvitePresenter,
} from "../TogetherInvitePresenter";

describe("TogetherInvitePresenter (canvas rows 1b/1c)", () => {
  it("draws the close icon in the pill's $text2, not currentColor (black on device)", () => {
    const onClose = jest.fn();
    const r = renderWithTheme(
      <TogetherInvitePresenter
        qr={null}
        code="4KQ928"
        connection="local"
        onShare={jest.fn()}
        onClose={onClose}
      />,
    );
    expect(r.UNSAFE_getByType(IconX).props.color).toBe(color.$text2);
    fireEvent.press(r.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Everything the canvas shows stays: title, code, mode line, Share code.
    expect(r.getByText("Invite people")).toBeTruthy();
    expect(r.getByTestId("together-session-code")).toBeTruthy();
    expect(
      r.getByText(
        "Nearby · no internet needed · training partners join straight in",
      ),
    ).toBeTruthy();
    expect(r.getByText("Share code")).toBeTruthy();
  });

  it("sizes the invite code as the canvas does: 200 pt inside the 14 pt white box", () => {
    expect(TOGETHER_INVITE_QR).toEqual({ size: 200, quietZone: 0 });
  });
});

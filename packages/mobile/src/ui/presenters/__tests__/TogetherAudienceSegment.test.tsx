import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherAudienceSegment } from "../TogetherAudienceSegment";
import { TogetherAudienceOptions } from "../TogetherAudienceOptions";
import { TogetherConnectionChoice } from "../TogetherConnectionChoice";
it("offers Private, Partners and Open nearby with the matching copy", () => {
  const onChange = jest.fn();
  const r = renderWithTheme(
    <TogetherAudienceSegment
      value="friends"
      online={false}
      onChange={onChange}
    />,
  );
  expect(
    r.getByRole("radio", { name: "Partners" }).props.accessibilityState.checked,
  ).toBe(true);
  expect(r.getByText(/Training partners join straight in/)).toBeTruthy();
  fireEvent.press(r.getByRole("radio", { name: "Private" }));
  expect(onChange).toHaveBeenLastCalledWith("invite-only");
  fireEvent.press(r.getByRole("radio", { name: "Open nearby" }));
  expect(onChange).toHaveBeenLastCalledWith("open");
  r.rerender(
    <TogetherAudienceSegment
      value="invite-only"
      online={false}
      onChange={onChange}
    />,
  );
  expect(r.getByText("Only people with the code or QR.")).toBeTruthy();
  r.rerender(
    <TogetherAudienceSegment value="open" online={false} onChange={onChange} />,
  );
  expect(r.getByText(/Anyone near you can ask/)).toBeTruthy();
});
it("disables Open nearby under Online and says why", () => {
  const onChange = jest.fn();
  const r = renderWithTheme(
    <TogetherAudienceSegment value="friends" online onChange={onChange} />,
  );
  const open = r.getByRole("radio", { name: "Open nearby" });
  expect(open.props.accessibilityState.disabled).toBe(true);
  fireEvent.press(open);
  expect(onChange).not.toHaveBeenCalled();
  expect(r.getByText(/Open nearby works only with Nearby/)).toBeTruthy();
});
it("the row 1c list disables Open nearby under Online and never reports it checked", () => {
  const onAudienceChange = jest.fn();
  const r = renderWithTheme(
    <TogetherAudienceOptions
      audience="open"
      online
      onAudienceChange={onAudienceChange}
    />,
  );
  const open = r.getByRole("radio", { name: "Open nearby" });
  expect(open.props.accessibilityState).toEqual({
    checked: false,
    disabled: true,
  });
  expect(r.getByText("Nearby only. Pick Nearby to use it.")).toBeTruthy();
  fireEvent.press(open);
  expect(onAudienceChange).not.toHaveBeenCalled();
  fireEvent.press(r.getByRole("radio", { name: "Training partners" }));
  expect(onAudienceChange).toHaveBeenLastCalledWith("friends");
  r.rerender(
    <TogetherAudienceOptions
      audience="open"
      onAudienceChange={onAudienceChange}
    />,
  );
  expect(
    r.getByRole("radio", { name: "Open nearby" }).props.accessibilityState,
  ).toEqual({ checked: true, disabled: false });
  expect(r.getByText("Anyone near you can ask to join")).toBeTruthy();
  expect(r.getByText("Code or QR only")).toBeTruthy();
});
it("How you connect lists Nearby always and Online only when available", () => {
  const onChange = jest.fn();
  const r = renderWithTheme(
    <TogetherConnectionChoice
      value="local"
      onChange={onChange}
      onlineAvailable
    />,
  );
  expect(
    r.getByRole("radio", { name: "Nearby · no internet needed" }).props
      .accessibilityState.checked,
  ).toBe(true);
  expect(
    r.getByText("Phones near each other. Wi-Fi on, no network needed."),
  ).toBeTruthy();
  fireEvent.press(r.getByRole("radio", { name: "Online · internet required" }));
  expect(onChange).toHaveBeenCalledWith("online");
  expect(
    r.getByText("Partners anywhere. Every phone needs internet."),
  ).toBeTruthy();
  r.rerender(
    <TogetherConnectionChoice
      value="local"
      onChange={onChange}
      onlineAvailable={false}
    />,
  );
  expect(r.queryByText("Online · internet required")).toBeNull();
  expect(r.queryByText(/hotspot|same Wi-Fi/)).toBeNull();
});

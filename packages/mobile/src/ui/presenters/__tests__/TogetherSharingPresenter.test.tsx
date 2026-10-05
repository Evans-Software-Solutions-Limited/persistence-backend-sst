import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherSharingPresenter } from "../TogetherSharingPresenter";
import type { TogetherSharedSnapshot } from "@/domain/ports/togetherShared.port";
const snapshot: TogetherSharedSnapshot = {
  progress: [],
  plan: null,
  planHash: null,
  profiles: { a: "Mia" },
  athletePlans: {},
  athletes: [],
  previous: {},
  grants: [],
  closures: [],
  delegated: [],
  deliveries: [],
};
const props = () => ({
  snapshot,
  accountId: "me",
  members: [
    { userId: "me", host: true },
    { userId: "a", host: false },
    { userId: "b", host: false },
  ],
  role: "host" as const,
  onConsent: jest.fn(),
  onClose: jest.fn(),
  onRemove: jest.fn(),
});
it("starts separate permissions off for every recipient and never combines them", () => {
  const p = props();
  const r = renderWithTheme(<TogetherSharingPresenter {...p} />);
  fireEvent(r.getByLabelText("Show my numbers · Mia"), "valueChange", true);
  expect(p.onConsent).toHaveBeenCalledWith("a", {
    numbers: true,
    prev: false,
    logging: false,
  });
  fireEvent(
    r.getByLabelText("Share my previous values · Athlete 2"),
    "valueChange",
    true,
  );
  expect(p.onConsent).toHaveBeenLastCalledWith("b", {
    numbers: false,
    prev: true,
    logging: false,
  });
  fireEvent(
    r.getByLabelText("Let them fill in my sets · Mia"),
    "valueChange",
    true,
  );
  expect(p.onConsent).toHaveBeenLastCalledWith("a", {
    numbers: false,
    prev: false,
    logging: true,
  });
  expect(r.queryByLabelText(/me/)).toBeNull();
});
it("revokes only the selected grant while preserving its other explicit consents", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherSharingPresenter
      {...p}
      snapshot={{
        ...snapshot,
        grants: [
          {
            ownerId: "me",
            recipientId: "a",
            version: 4,
            consent: { numbers: true, prev: true, logging: true },
          },
        ],
      }}
    />,
  );
  fireEvent(
    r.getByLabelText("Share my previous values · Mia"),
    "valueChange",
    false,
  );
  expect(p.onConsent).toHaveBeenCalledWith("a", {
    numbers: true,
    prev: false,
    logging: true,
  });
});
it("distinguishes cloud session logging from per-recipient numbers and PREV", () => {
  const p = props(),
    onSessionLogging = jest.fn();
  const r = renderWithTheme(
    <TogetherSharingPresenter
      {...p}
      sessionLogging
      onSessionLogging={onSessionLogging}
    />,
  );
  expect(r.queryByLabelText("Let them fill in my sets · Mia")).toBeNull();
  fireEvent(
    r.getByLabelText("Let others fill in my sets"),
    "valueChange",
    false,
  );
  expect(onSessionLogging).toHaveBeenCalledWith(false);
  expect(p.onConsent).not.toHaveBeenCalled();
  r.rerender(
    <TogetherSharingPresenter {...p} onSessionLogging={onSessionLogging} />,
  );
  expect(r.getByLabelText("Let others fill in my sets").props.value).toBe(
    false,
  );
});
it("supports host removal and distinct closure choices; guests can only leave", () => {
  const p = props();
  const r = renderWithTheme(<TogetherSharingPresenter {...p} />);
  fireEvent.press(r.getAllByText("Remove from session")[1]);
  expect(p.onRemove).toHaveBeenCalledWith("b");
  fireEvent.press(r.getByText("End session for everyone"));
  fireEvent.press(r.getByText("End sharing · save only mine"));
  expect(p.onClose.mock.calls).toEqual([["finish_all"], ["save_own"]]);
  r.rerender(<TogetherSharingPresenter {...p} role="guest" />);
  expect(r.queryByText("Remove from session")).toBeNull();
  fireEvent.press(r.getByText("Leave · review my result"));
  expect(p.onClose).toHaveBeenLastCalledWith("leave");
});
it("removes permissions and closure actions after host or own sharing ended", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherSharingPresenter
      {...p}
      snapshot={{ ...snapshot, closures: [{ userId: "me", mode: "leave" }] }}
    />,
  );
  expect(r.getByText(/Sharing has ended/)).toBeTruthy();
  expect(r.queryByLabelText("Show my numbers · Mia")).toBeNull();
  r.rerender(
    <TogetherSharingPresenter
      {...p}
      accountId="b"
      snapshot={{
        ...snapshot,
        closures: [{ userId: "me", mode: "finish_all" }],
      }}
    />,
  );
  expect(r.queryByText("Leave · review my result")).toBeNull();
});
it("describes peer receipts separately from account save, including pending recipients", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherSharingPresenter
      {...p}
      snapshot={{
        ...snapshot,
        closures: [{ userId: "unrelated", mode: "leave" }],
        deliveries: [
          { recipientId: "a", state: "received", revision: 4 },
          { recipientId: "b", state: "pending", revision: 5 },
        ],
      }}
    />,
  );
  expect(r.getByText(/Mia.*shared view received.*revision 4/)).toBeTruthy();
  expect(
    r.getByText(/Training partner.*shared view awaiting receipt.*revision 5/),
  ).toBeTruthy();
});

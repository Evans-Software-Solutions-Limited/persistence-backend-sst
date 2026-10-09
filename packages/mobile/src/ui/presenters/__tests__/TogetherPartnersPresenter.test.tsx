import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { act, fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherPartnersPresenter,
  type TogetherPartnersPresenterProps,
} from "../TogetherPartnersPresenter";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
const person = { userId: "mia", displayName: "Mia", avatarUrl: null };
const offer = {
  id: "offer",
  senderId: "mia",
  recipientId: "u",
  plan: { name: "Push", exercises: [] },
  createdAt: "2026-10-01",
  revoked: false,
};
function props(): TogetherPartnersPresenterProps {
  return {
    tab: "Partners",
    query: "",
    code: "",
    codeVisible: false,
    ownCode: null,
    busy: false,
    loading: false,
    available: true,
    error: "",
    notice: "",
    friends: [person],
    requests: [{ ...person, requestId: "request" }],
    results: [],
    offers: [offer],
    reporting: false,
    onReporting: jest.fn(),
    selected: null,
    selectedOffer: null,
    discoverable: false,
    onTab: jest.fn(),
    onQuery: jest.fn(),
    onCode: jest.fn(),
    onResolve: jest.fn(),
    onShowCode: jest.fn(),
    onCloseCode: jest.fn(),
    onNewCode: jest.fn(),
    onCopyCode: jest.fn(),
    onShareCode: jest.fn(),
    onScan: jest.fn(),
    onSearch: jest.fn(),
    onRefresh: jest.fn(),
    onBack: jest.fn(),
    onSelect: jest.fn(),
    onRequest: jest.fn(),
    onDecide: jest.fn(),
    onRemove: jest.fn(),
    onBlock: jest.fn(),
    onReport: jest.fn(),
    onDiscoverable: jest.fn(),
    onOffer: jest.fn(),
    onCopy: jest.fn(),
  };
}
it("uses deliberate request decisions and actual partner profile actions", () => {
  const p = props();
  const r = renderWithTheme(<TogetherPartnersPresenter {...p} />);
  fireEvent.press(r.getByText("Accept"));
  fireEvent.press(r.getByText("No"));
  expect(p.onDecide).toHaveBeenNthCalledWith(1, "request", "accept");
  expect(p.onDecide).toHaveBeenNthCalledWith(2, "request", "reject");
  fireEvent.press(r.getByLabelText("View Mia"));
  expect(p.onSelect).toHaveBeenCalledWith(person);
  fireEvent.press(r.getByText("Review Push"));
  expect(p.onOffer).toHaveBeenCalledWith(offer);
  fireEvent.press(r.getByLabelText("Go back"));
  act(() =>
    r.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh(),
  );
  expect(p.onRefresh).toHaveBeenCalled();
  expect(r.queryByText("Refresh")).toBeNull();
  fireEvent.press(r.getByLabelText("My code and QR"));
  expect(p.onShowCode).toHaveBeenCalled();
  fireEvent(
    r.getByLabelText("Let people find me by name"),
    "valueChange",
    true,
  );
  expect(p.onDiscoverable).toHaveBeenCalledWith(true);
  r.rerender(<TogetherPartnersPresenter {...p} selected={person} />);
  fireEvent.press(r.getByText("Remove partner"));
  fireEvent.press(r.getByText("Block"));
  fireEvent.press(r.getByText("Report"));
  expect(p.onReporting).toHaveBeenCalledWith(true);
  r.rerender(<TogetherPartnersPresenter {...p} selected={person} reporting />);
  fireEvent.press(r.getByText("Report spam"));
  fireEvent.press(r.getByText("Cancel report"));
  fireEvent.press(r.getByText("Done"));
  expect(p.onRemove).toHaveBeenCalledWith("mia");
  expect(p.onBlock).toHaveBeenCalledWith("mia");
  expect(p.onReport).toHaveBeenCalledWith("mia", "spam");
  expect(p.onSelect).toHaveBeenLastCalledWith(null);
});
it("has no actionable fake rows, distinguishes outgoing invitations and disables unknown preference", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherPartnersPresenter
      {...p}
      friends={[]}
      requests={[{ ...person, outgoing: true, requestId: "sent" }]}
      discoverable={null}
      available={false}
      error="Offline"
      notice="On this device"
      loading
    />,
  );
  expect(r.queryByText("Accept")).toBeNull();
  expect(r.getByText("Invitation sent")).toBeTruthy();
  expect(r.getByLabelText("Let people find me by name").props.disabled).toBe(
    true,
  );
  fireEvent.press(r.getByLabelText("My code and QR"));
  expect(p.onShowCode).not.toHaveBeenCalled();
  r.rerender(<TogetherPartnersPresenter {...p} friends={[]} loading={false} />);
  expect(r.getByText(/No training partners yet/)).toBeTruthy();
});
it("name and code search remain separate from the deliberate invitation", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherPartnersPresenter
      {...p}
      tab="Add"
      query="Mia"
      code={"a".repeat(32)}
      results={[{ ...person, avatarUrl: "https://example.com/avatar.png" }]}
    />,
  );
  fireEvent.changeText(r.getByLabelText("Find by name"), "Tom");
  fireEvent(r.getByLabelText("Find by name"), "submitEditing");
  fireEvent.changeText(r.getByLabelText("Partner code"), "b".repeat(32));
  fireEvent.press(r.getByText("Find by code"));
  fireEvent.press(r.getByText("Scan QR"));
  expect(p.onRequest).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Invite as training partner"));
  expect(p.onRequest).toHaveBeenCalledWith("mia");
  expect(p.onQuery).toHaveBeenCalledWith("Tom");
  expect(p.onSearch).toHaveBeenCalled();
  expect(p.onResolve).toHaveBeenCalled();
  expect(p.onScan).toHaveBeenCalled();
});
it("reviews authorized plan and own code in separate sheets", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherPartnersPresenter
      {...p}
      selectedOffer={offer}
      codeVisible
      ownCode={{ code: "a".repeat(32), expiresAt: "2026-10-12T00:00:00Z" }}
    />,
  );
  fireEvent.press(r.getByText("Save my own copy"));
  fireEvent.press(r.getByText("New code"));
  fireEvent.press(r.getByText("Copy my code"));
  fireEvent.press(r.getByText("Share"));
  expect(p.onCopy).toHaveBeenCalledWith("offer");
  expect(p.onNewCode).toHaveBeenCalled();
  expect(p.onCopyCode).toHaveBeenCalled();
  expect(p.onShareCode).toHaveBeenCalled();
  r.UNSAFE_getAllByType(BottomSheet).forEach((s) => s.props.onClose());
  expect(p.onCloseCode).toHaveBeenCalled();
  expect(p.onOffer).toHaveBeenCalledWith(null);
  expect(p.onSelect).toHaveBeenCalledWith(null);
});
it("names anonymous profiles honestly without calling them friends", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherPartnersPresenter
      {...p}
      tab="Add"
      friends={[]}
      results={[{ userId: "unknown", displayName: null, avatarUrl: null }]}
    />,
  );
  expect(r.getByText("Training partner")).toBeTruthy();
  expect(r.queryByText(/unknown/)).toBeNull();
  expect(r.getByText("Name and photo only")).toBeTruthy();
});

it("keeps the header fixed and all three drawers outside the scrolling list, with code actions pinned", () => {
  const r = renderWithTheme(
    <TogetherPartnersPresenter
      {...props()}
      codeVisible
      ownCode={{ code: "a".repeat(32), expiresAt: "2026-10-12" }}
    />,
  );
  const scroll = r.UNSAFE_getByType(ScrollView);
  expect(
    scroll.findAllByProps({ testID: "together-partners-header" }),
  ).toHaveLength(0);
  const sheets = r.UNSAFE_getAllByType(BottomSheet);
  expect(sheets).toHaveLength(3);
  for (const sheet of sheets) {
    let parent = sheet.parent;
    while (parent) {
      expect(parent).not.toBe(scroll);
      parent = parent.parent;
    }
  }
  const codeSheet = sheets.find((sheet) => sheet.props.title === "Your code")!;
  expect(codeSheet.props.footer).toBeTruthy();
  expect(
    StyleSheet.flatten(r.getByTestId("together-partners-root").props.style),
  ).toEqual(expect.objectContaining({ flex: 1 }));
});

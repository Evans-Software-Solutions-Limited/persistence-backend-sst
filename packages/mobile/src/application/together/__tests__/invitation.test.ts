import {
  createTogetherInvitationLink,
  readTogetherInvitation,
  invitationPayload,
} from "../invitation";
import { redirectSystemPathForDeepLink } from "@/application/notifications/deep-link";

it.each([
  "persistencemobile",
  "persistencemobile-staging",
  "persistencemobile-play-test",
])(
  "round trips signed local authority through the %s OS route without joining",
  (scheme) => {
    const value = {
      connection: "local" as const,
      invitation: JSON.stringify({ token: "a+b&c=?", signature: "signed" }),
      transport: "lan" as const,
    };
    const link = createTogetherInvitationLink(scheme, value);
    expect(readTogetherInvitation(link)).toEqual(value);
    expect(invitationPayload(link, "local")).toBe(value.invitation);
    expect(redirectSystemPathForDeepLink(link)).toBe(
      `/(app)/together/join?${link.split("?")[1]}`,
    );
  },
);
it("preserves online invitation authority and requires the matching connection", () => {
  const link = createTogetherInvitationLink("persistencemobile", {
    connection: "online",
    invitation: "private-token",
  });
  expect(readTogetherInvitation(link)).toEqual({
    connection: "online",
    invitation: "private-token",
  });
  expect(invitationPayload(link, "online")).toBe("private-token");
  expect(() => invitationPayload(link, "local")).toThrow(
    "wrong-invitation-connection",
  );
});
it("retains legacy local JSON and pasted tokens for adapter validation", () => {
  expect(readTogetherInvitation(' {"signed":true} ')).toEqual({
    connection: "local",
    invitation: '{"signed":true}',
  });
  expect(invitationPayload(" token ", "online")).toBe("token");
});
it.each([
  "",
  "x".repeat(16001),
  "{".repeat(6001),
  "https://together/join?connection=local&invitation=a",
  "persistencemobile://evil/join?connection=local&invitation=a",
  "persistencemobile://together/other?connection=local&invitation=a",
  "persistencemobile://together/join?connection=local&invitation=a#x",
  "persistencemobile://u:p@together/join?connection=local&invitation=a",
  "persistencemobile://together/join?connection=local&invitation=a&invitation=b",
  "persistencemobile://together/join?connection=local&connection=online&invitation=a",
  "persistencemobile://together/join?connection=bad&invitation=a",
  "persistencemobile://together/join?connection=local&invitation=",
  "persistencemobile://together/join?connection=local&invitation=a&transport=bad",
  `persistencemobile://together/join?connection=local&invitation=${"a".repeat(6001)}`,
])("rejects malformed or untrusted invitation %s", (value) =>
  expect(() => readTogetherInvitation(value)).toThrow(),
);
it.each(["nearby", "hotspot-owner"] as const)(
  "retains %s selection",
  (transport) => {
    const value = {
      connection: "local" as const,
      invitation: "signed",
      transport,
    };
    expect(
      readTogetherInvitation(
        createTogetherInvitationLink("persistencemobile", value),
      ),
    ).toEqual(value);
  },
);
it("rejects invalid outgoing authority", () => {
  expect(() =>
    createTogetherInvitationLink("https", {
      connection: "local",
      invitation: "signed",
    }),
  ).toThrow();
  expect(() =>
    createTogetherInvitationLink("persistencemobile", {
      connection: "local",
      invitation: "",
    }),
  ).toThrow();
  expect(() =>
    createTogetherInvitationLink("persistencemobile", {
      connection: "local",
      invitation: "x".repeat(6001),
    }),
  ).toThrow();
});

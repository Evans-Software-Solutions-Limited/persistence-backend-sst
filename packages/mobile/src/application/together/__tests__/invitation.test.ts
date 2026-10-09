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

it("accepts previous uncompressed app links", () => {
  const invitation = JSON.stringify({
    payload: { name: "Mía 🏋️" },
    signature: "signed",
  });
  expect(
    readTogetherInvitation(
      `persistencemobile://together/join?connection=local&invitation=${encodeURIComponent(invitation)}`,
    ).invitation,
  ).toBe(invitation);
});
it("does not expand or change opaque online tokens", () => {
  const token = "a".repeat(500);
  expect(
    createTogetherInvitationLink("persistencemobile", {
      connection: "online",
      invitation: token,
    }),
  ).toContain(`invitation=${token}`);
});
it("preserves Unicode byte-for-byte", () => {
  const invitation = JSON.stringify({
    workout: "Mía 🏋️ 日本語",
    signed: "abc".repeat(300),
  });
  const link = createTogetherInvitationLink("persistencemobile", {
    connection: "local",
    invitation,
  });
  expect(link).toContain("invitation=z1.");
  expect(readTogetherInvitation(link).invitation).toBe(invitation);
});
it.each(["z1.", "z1.***", "z1.A", "z1.AB", "z1.AAAA", "z1.AA"])(
  "rejects malformed compact authority %s",
  (invitation) => {
    expect(() =>
      readTogetherInvitation(
        `persistencemobile://together/join?connection=local&invitation=${invitation}`,
      ),
    ).toThrow();
  },
);
it("uses raw authority when compression is larger or UTF-8 exceeds its byte budget", () => {
  for (const invitation of [
    "{}",
    '{"name":"' + "x".repeat(4000) + "🏋️".repeat(300) + '"}',
  ]) {
    const link = createTogetherInvitationLink("persistencemobile", {
      connection: "local",
      invitation,
    });
    expect(readTogetherInvitation(link).invitation).toBe(invitation);
    expect(link).not.toContain("invitation=z1.");
  }
});

/** @jest-environment node */
import { deflateSync, strToU8 } from "fflate";
import {
  createTogetherInvitationLink,
  readTogetherInvitation,
} from "@/application/together/invitation";
import { createLobbyInvitation, readLobbyInvitation } from "../lobbyInvitation";
import {
  publicKeyPem,
  signPayload,
  type Credential,
} from "../security/identity";
import { encode64 } from "../security/encoding";
const now = 1700000000000;
const authority = new Uint8Array(32).fill(77);
const host = new Uint8Array(32).fill(1);
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const trusted = { v1: publicKeyPem(authority) };
const credential = signPayload<Credential>(
  {
    kind: "together-device-v1",
    keyId: "v1",
    userId: id(1),
    deviceId: id(11),
    publicKey: publicKeyPem(host),
    issuedAt: now - 100,
    expiresAt: now + 60000,
  },
  authority,
);
it.each(["open", "friends", "invite-only"] as const)(
  "reduces %s QR density and preserves verified authority",
  (audience) => {
    const raw = createLobbyInvitation(
      { sessionId: id(100), hostUserId: id(1), hostDeviceId: id(11) },
      "Mía's leg day 🏋️",
      credential,
      host,
      {
        audience,
        ...(audience === "invite-only"
          ? { invitationToken: "a".repeat(43) }
          : {}),
      },
    );
    const link = createTogetherInvitationLink("persistencemobile-staging", {
      connection: "local",
      invitation: raw,
      transport: "lan",
    });
    const previous = `persistencemobile-staging://together/join?connection=local&invitation=${encodeURIComponent(raw)}&transport=lan`;
    expect(link.length).toBeLessThan(previous.length * 0.65);
    const decoded = readTogetherInvitation(link).invitation;
    expect(decoded).toBe(raw);
    expect(readLobbyInvitation(decoded, trusted, now).audience).toBe(audience);
    const tampered = JSON.parse(decoded);
    tampered.payload.hostUserId = id(2);
    expect(() =>
      readLobbyInvitation(JSON.stringify(tampered), trusted, now),
    ).toThrow();
    expect(() => readLobbyInvitation(decoded, trusted, now + 60001)).toThrow();
  },
);
it("rejects oversized compressed expansion and truncated data", () => {
  const compact =
    "z1." + encode64(deflateSync(strToU8("{" + "a".repeat(50000))), true);
  expect(() =>
    readTogetherInvitation(
      `persistencemobile://together/join?connection=local&invitation=${compact}`,
    ),
  ).toThrow();
  const short =
    "z1." +
    encode64(
      deflateSync(strToU8('{"a":"' + "x".repeat(100) + '"}')).slice(0, -2),
      true,
    );
  expect(() =>
    readTogetherInvitation(
      `persistencemobile://together/join?connection=local&invitation=${short}`,
    ),
  ).toThrow();
});
it("rejects a compact local envelope as an online invitation", () => {
  const compact = "z1." + encode64(deflateSync(strToU8('{"a":1}')), true);
  expect(() =>
    readTogetherInvitation(
      `persistencemobile://together/join?connection=online&invitation=${compact}`,
    ),
  ).toThrow();
});

import type { TogetherTransport } from "@/domain/ports/togetherLobby.port";

export interface TogetherInvitation {
  connection: "local" | "online";
  invitation: string;
  transport?: TogetherTransport;
}
const SCHEME = /^persistencemobile(?:-[a-z0-9-]+)?:$/i;

/** Links select an invitation only. The receiving adapter still verifies authority. */
export function readTogetherInvitation(value: string): TogetherInvitation {
  const text = value.trim();
  if (!text || text.length > 16000) throw new Error("invalid-invitation");
  if (text.startsWith("{")) {
    if (text.length > 6000) throw new Error("invalid-invitation");
    return { connection: "local", invitation: text };
  }
  const url = new URL(text);
  if (
    !SCHEME.test(url.protocol) ||
    url.hostname !== "together" ||
    url.pathname !== "/join" ||
    url.hash ||
    url.username ||
    url.password ||
    url.searchParams.getAll("invitation").length !== 1 ||
    url.searchParams.getAll("connection").length !== 1
  )
    throw new Error("invalid-invitation");
  const connection = url.searchParams.get("connection");
  const invitation = url.searchParams.get("invitation");
  const transport = url.searchParams.get("transport");
  if (
    (connection !== "local" && connection !== "online") ||
    !invitation?.trim() ||
    invitation.length > 6000 ||
    (transport && !["lan", "nearby", "hotspot-owner"].includes(transport))
  )
    throw new Error("invalid-invitation");
  return {
    connection,
    invitation,
    ...(transport === "lan" ||
    transport === "nearby" ||
    transport === "hotspot-owner"
      ? { transport }
      : {}),
  };
}

export function createTogetherInvitationLink(
  scheme: string,
  value: TogetherInvitation,
): string {
  if (
    !SCHEME.test(`${scheme}:`) ||
    !value.invitation ||
    value.invitation.length > 6000
  )
    throw new Error("invalid-invitation");
  return `${scheme}://together/join?connection=${value.connection}&invitation=${encodeURIComponent(value.invitation)}${value.transport ? `&transport=${value.transport}` : ""}`;
}

/** Paste/scan accepts current links and the old raw payload for compatibility. */
export function invitationPayload(
  text: string,
  connection: "local" | "online",
): string {
  if (!text.trim().includes("://")) return text.trim();
  const value = readTogetherInvitation(text);
  if (value.connection !== connection)
    throw new Error("wrong-invitation-connection");
  return value.invitation;
}

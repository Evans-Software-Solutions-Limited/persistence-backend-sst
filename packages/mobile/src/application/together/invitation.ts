import { deflateSync, Inflate, strFromU8, strToU8 } from "fflate";
import type { TogetherTransport } from "@/domain/ports/togetherLobby.port";

export interface TogetherInvitation {
  connection: "local" | "online";
  invitation: string;
  transport?: TogetherTransport;
}
const SCHEME = /^persistencemobile(?:-[a-z0-9-]+)?:$/i;

const COMPACT_PREFIX = "z1.";
const MAX_BYTES = 6000;

/** A reversible wire envelope only; signed authority is verified by the adapter. */
function compactInvitation(value: TogetherInvitation): string {
  const raw = value.invitation;
  if (value.connection !== "local" || !raw.startsWith("{")) return raw;
  const bytes = strToU8(raw);
  if (bytes.length > MAX_BYTES) return raw;
  const compressed = deflateSync(bytes, { level: 9 });
  const encoded =
    COMPACT_PREFIX +
    btoa(Array.from(compressed, (byte) => String.fromCharCode(byte)).join(""))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return encoded.length < encodeURIComponent(raw).length ? encoded : raw;
}

function expandInvitation(value: string, connection: string): string {
  if (!value.startsWith(COMPACT_PREFIX)) return value;
  if (connection !== "local") throw new Error("invalid-invitation");
  const encoded = value.slice(COMPACT_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("invalid-invitation");
  const bytes = Uint8Array.from(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  // Reject noncanonical base64 as well as malformed DEFLATE. Feed bounded chunks
  // so an untrusted expansion cannot allocate its entire output before the cap.
  if (
    btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "") !== encoded
  )
    throw new Error("invalid-invitation");
  const output = new Uint8Array(MAX_BYTES);
  let length = 0;
  const inflater = new Inflate((chunk) => {
    if (length + chunk.length > MAX_BYTES)
      throw new Error("invalid-invitation");
    output.set(chunk, length);
    length += chunk.length;
  });
  for (let i = 0; i < bytes.length; i++)
    inflater.push(bytes.subarray(i, i + 1), i === bytes.length - 1);
  const raw = strFromU8(output.subarray(0, length));
  if (!raw.startsWith("{") || strToU8(raw).length !== length)
    throw new Error("invalid-invitation");
  return raw;
}

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
    invitation: expandInvitation(invitation, connection),
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
  return `${scheme}://together/join?connection=${value.connection}&invitation=${encodeURIComponent(compactInvitation(value))}${value.transport ? `&transport=${value.transport}` : ""}`;
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

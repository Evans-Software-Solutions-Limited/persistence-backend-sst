import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { requireTogether, TogetherError } from "../together/shared";
function sign(payload: string) {
  const secret = process.env.TOGETHER_TOKEN_SECRET;
  requireTogether(secret && secret.length >= 32, "UNAVAILABLE", 503);
  return createHmac("sha256", secret)
    .update(`cursor:${payload}`)
    .digest("base64url");
}
export function encodeCursor(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function decodeCursor(cursor: string): Record<string, unknown> {
  const [payload, signature, ...extra] = cursor.split(".");
  requireTogether(
    payload && signature && extra.length === 0,
    "INVALID_CURSOR",
    400,
  );
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  requireTogether(
    expected.length === supplied.length && timingSafeEqual(expected, supplied),
    "INVALID_CURSOR",
    400,
  );
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    requireTogether(
      value && typeof value === "object" && !Array.isArray(value),
      "INVALID_CURSOR",
      400,
    );
    return value;
  } catch (error) {
    if (error instanceof TogetherError) throw error;
    throw new TogetherError("INVALID_CURSOR", 400);
  }
}
/** Signed, query-bound position; every page independently rechecks authorization. */
export function pagePosition(actor: string, query: string, cursor?: string) {
  if (!cursor) return "00000000-0000-0000-0000-000000000000";
  const value = decodeCursor(cursor);
  requireTogether(
    value.scope === scope(actor, query) &&
      typeof value.after === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.after,
      ),
    "INVALID_CURSOR",
    400,
  );
  requireTogether(
    typeof value.expires === "number" && value.expires > Date.now(),
    "CURSOR_EXPIRED",
    410,
  );
  return value.after;
}
function scope(actor: string, query: string) {
  return createHash("sha256")
    .update(JSON.stringify([actor, query]))
    .digest("hex");
}
export function nextPage(actor: string, query: string, after: string) {
  return encodeCursor({
    scope: scope(actor, query),
    after,
    expires: Date.now() + 900_000,
  });
}

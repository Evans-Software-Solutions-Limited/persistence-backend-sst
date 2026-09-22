import { createHmac, randomUUID } from "node:crypto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  pagePosition,
  nextPage,
} from "./pagination";
const secret = "pagination-secret-32-characters-long";
beforeEach(() => vi.stubEnv("TOGETHER_TOKEN_SECRET", secret));
afterEach(() => vi.unstubAllEnvs());
it("cryptographically binds payload, actor, query and expiry; refuses altered cursors", () => {
  const id = randomUUID();
  const cursor = nextPage("actor", "query", id);
  expect(pagePosition("actor", "query", cursor)).toBe(id);
  for (const invalid of [
    cursor + "x",
    cursor + ".extra",
    cursor.split(".")[0] + ".x",
    encodeCursor(null),
    encodeCursor([]),
  ])
    expect(() => pagePosition("actor", "query", invalid)).toThrow();
  expect(() => pagePosition("other", "query", cursor)).toThrow();
  expect(() => pagePosition("actor", "other", cursor)).toThrow();
  const payload = decodeCursor(cursor);
  payload.expires = 0;
  expect(() => pagePosition("actor", "query", encodeCursor(payload))).toThrow();
  const altered =
    Buffer.from(
      JSON.stringify({ ...payload, expires: Date.now() + 99999999 }),
    ).toString("base64url") +
    "." +
    cursor.split(".")[1];
  expect(() => decodeCursor(altered)).toThrow();
  const broken = Buffer.from("not-json").toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`cursor:${broken}`)
    .digest("base64url");
  expect(() => decodeCursor(`${broken}.${signature}`)).toThrow();
  vi.stubEnv("TOGETHER_TOKEN_SECRET", "");
  expect(() => nextPage("actor", "query", id)).toThrow();
});

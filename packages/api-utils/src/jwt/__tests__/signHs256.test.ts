import { jwtVerify, decodeProtectedHeader } from "jose";
import { signHs256Jwt } from "../signHs256";

const SECRET = "test-secret-not-real-0123456789abcdef";
const key = new TextEncoder().encode(SECRET);

describe("signHs256Jwt", () => {
  it("signs a token the same secret verifies, with iat and exp", async () => {
    const issuedAt = new Date("2026-11-25T10:00:00Z");
    const expiresAt = new Date("2026-11-26T10:00:00Z");
    const token = await signHs256Jwt({ user_id: "u-1" }, SECRET, {
      issuedAt,
      expiresAt,
    });
    expect(decodeProtectedHeader(token)).toEqual({ alg: "HS256", typ: "JWT" });
    const { payload } = await jwtVerify(token, key, {
      currentDate: new Date("2026-11-25T12:00:00Z"),
    });
    expect(payload).toEqual({
      user_id: "u-1",
      iat: issuedAt.getTime() / 1000,
      exp: expiresAt.getTime() / 1000,
    });
  });

  it("omits iat and exp when not asked for (a server token)", async () => {
    const token = await signHs256Jwt({ server: true }, SECRET);
    const { payload } = await jwtVerify(token, key);
    expect(payload).toEqual({ server: true });
  });

  it("a different secret does not verify", async () => {
    const token = await signHs256Jwt({ server: true }, SECRET);
    await expect(
      jwtVerify(token, new TextEncoder().encode("another-secret-value-000")),
    ).rejects.toThrow();
  });

  it("refuses an empty secret", async () => {
    await expect(signHs256Jwt({ server: true }, "")).rejects.toThrow(
      /needs a secret/,
    );
  });
});

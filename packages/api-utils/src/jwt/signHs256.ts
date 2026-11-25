import { SignJWT, type JWTPayload } from "jose";

/**
 * Sign a compact HS256 JWT with a shared secret (PER-120: Stream chat user and
 * server tokens). `expiresAt` is optional: Stream's server token carries no
 * expiry, while a user token does.
 */
export async function signHs256Jwt(
  payload: JWTPayload,
  secret: string,
  options: { issuedAt?: Date; expiresAt?: Date } = {},
): Promise<string> {
  if (!secret) throw new Error("signHs256Jwt needs a secret");
  let jwt = new SignJWT(payload).setProtectedHeader({
    alg: "HS256",
    typ: "JWT",
  });
  if (options.issuedAt) {
    jwt = jwt.setIssuedAt(Math.floor(options.issuedAt.getTime() / 1000));
  }
  if (options.expiresAt) {
    jwt = jwt.setExpirationTime(Math.floor(options.expiresAt.getTime() / 1000));
  }
  return jwt.sign(new TextEncoder().encode(secret));
}

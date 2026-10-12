# together-crypto

Local Expo module exposing native Ed25519, X25519 and SHA-256 to the Together
adapters through `src/adapters/together/security/cryptoBackend.ts`. iOS uses
CryptoKit (`Curve25519.Signing`, `Curve25519.KeyAgreement`, `SHA256`); Android
uses BouncyCastle `bcprov-jdk18on` (`Ed25519`, `X25519Agreement`) and
`MessageDigest`. All functions are synchronous and write into caller-supplied
typed arrays. The JS side installs this backend only after a verify-based
self-test against the checked-in wire vector; otherwise `@noble/*` remains in
use. See design decision D16 in `specs/34-train-together/design.md`.

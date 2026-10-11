# Together crypto hot path — F1 verify-once + F9 native Curve25519 (PER-64)

Scope decision: [D16](../../34-train-together/design.md) · Issue:
[PER-64](https://linear.app/evans-software-solutions/issue/PER-64) · Evidence:
[PER-20 Hermes probe](./evidence/perf-2026-10-11-hermes-probe/README.md) and the
[performance audit](https://linear.app/evans-software-solutions/document/together-performance-audit-implementation-and-performance-pass-11-0742b327c246).

## Why both, together

On a Release Hermes build the host spends ≈8 s of pure crypto per logged set at
four participants (56 roster verifications × ≈137 ms) and ≈2.3 s at two. F1 cuts
the count to about N+3 signatures per set; F9 cuts each signature from ≈13 ms to
well under a millisecond. F1 alone leaves 70–300 ms of JS-thread stalls per set on
phones; F9 alone leaves hundreds of native calls per set. Land both in one slice
and re-measure once.

## Deliverables

1. `packages/mobile/src/adapters/together/security/cryptoBackend.ts` — backend
   interface, `nobleCryptoBackend`, `createNativeCryptoBackend`,
   `cryptoBackendSelfTest`, `installCryptoBackend`, `getCryptoBackend`,
   `installNativeTogetherCrypto`.
2. `identity.ts`, `sharedSession.ts` (`key()`), `security/channel.ts` (`derive()`)
   call the backend instead of `@noble` directly. No wire or API change.
3. `packages/mobile/modules/together-crypto/` — Expo module `TogetherCrypto`:
   `ed25519PublicKey(seed, out32)`, `ed25519Sign(seed, message, out64)`,
   `ed25519Verify(signature, message, publicKey): boolean`,
   `x25519SharedSecret(secret, publicKey, out32)`, `sha256(data, out32)`.
   iOS: CryptoKit `Curve25519.Signing`, `Curve25519.KeyAgreement`, `SHA256`.
   Android: BouncyCastle `Ed25519Signer`/`Ed25519`, `X25519Agreement`,
   `MessageDigest`. Synchronous `Function`s; length-checked; no events.
4. F1 caches in `localStore.ts`, `localLobby.ts`, `sharedSession.ts` as D16.
5. Composition: `installNativeTogetherCrypto()` from
   `createTogetherProvisioning`, `createTogetherLobby`, `createTogetherCloud`
   (idempotent) and from the hidden probe route, which also reports the backend.
6. Tests (real crypto, `node:sqlite`): backend routing and self-test fallback;
   verification counts (spy on `verifyRoster`) and SQL counts (counting adapter)
   for repeated `member()`, `getSnapshot()`, send/accept; re-verification on new
   revision, denied-pair change, expiry crossing, closure; key cache zeroed on
   dispose/roster change; existing suites unchanged.

## Acceptance

- Sender ≤ N+3 verifications and receiver ≤ 3 per logged set with no roster
  change; `getSnapshot()` unchanged → 0 SQL, 0 verifications.
- All existing Together suites pass unchanged; changed runtime files ≥ 90% in
  every coverage metric.
- Probe on a Release build shows `cryptoBackend: "native"` and ed25519 verify,
  key derivation and `verifyRoster(4)` each at least 10× faster than the 11
  October simulator figures; the noble fallback still runs when the module is
  absent.
- `bun run prettier:check`, `typecheck`, `lint`, `test:unit` green.

## Constraints

- No redesign of the protocol; no change to envelope formats or verification
  rules. Native verify must be at least as strict as noble (`zip215: false`).
- Never assume deterministic signatures.
- Native build, TestFlight and release stay Brad-owned; this brief authorises
  code and the local simulator Release verification only.
- Android: BouncyCastle is the one new native dependency; record its version.

## Device proof after landing

Release build → sign in → `persistencemobile-staging://together-probe` → three
runs, discard the first → paste JSON into PER-20 and PER-64; then the PER-20
timing-stamp matrix on two and four phones.

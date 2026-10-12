# Hermes crypto probe — 11 October 2026 (PER-20, audit finding F9)

Shared JSON reports from the hidden `together-probe` route
(`src/diagnostics/together/cryptoProbe.ts`) on a **Release** staging
build (`APP_VARIANT=staging`, Hermes 0.14.1, concurrent GC, `__DEV__` false)
running on the iPhone 17 simulator, iOS 27.0, Xcode 27.0, Apple Silicon Mac.
Run 1 was discarded as warm-up; runs 2 and 3 are kept. The simulator runs
Hermes on the Mac CPU, so these are an **optimistic lower bound** for a phone.
`desktop-mac-bun-jsc.json` is the same probe run under Bun 1.4.3 (JavaScriptCore
JIT) on the same Mac, for a same-hardware JIT-versus-Hermes comparison.

Audit: https://linear.app/evans-software-solutions/document/together-performance-audit-implementation-and-performance-pass-11-0742b327c246

| Benchmark                           | Audit desktop (Linux, bun/JSC) | This Mac, bun/JSC | Simulator Hermes run 2 | run 3      | Hermes ÷ audit | Hermes ÷ same-Mac JIT |
| ----------------------------------- | ------------------------------ | ----------------- | ---------------------- | ---------- | -------------- | --------------------- |
| ed25519.sign                        | 1.01 ms                        | 0.14–0.23 ms      | 5.586 ms               | 5.667 ms   | 5.6×           | ≈30×                  |
| ed25519.verify                      | 1.00 ms                        | 0.25–0.33 ms      | 13.465 ms              | 13.377 ms  | 13.4×          | ≈46×                  |
| x25519+sha256 key derivation        | 0.82 ms                        | 0.26 ms           | 11.221 ms              | 11.308 ms  | 13.7×          | ≈43×                  |
| chacha20poly1305 encrypt 2 KB       | 0.11 ms                        | 0.012–0.016 ms    | 0.774 ms               | 0.770 ms   | 7.0×           | ≈55×                  |
| requestHash(4-member roster)        | 0.11 ms                        | 0.03 ms           | 2.614 ms               | 2.634 ms   | 23.9×          | ≈80×                  |
| verifyRoster(4 members, 9 verifies) | 8.15 ms                        | 3.0–3.2 ms        | 135.660 ms             | 137.956 ms | 16.8×          | ≈44×                  |
| verifyRoster(2 members)             | —                              | 1.6–1.8 ms        | 80.852 ms              | 81.796 ms  | —              | ≈48×                  |
| JSON clone 20 KB                    | —                              | 0.03 ms           | 0.257 ms               | 0.291 ms   | —              | ≈9×                   |
| SQLite read-all + parse 4 rows      | —                              | 0.02–0.04 ms      | 0.133 ms               | 0.179 ms   | —              | ≈5×                   |

Projected per-set crypto (audit operation counts × measured Hermes unit costs):

| Participants | Sender (run 2 / run 3) | Receiver (run 2 / run 3) |
| ------------ | ---------------------- | ------------------------ |
| 4            | 7,772 / 7,902 ms       | 2,603 / 2,647 ms         |
| 2            | 2,333 / 2,361 ms       | 1,562 / 1,580 ms         |

Verdict: the Hermes multiplier is far above the audit's 3× threshold on every
crypto primitive (5.6× to 24×, 16.8× on `verifyRoster`), so F9 (native
ed25519/x25519 behind the `identity.ts` API) is required in addition to F1
(verify once per roster revision). Even with F1 reducing a set to ≈N+3
signatures, one ed25519 verify costs ≈13 ms and one key derivation ≈11 ms on
Hermes before any phone slowdown.

Not measured: a physical iPhone (no code-signing identity on this Mac) and
Android.

## After D16 (F1 + F9), same simulator, same evening — native backend

Build `ea27a0e1` with the `TogetherCrypto` module installed after its self-test
(`cryptoBackend: "native"` in the reports). Three runs, first discarded;
`simulator-iphone17-ios27-native-run2.json` and `-run3.json` are kept.

| Benchmark                           | Audit desktop | Hermes noble (runs 2–3) | Hermes native (runs 2–3) | Native speed-up over noble | Native ÷ audit |
| ----------------------------------- | ------------- | ----------------------- | ------------------------ | -------------------------- | -------------- |
| ed25519.sign                        | 1.01 ms       | 5.586 / 5.667 ms        | 0.071 / 0.057 ms         | 88×                        | 0.06×          |
| ed25519.verify                      | 1.00 ms       | 13.465 / 13.377 ms      | 0.040 / 0.035 ms         | 356×                       | 0.04×          |
| x25519+sha256 key derivation        | 0.82 ms       | 11.221 / 11.308 ms      | 1.307 / 1.329 ms         | 9×                         | 1.61×          |
| chacha20poly1305 2 KB               | 0.11 ms       | 0.774 / 0.770 ms        | 0.770 / 0.764 ms         | 1× (still noble)           | 6.97×          |
| requestHash(4-member roster)        | 0.11 ms       | 2.614 / 2.634 ms        | 0.259 / 0.265 ms         | 10×                        | 2.38×          |
| verifyRoster(4 members, 9 verifies) | 8.15 ms       | 135.660 / 137.956 ms    | 1.686 / 1.679 ms         | 81×                        | 0.21×          |
| verifyRoster(2 members)             | —             | 80.852 / 81.796 ms      | 0.969 / 0.970 ms         | 84×                        | —              |
| JSON clone 20 KB                    | —             | 0.257 / 0.291 ms        | 0.258 / 0.256 ms         | 1×                         | —              |
| SQLite read-all + parse 4 rows      | —             | 0.133 / 0.179 ms        | 0.141 / 0.138 ms         | 1×                         | —              |

Projected per-set crypto with the audit's **pre-F1** operation counts:
4 participants sender 114 ms / receiver 34 ms (was 7.8–7.9 s / 2.6 s);
2 participants sender 34 ms / receiver 21 ms (was 2.3 s / 1.6 s). F1 cuts the
counts further (≤ N+3 sender verifications, ≤ 3 per receiver, 0 on unchanged
reads), so the real per-set crypto is now a few tens of milliseconds.

Remaining JavaScript costs: the Ed25519→X25519 Montgomery conversions inside key
derivation (≈1.2 ms, now once per peer thanks to the key cache), the canonical
JSON in `requestHash` (≈0.25 ms) and ChaCha20-Poly1305 (0.77 ms per 2 KB, nine
seals per set at four participants ≈ 7 ms). None blocks AC4; AEAD can move to
native later if device profiling shows it.

Not yet measured: physical iPhone (signing) and Android (BouncyCastle path).

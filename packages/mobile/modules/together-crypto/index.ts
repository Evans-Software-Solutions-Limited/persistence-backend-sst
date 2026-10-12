import { requireOptionalNativeModule } from "expo";
import type { TogetherCryptoNativeModule } from "@/adapters/together/security/cryptoBackend";

export type { TogetherCryptoNativeModule };

/**
 * Native Curve25519 and SHA-256 for the Together hot path (D16 / PER-64 F9).
 * Synchronous, length-checked, output-buffer functions; no identity or policy
 * lives here. Absent on old builds and Expo Go, in which case the pure-JS
 * `@noble` backend stays installed. Installation happens only after
 * `cryptoBackendSelfTest` passes (see `security/cryptoBackend.ts`).
 */
export const togetherCryptoNative =
  requireOptionalNativeModule<TogetherCryptoNativeModule>("TogetherCrypto");

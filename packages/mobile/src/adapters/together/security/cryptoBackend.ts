/**
 * Single seam for the Together crypto primitives (D16 / PER-64 F9).
 *
 * `@noble/*` is the default and the Jest implementation. A native backend
 * (`modules/together-crypto`: CryptoKit on iOS, BouncyCastle on Android) is
 * installed only after `cryptoBackendSelfTest` passes against the checked-in
 * wire vector and the noble reference. Nothing in the protocol assumes
 * deterministic signatures: retries resend stored envelopes and idempotency
 * compares stored envelopes or payload hashes.
 */
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { decode64 } from "./encoding";

export type CryptoBackendName = "noble" | "native";

export interface TogetherCryptoBackend {
  readonly name: CryptoBackendName;
  ed25519PublicKey(seed: Uint8Array): Uint8Array;
  ed25519Sign(message: Uint8Array, seed: Uint8Array): Uint8Array;
  /** Strict verification: malformed input or S >= L must return false, never throw. */
  ed25519Verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): boolean;
  x25519SharedSecret(secret: Uint8Array, publicKey: Uint8Array): Uint8Array;
  sha256(data: Uint8Array): Uint8Array;
}

/** Output-buffer shape of the `TogetherCrypto` Expo module (synchronous functions). */
export interface TogetherCryptoNativeModule {
  ed25519PublicKey(seed: Uint8Array, out: Uint8Array): void;
  ed25519Sign(seed: Uint8Array, message: Uint8Array, out: Uint8Array): void;
  ed25519Verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): boolean;
  x25519SharedSecret(
    secret: Uint8Array,
    publicKey: Uint8Array,
    out: Uint8Array,
  ): void;
  sha256(data: Uint8Array, out: Uint8Array): void;
}

export const nobleCryptoBackend: TogetherCryptoBackend = {
  name: "noble",
  ed25519PublicKey: (seed) => ed25519.getPublicKey(seed),
  ed25519Sign: (message, seed) => ed25519.sign(message, seed),
  ed25519Verify: (signature, message, publicKey) => {
    try {
      return ed25519.verify(signature, message, publicKey, { zip215: false });
    } catch {
      return false;
    }
  },
  x25519SharedSecret: (secret, publicKey) =>
    x25519.getSharedSecret(secret, publicKey),
  sha256: (data) => nobleSha256(data),
};

function sized(value: Uint8Array, length: number, what: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length)
    throw new Error(`INVALID_${what}`);
  return value;
}

/** Wrap the native module; every call is length-checked before crossing the bridge. */
export function createNativeCryptoBackend(
  native: TogetherCryptoNativeModule,
): TogetherCryptoBackend {
  return {
    name: "native",
    ed25519PublicKey: (seed) => {
      const out = new Uint8Array(32);
      native.ed25519PublicKey(sized(seed, 32, "SEED"), out);
      return out;
    },
    ed25519Sign: (message, seed) => {
      const out = new Uint8Array(64);
      native.ed25519Sign(sized(seed, 32, "SEED"), message, out);
      return out;
    },
    ed25519Verify: (signature, message, publicKey) => {
      if (
        !(signature instanceof Uint8Array) ||
        signature.length !== 64 ||
        !(publicKey instanceof Uint8Array) ||
        publicKey.length !== 32 ||
        !(message instanceof Uint8Array)
      )
        return false;
      try {
        return native.ed25519Verify(signature, message, publicKey) === true;
      } catch {
        return false;
      }
    },
    x25519SharedSecret: (secret, publicKey) => {
      const out = new Uint8Array(32);
      native.x25519SharedSecret(
        sized(secret, 32, "SECRET"),
        sized(publicKey, 32, "PUBLIC_KEY"),
        out,
      );
      return out;
    },
    sha256: (data) => {
      const out = new Uint8Array(32);
      native.sha256(data, out);
      return out;
    },
  };
}

/** Public test-only vector shared with the backend (offline-wire-vector.json). */
const VECTOR = {
  seed: new Uint8Array(32).fill(0x11),
  publicKeyB64: "MCowBQYDK2VwAyEA0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc=",
  preimage:
    "persistence-together-signature-v1:89199a0e9ad42f521acebc10b5a1ec10f6b33bc2ce55e199a9b047de80d89850",
  signature:
    "bLkKJ01onqKulLnOD5S64wizNjWH9mIc-MqxX0AwBFobqVrSktkAAvSem4DcDA1fhUCXX_Jf2owzEQsqh5QCAQ",
};
const SHA256_ABC =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Verify-based conformance check. Signatures are compared by verification in
 * both directions, never by bytes, because native signers may be randomized.
 */
export function cryptoBackendSelfTest(
  candidate: TogetherCryptoBackend,
  reference: TogetherCryptoBackend = nobleCryptoBackend,
): boolean {
  try {
    const encoder = new TextEncoder();
    const message = encoder.encode(VECTOR.preimage);
    const publicKey = decode64(VECTOR.publicKeyB64).slice(12);
    const vectorSignature = decode64(VECTOR.signature, true);
    if (!equal(candidate.ed25519PublicKey(VECTOR.seed), publicKey))
      return false;
    if (!candidate.ed25519Verify(vectorSignature, message, publicKey))
      return false;
    const fromCandidate = candidate.ed25519Sign(message, VECTOR.seed);
    if (
      fromCandidate.length !== 64 ||
      !reference.ed25519Verify(fromCandidate, message, publicKey) ||
      !candidate.ed25519Verify(fromCandidate, message, publicKey)
    )
      return false;
    const fromReference = reference.ed25519Sign(message, VECTOR.seed);
    if (!candidate.ed25519Verify(fromReference, message, publicKey))
      return false;
    const tampered = vectorSignature.slice();
    tampered[10] ^= 0x01;
    const otherMessage = encoder.encode(`${VECTOR.preimage}x`);
    if (
      candidate.ed25519Verify(tampered, message, publicKey) ||
      candidate.ed25519Verify(vectorSignature, otherMessage, publicKey) ||
      candidate.ed25519Verify(vectorSignature.slice(0, 63), message, publicKey)
    )
      return false;
    // S >= L must be rejected (non-canonical scalar: add the group order to S).
    const malleable = vectorSignature.slice();
    const L = [
      0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2,
      0xde, 0xf9, 0xde, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
    ];
    let carry = 0;
    for (let i = 0; i < 32; i++) {
      const sum = malleable[32 + i] + L[i] + carry;
      malleable[32 + i] = sum & 0xff;
      carry = sum >> 8;
    }
    if (carry === 0 && candidate.ed25519Verify(malleable, message, publicKey))
      return false;
    const secretA = ed25519.utils.toMontgomerySecret(
      new Uint8Array(32).fill(5),
    );
    const publicB = ed25519.utils.toMontgomery(
      ed25519.getPublicKey(new Uint8Array(32).fill(9)),
    );
    if (
      !equal(
        candidate.x25519SharedSecret(secretA, publicB),
        reference.x25519SharedSecret(secretA, publicB),
      )
    )
      return false;
    if (bytesToHex(candidate.sha256(encoder.encode("abc"))) !== SHA256_ABC)
      return false;
    return true;
  } catch {
    return false;
  }
}

let active: TogetherCryptoBackend = nobleCryptoBackend;

export function installCryptoBackend(
  backend: TogetherCryptoBackend | null,
): void {
  active = backend ?? nobleCryptoBackend;
}

export function getCryptoBackend(): TogetherCryptoBackend {
  return active;
}

let installed: CryptoBackendName | undefined;

/**
 * Install the native backend when the module is present and conformant.
 * Idempotent; the first result is reused. Pass a loader to override the module
 * lookup (tests) or `{ force: true }` to re-evaluate after a failure.
 */
export function installNativeTogetherCrypto(
  load: () => TogetherCryptoNativeModule | null = defaultLoader,
  options: { force?: boolean } = {},
): CryptoBackendName {
  if (installed && !options.force) return installed;
  let result: CryptoBackendName = "noble";
  try {
    const native = load();
    if (native) {
      const candidate = createNativeCryptoBackend(native);
      if (cryptoBackendSelfTest(candidate)) {
        installCryptoBackend(candidate);
        result = "native";
      }
    }
  } catch {
    result = "noble";
  }
  if (result === "noble") installCryptoBackend(null);
  installed = result;
  return result;
}

/** Test hook: forget the memoised installation decision. */
export function resetNativeTogetherCrypto(): void {
  installed = undefined;
  installCryptoBackend(null);
}

/* eslint-disable @typescript-eslint/no-require-imports -- optional native module, same pattern as the other Together modules. */
function defaultLoader(): TogetherCryptoNativeModule | null {
  const { togetherCryptoNative } =
    require("../../../../modules/together-crypto") as typeof import("../../../../modules/together-crypto");
  return togetherCryptoNative;
}
/* eslint-enable @typescript-eslint/no-require-imports */

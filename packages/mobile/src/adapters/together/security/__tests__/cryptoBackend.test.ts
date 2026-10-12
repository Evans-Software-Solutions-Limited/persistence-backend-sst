/** @jest-environment node */
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import vector from "./offline-wire-vector.json";
import {
  createNativeCryptoBackend,
  cryptoBackendSelfTest,
  getCryptoBackend,
  installCryptoBackend,
  installNativeTogetherCrypto,
  nobleCryptoBackend,
  resetNativeTogetherCrypto,
  type TogetherCryptoNativeModule,
} from "../cryptoBackend";
import { publicKeyPem, signPayload, verifySignature } from "../identity";
import { decode64 } from "../encoding";

/** A conformant fake native module implemented over noble into output buffers. */
function fakeNative(
  overrides: Partial<TogetherCryptoNativeModule> = {},
): TogetherCryptoNativeModule & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  return {
    calls,
    ed25519PublicKey: (seed, out) => {
      count("ed25519PublicKey");
      out.set(ed25519.getPublicKey(seed));
    },
    ed25519Sign: (seed, message, out) => {
      count("ed25519Sign");
      out.set(ed25519.sign(message, seed));
    },
    ed25519Verify: (signature, message, publicKey) => {
      count("ed25519Verify");
      try {
        return ed25519.verify(signature, message, publicKey, { zip215: false });
      } catch {
        return false;
      }
    },
    x25519SharedSecret: (secret, publicKey, out) => {
      count("x25519SharedSecret");
      out.set(x25519.getSharedSecret(secret, publicKey));
    },
    sha256: (data, out) => {
      count("sha256");
      out.set(sha256(data));
    },
    ...overrides,
  };
}

const L = [
  0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde,
  0xf9, 0xde, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
];
function plusL(signature: Uint8Array): Uint8Array {
  const out = signature.slice();
  let carry = 0;
  for (let i = 0; i < 32; i++) {
    const sum = out[32 + i] + L[i] + carry;
    out[32 + i] = sum & 0xff;
    carry = sum >> 8;
  }
  return out;
}

afterEach(() => resetNativeTogetherCrypto());

describe("Together crypto backend seam (D16 / F9)", () => {
  it("defaults to noble, which passes its own self-test and the wire vector", () => {
    expect(getCryptoBackend().name).toBe("noble");
    expect(cryptoBackendSelfTest(nobleCryptoBackend)).toBe(true);
    const seed = new Uint8Array(32).fill(0x11);
    expect(publicKeyPem(seed)).toBe(vector.publicKey);
    expect(signPayload(vector.envelope.payload, seed)).toEqual(vector.envelope);
  });

  it("installs a conformant native module and routes identity operations through it", () => {
    const native = fakeNative();
    expect(installNativeTogetherCrypto(() => native)).toBe("native");
    expect(getCryptoBackend().name).toBe("native");
    const before = { ...native.calls };
    const seed = new Uint8Array(32).fill(0x11);
    expect(publicKeyPem(seed)).toBe(vector.publicKey);
    const signed = signPayload(vector.envelope.payload, seed);
    expect(verifySignature(signed, vector.publicKey)).toEqual(
      vector.envelope.payload,
    );
    expect(verifySignature(vector.envelope, vector.publicKey)).toEqual(
      vector.envelope.payload,
    );
    expect(native.calls.ed25519Sign).toBe((before.ed25519Sign ?? 0) + 1);
    expect(native.calls.ed25519Verify).toBe((before.ed25519Verify ?? 0) + 2);
    expect(native.calls.ed25519PublicKey).toBe(
      (before.ed25519PublicKey ?? 0) + 1,
    );
    // requestHash runs through the backend's sha256 on every sign/verify.
    expect(native.calls.sha256).toBeGreaterThan(before.sha256 ?? 0);
    expect(() =>
      verifySignature(
        { ...signed, signature: signed.signature.replace(/.$/, "A") },
        vector.publicKey,
      ),
    ).toThrow("INVALID_PROOF");
    // Installation is memoised; a later call does not re-run the loader.
    const loader = jest.fn(() => native);
    expect(installNativeTogetherCrypto(loader)).toBe("native");
    expect(loader).not.toHaveBeenCalled();
    expect(installNativeTogetherCrypto(loader, { force: true })).toBe("native");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("falls back to noble when the module is absent, throws, or fails conformance", () => {
    expect(installNativeTogetherCrypto(() => null)).toBe("noble");
    expect(getCryptoBackend()).toBe(nobleCryptoBackend);
    resetNativeTogetherCrypto();
    expect(
      installNativeTogetherCrypto(() => {
        throw new Error("no native");
      }),
    ).toBe("noble");
    resetNativeTogetherCrypto();
    // Wrong public key derivation.
    expect(
      installNativeTogetherCrypto(() =>
        fakeNative({
          ed25519PublicKey: (_seed, out) => out.fill(7),
        }),
      ),
    ).toBe("noble");
    resetNativeTogetherCrypto();
    // A verifier that accepts everything fails the tamper checks.
    expect(
      installNativeTogetherCrypto(() =>
        fakeNative({ ed25519Verify: () => true }),
      ),
    ).toBe("noble");
    resetNativeTogetherCrypto();
    // A verifier that accepts a non-canonical S (S + L) is rejected.
    const vectorSig = decode64(vector.envelope.signature, true);
    const malleable = plusL(vectorSig);
    expect(
      installNativeTogetherCrypto(() =>
        fakeNative({
          ed25519Verify: (signature, message, publicKey) => {
            if (signature.every((v, i) => v === malleable[i])) return true;
            try {
              return ed25519.verify(signature, message, publicKey, {
                zip215: false,
              });
            } catch {
              return false;
            }
          },
        }),
      ),
    ).toBe("noble");
    resetNativeTogetherCrypto();
    // Wrong shared secret or digest.
    expect(
      installNativeTogetherCrypto(() =>
        fakeNative({ x25519SharedSecret: (_s, _p, out) => out.fill(1) }),
      ),
    ).toBe("noble");
    resetNativeTogetherCrypto();
    expect(
      installNativeTogetherCrypto(() =>
        fakeNative({ sha256: (_d, out) => out.fill(1) }),
      ),
    ).toBe("noble");
    // Signatures the candidate produces must verify with the reference.
    resetNativeTogetherCrypto();
    expect(
      installNativeTogetherCrypto(() =>
        fakeNative({ ed25519Sign: (_s, _m, out) => out.fill(3) }),
      ),
    ).toBe("noble");
    expect(getCryptoBackend().name).toBe("noble");
  });

  it("length-checks every native call and never throws from verify", () => {
    const native = fakeNative();
    const backend = createNativeCryptoBackend(native);
    expect(() => backend.ed25519PublicKey(new Uint8Array(31))).toThrow(
      "INVALID_SEED",
    );
    expect(() =>
      backend.ed25519Sign(new Uint8Array(3), new Uint8Array(33)),
    ).toThrow("INVALID_SEED");
    expect(() =>
      backend.x25519SharedSecret(new Uint8Array(32), new Uint8Array(31)),
    ).toThrow("INVALID_PUBLIC_KEY");
    expect(
      backend.ed25519Verify(
        new Uint8Array(63),
        new Uint8Array(1),
        new Uint8Array(32),
      ),
    ).toBe(false);
    expect(
      backend.ed25519Verify(
        new Uint8Array(64),
        new Uint8Array(1),
        new Uint8Array(31),
      ),
    ).toBe(false);
    expect(native.calls.ed25519Verify).toBeUndefined();
    const throwing = createNativeCryptoBackend(
      fakeNative({
        ed25519Verify: () => {
          throw new Error("native failure");
        },
      }),
    );
    expect(
      throwing.ed25519Verify(
        new Uint8Array(64),
        new Uint8Array(1),
        new Uint8Array(32),
      ),
    ).toBe(false);
    expect(backend.sha256(new TextEncoder().encode("abc"))).toEqual(
      sha256(new TextEncoder().encode("abc")),
    );
    // Noble's verify also swallows malformed input instead of throwing.
    expect(
      nobleCryptoBackend.ed25519Verify(
        new Uint8Array(64),
        new Uint8Array(1),
        new Uint8Array(32),
      ),
    ).toBe(false);
  });

  it("uses the optional native module lookup by default and stays on noble under Jest", () => {
    expect(installNativeTogetherCrypto()).toBe("noble");
    installCryptoBackend(null);
    expect(getCryptoBackend()).toBe(nobleCryptoBackend);
  });
});

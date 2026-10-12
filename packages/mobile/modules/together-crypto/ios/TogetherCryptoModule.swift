import CryptoKit
import ExpoModulesCore
import Foundation

/// Native Curve25519 and SHA-256 for the Together hot path. No identity or
/// policy here; `security/cryptoBackend.ts` self-tests this module before use.
public final class TogetherCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TogetherCrypto")

    Function("ed25519PublicKey") { (seed: Uint8Array, out: Uint8Array) throws in
      try Self.expect(seed, 32, "seed")
      try Self.expect(out, 32, "out")
      let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Self.data(seed))
      Self.write(key.publicKey.rawRepresentation, to: out)
    }

    Function("ed25519Sign") { (seed: Uint8Array, message: Uint8Array, out: Uint8Array) throws in
      try Self.expect(seed, 32, "seed")
      try Self.expect(out, 64, "out")
      let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Self.data(seed))
      let signature = try key.signature(for: Self.data(message))
      guard signature.count == 64 else { throw CryptoArgumentException("signature") }
      Self.write(signature, to: out)
    }

    Function("ed25519Verify") { (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) -> Bool in
      guard signature.byteLength == 64, publicKey.byteLength == 32 else { return false }
      guard let key = try? Curve25519.Signing.PublicKey(rawRepresentation: Self.data(publicKey)) else {
        return false
      }
      return key.isValidSignature(Self.data(signature), for: Self.data(message))
    }

    Function("x25519SharedSecret") { (secret: Uint8Array, publicKey: Uint8Array, out: Uint8Array) throws in
      try Self.expect(secret, 32, "secret")
      try Self.expect(publicKey, 32, "publicKey")
      try Self.expect(out, 32, "out")
      let priv = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Self.data(secret))
      let pub = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: Self.data(publicKey))
      let shared = try priv.sharedSecretFromKeyAgreement(with: pub)
      let bytes = shared.withUnsafeBytes { Data($0) }
      guard bytes.count == 32 else { throw CryptoArgumentException("sharedSecret") }
      Self.write(bytes, to: out)
    }

    Function("sha256") { (data: Uint8Array, out: Uint8Array) throws in
      try Self.expect(out, 32, "out")
      let digest = SHA256.hash(data: Self.data(data))
      Self.write(Data(digest), to: out)
    }
  }

  private static func expect(_ array: Uint8Array, _ length: Int, _ name: String) throws {
    guard array.byteLength == length else { throw CryptoArgumentException(name) }
  }

  private static func data(_ array: Uint8Array) -> Data {
    Data(bytes: array.rawPointer, count: array.byteLength)
  }

  private static func write(_ data: Data, to array: Uint8Array) {
    data.withUnsafeBytes { source in
      guard let base = source.baseAddress else { return }
      array.rawPointer.copyMemory(from: base, byteCount: min(data.count, array.byteLength))
    }
  }
}

private final class CryptoArgumentException: GenericException<String> {
  override var reason: String {
    "Invalid TogetherCrypto argument: \(param)"
  }
}

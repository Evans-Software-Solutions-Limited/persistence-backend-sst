package expo.modules.togethercrypto

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.Uint8Array
import java.security.MessageDigest
import org.bouncycastle.crypto.agreement.X25519Agreement
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.bouncycastle.math.ec.rfc8032.Ed25519

/** Native Curve25519 and SHA-256 for the Together hot path; no identity or policy here. */
class TogetherCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TogetherCrypto")

    Function("ed25519PublicKey") { seed: Uint8Array, out: Uint8Array ->
      expect(seed, 32, "seed")
      expect(out, 32, "out")
      val key = Ed25519PrivateKeyParameters(bytes(seed), 0)
      write(key.generatePublicKey().encoded, out)
    }

    Function("ed25519Sign") { seed: Uint8Array, message: Uint8Array, out: Uint8Array ->
      expect(seed, 32, "seed")
      expect(out, 64, "out")
      val signer = Ed25519Signer()
      signer.init(true, Ed25519PrivateKeyParameters(bytes(seed), 0))
      val data = bytes(message)
      signer.update(data, 0, data.size)
      val signature = signer.generateSignature()
      if (signature.size != 64) throw InvalidArgumentException("signature")
      write(signature, out)
    }

    Function("ed25519Verify") { signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array ->
      if (signature.byteLength != 64 || publicKey.byteLength != 32) return@Function false
      val data = bytes(message)
      try {
        // Strict RFC 8032: rejects S >= L and non-canonical point encodings.
        Ed25519.verify(bytes(signature), 0, bytes(publicKey), 0, data, 0, data.size)
      } catch (_: Throwable) {
        false
      }
    }

    Function("x25519SharedSecret") { secret: Uint8Array, publicKey: Uint8Array, out: Uint8Array ->
      expect(secret, 32, "secret")
      expect(publicKey, 32, "publicKey")
      expect(out, 32, "out")
      val agreement = X25519Agreement()
      agreement.init(X25519PrivateKeyParameters(bytes(secret), 0))
      val shared = ByteArray(agreement.agreementSize)
      agreement.calculateAgreement(X25519PublicKeyParameters(bytes(publicKey), 0), shared, 0)
      write(shared, out)
    }

    Function("sha256") { data: Uint8Array, out: Uint8Array ->
      expect(out, 32, "out")
      write(MessageDigest.getInstance("SHA-256").digest(bytes(data)), out)
    }
  }

  private fun expect(array: Uint8Array, length: Int, name: String) {
    if (array.byteLength != length) throw InvalidArgumentException(name)
  }

  private fun bytes(array: Uint8Array): ByteArray {
    val buffer = ByteArray(array.byteLength)
    array.read(buffer, 0, array.byteLength)
    return buffer
  }

  private fun write(data: ByteArray, out: Uint8Array) {
    out.write(data, 0, minOf(data.size, out.byteLength))
  }
}

private class InvalidArgumentException(name: String) :
  CodedException("ERR_TOGETHER_CRYPTO_ARGUMENT", "Invalid TogetherCrypto argument: $name", null)

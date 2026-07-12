import { describe, it, expect, vi } from "vitest";
import { decodeBase64, hasValidImageMagicBytes } from "../imageValidation";

describe("decodeBase64", () => {
  it("returns a Buffer for valid base64 input", () => {
    const b64 = Buffer.from([0xff, 0xd8, 0xff]).toString("base64");
    const result = decodeBase64(b64);
    expect(result).toBeInstanceOf(Buffer);
    expect(result?.equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
  });

  it("returns null when the decoded buffer is empty", () => {
    // A whitespace string is non-empty per the caller's t.String({minLength:1})
    // schema but decodes to zero bytes via Buffer.from(..., 'base64').
    expect(decodeBase64(" ")).toBeNull();
  });

  it("returns null when Buffer.from throws (defensive catch branch)", () => {
    const spy = vi.spyOn(Buffer, "from").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(decodeBase64("anything")).toBeNull();

    spy.mockRestore();
  });
});

describe("hasValidImageMagicBytes", () => {
  it("returns true for a buffer starting with the JPEG magic bytes", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    expect(hasValidImageMagicBytes(buf, "image/jpeg")).toBe(true);
  });

  it("returns false for a buffer NOT starting with the JPEG magic bytes", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(hasValidImageMagicBytes(buf, "image/jpeg")).toBe(false);
  });

  it("returns false when the buffer is shorter than the JPEG magic bytes", () => {
    const buf = Buffer.from([0xff, 0xd8]); // only 2 of 3 required bytes
    expect(hasValidImageMagicBytes(buf, "image/jpeg")).toBe(false);
  });

  it("returns true for a buffer starting with the full 8-byte PNG signature", () => {
    const buf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    expect(hasValidImageMagicBytes(buf, "image/png")).toBe(true);
  });

  it("returns false for a buffer NOT matching the PNG signature", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    expect(hasValidImageMagicBytes(buf, "image/png")).toBe(false);
  });

  it("returns false when the buffer is shorter than the 8-byte PNG signature", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // only 4 of 8 bytes
    expect(hasValidImageMagicBytes(buf, "image/png")).toBe(false);
  });
});

import { vi, type Mock } from "vitest";
import { jwtDecode } from "jwt-decode";
import { JWT, unpackJWT } from "../unpackJWT";

const mockStandardToken: JWT = {
  //   sub: "123456",
  //   exp: 9999999999,
  //   iss: "https://example.com/",
  //   iat: 999999999,
  //   email: "user@example.com",
  //   'custom:blc_old_uuid': "legacy-uuid",
  //   'custom:blc_old_id': "1234",
};

vi.mock("jwt-decode", () => ({
  jwtDecode: vi.fn(),
}));

describe("unpackJWT", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should correctly decode a standard JWT token", () => {
    (jwtDecode as Mock).mockReturnValue(mockStandardToken);

    const result = unpackJWT("standardTokenString");

    expect(result).toEqual(mockStandardToken);
  });

  it("should throw an error if jwt_decode throws an error", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    (jwtDecode as Mock).mockImplementation(() => {
      throw new Error("Invalid token");
    });

    expect(() => unpackJWT("invalidTokenString")).toThrow("Invalid token");

    consoleErrorSpy.mockRestore();
  });
});

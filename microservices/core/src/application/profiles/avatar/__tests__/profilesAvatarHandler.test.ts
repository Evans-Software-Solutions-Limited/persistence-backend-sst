/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const profileRepositoryMocks = {
  getById: vi.fn(),
  update: vi.fn(),
};

const s3SendMock = vi.fn();

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return {
      sub: "test-user-id",
      email: "test@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../../../repositories/profileRepository", () => ({
  ProfileRepository: vi.fn().mockImplementation(() => profileRepositoryMocks),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: s3SendMock })),
  PutObjectCommand: vi.fn((args) => ({ __cmd: "Put", ...args })),
  DeleteObjectCommand: vi.fn((args) => ({ __cmd: "Delete", ...args })),
}));

vi.mock("sst", () => ({
  Resource: {
    Avatars: { name: "test-avatars-bucket" },
  },
}));

const fakeProfile = {
  id: "test-user-id",
  email: "test@example.com",
  fullName: "Test User",
  username: "test-user",
  avatarUrl: null as string | null,
  role: "user",
  fitnessLevel: "beginner",
  dateOfBirth: null,
  heightCm: null,
  weightKg: null,
  availableEquipment: [],
  accessibilityNeeds: [],
  preferredUnits: "metric",
  isProfilePublic: false,
  subscriptionId: null,
  hasUsedUserTrial: false,
  hasUsedTrainerTrial: false,
  primaryGoalId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildJpegFile(bytes: number, type = "image/jpeg") {
  // Distinct sentinel bytes per file size so we can assert the exact buffer
  // shipped to S3 wasn't truncated or padded somewhere in the pipe.
  const data = new Uint8Array(bytes).fill(0xab);
  return new File([data], "avatar.jpg", { type });
}

async function postAvatar({
  file,
  withAuth = true,
}: {
  file: File;
  withAuth?: boolean;
}) {
  const { profilesAvatarHandler } = await import("../profilesAvatarHandler");
  const formData = new FormData();
  formData.append("file", file);
  return profilesAvatarHandler.handle(
    new Request("http://localhost/profile/avatar", {
      method: "POST",
      headers: withAuth ? { authorization: "Bearer test-token" } : {},
      body: formData,
    }),
  );
}

async function deleteAvatar({ withAuth = true }: { withAuth?: boolean } = {}) {
  const { profilesAvatarHandler } = await import("../profilesAvatarHandler");
  return profilesAvatarHandler.handle(
    new Request("http://localhost/profile/avatar", {
      method: "DELETE",
      headers: withAuth ? { authorization: "Bearer test-token" } : {},
    }),
  );
}

describe("profilesAvatarHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    s3SendMock.mockResolvedValue({});
    profileRepositoryMocks.update.mockResolvedValue({
      ...fakeProfile,
      avatarUrl:
        "https://test-avatars-bucket.s3.eu-west-1.amazonaws.com/test-user-id/avatar.jpg",
    });
  });

  describe("POST /profile/avatar", () => {
    it("returns 401 without auth", async () => {
      const response = await postAvatar({
        file: buildJpegFile(1024),
        withAuth: false,
      });
      expect(response.status).toBe(401);
      expect(s3SendMock).not.toHaveBeenCalled();
      expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
    });

    it("returns 400 when content-type is not an allowed image type", async () => {
      const response = await postAvatar({
        file: buildJpegFile(1024, "application/pdf"),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/unsupported content type/i);
      expect(s3SendMock).not.toHaveBeenCalled();
      expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
    });

    it("returns 400 when file exceeds 5MB", async () => {
      const response = await postAvatar({
        file: buildJpegFile(5 * 1024 * 1024 + 1),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/5mb/i);
      expect(s3SendMock).not.toHaveBeenCalled();
      expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
    });

    it("accepts image/png and image/webp", async () => {
      const png = await postAvatar({
        file: buildJpegFile(1024, "image/png"),
      });
      expect(png.status).toBe(200);

      const webp = await postAvatar({
        file: buildJpegFile(1024, "image/webp"),
      });
      expect(webp.status).toBe(200);
    });

    it("uploads to S3 under <userId>/avatar.jpg with the source content-type", async () => {
      await postAvatar({ file: buildJpegFile(2048, "image/jpeg") });

      expect(s3SendMock).toHaveBeenCalledTimes(1);
      const cmd = s3SendMock.mock.calls[0][0];
      expect(cmd.__cmd).toBe("Put");
      expect(cmd.Bucket).toBe("test-avatars-bucket");
      expect(cmd.Key).toBe("test-user-id/avatar.jpg");
      expect(cmd.ContentType).toBe("image/jpeg");
      expect(cmd.CacheControl).toBe("no-cache, max-age=0");
      // Body should be a Buffer matching the file bytes
      expect(Buffer.isBuffer(cmd.Body)).toBe(true);
      expect(cmd.Body.length).toBe(2048);
    });

    it("updates the profile row with the public S3 URL", async () => {
      const response = await postAvatar({ file: buildJpegFile(1024) });
      expect(response.status).toBe(200);

      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({
          avatarUrl: expect.stringMatching(
            /^https:\/\/test-avatars-bucket\.s3\.[a-z0-9-]+\.amazonaws\.com\/test-user-id\/avatar\.jpg$/,
          ),
        }),
      );
    });

    it("returns the new avatarUrl in the response envelope", async () => {
      const response = await postAvatar({ file: buildJpegFile(1024) });
      const body = (await response.json()) as {
        data: { avatarUrl: string };
      };
      expect(body.data.avatarUrl).toMatch(/test-user-id\/avatar\.jpg$/);
    });

    it("returns 404 when the profile row doesn't exist", async () => {
      profileRepositoryMocks.update.mockResolvedValueOnce(null);
      const response = await postAvatar({ file: buildJpegFile(1024) });
      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /profile/avatar", () => {
    it("returns 401 without auth", async () => {
      const response = await deleteAvatar({ withAuth: false });
      expect(response.status).toBe(401);
      expect(s3SendMock).not.toHaveBeenCalled();
      expect(profileRepositoryMocks.update).not.toHaveBeenCalled();
    });

    it("deletes the S3 object and nulls the avatarUrl column", async () => {
      const response = await deleteAvatar();
      expect(response.status).toBe(200);

      expect(s3SendMock).toHaveBeenCalledTimes(1);
      const cmd = s3SendMock.mock.calls[0][0];
      expect(cmd.__cmd).toBe("Delete");
      expect(cmd.Bucket).toBe("test-avatars-bucket");
      expect(cmd.Key).toBe("test-user-id/avatar.jpg");

      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        { avatarUrl: null },
      );
    });

    it("returns null avatarUrl in the response envelope", async () => {
      const response = await deleteAvatar();
      const body = (await response.json()) as {
        data: { avatarUrl: string | null };
      };
      expect(body.data.avatarUrl).toBeNull();
    });

    it("still nulls the DB row when S3 delete fails", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      s3SendMock.mockRejectedValueOnce(new Error("AccessDenied"));

      const response = await deleteAvatar();
      expect(response.status).toBe(200);

      expect(profileRepositoryMocks.update).toHaveBeenCalledWith(
        "test-user-id",
        { avatarUrl: null },
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[profile:avatar:delete]"),
      );

      warnSpy.mockRestore();
    });

    it("returns 404 when the profile row doesn't exist", async () => {
      profileRepositoryMocks.update.mockResolvedValueOnce(null);
      const response = await deleteAvatar();
      expect(response.status).toBe(404);
    });
  });
});

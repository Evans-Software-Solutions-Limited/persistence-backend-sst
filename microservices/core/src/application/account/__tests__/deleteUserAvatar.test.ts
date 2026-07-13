import { describe, it, expect, vi, beforeEach } from "vitest";

const s3SendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: s3SendMock })),
  DeleteObjectCommand: vi.fn((args) => ({ __cmd: "Delete", ...args })),
}));

vi.mock("sst", () => ({
  Resource: {
    Avatars: { name: "test-avatars-bucket" },
  },
}));

describe("deleteUserAvatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a DeleteObjectCommand for <userId>/avatar.jpg against the Avatars bucket", async () => {
    s3SendMock.mockResolvedValueOnce({});
    const { deleteUserAvatar } = await import("../deleteUserAvatar");

    await deleteUserAvatar("user-42");

    expect(s3SendMock).toHaveBeenCalledTimes(1);
    const sentCommand = s3SendMock.mock.calls[0]![0];
    expect(sentCommand).toMatchObject({
      __cmd: "Delete",
      Bucket: "test-avatars-bucket",
      Key: "user-42/avatar.jpg",
    });
  });

  it("swallows an S3 failure (log-and-continue — must never block the purge batch)", async () => {
    s3SendMock.mockRejectedValueOnce(new Error("S3 down"));
    const { deleteUserAvatar } = await import("../deleteUserAvatar");

    await expect(deleteUserAvatar("user-42")).resolves.toBeUndefined();
  });

  it("swallows a non-Error rejection too", async () => {
    s3SendMock.mockRejectedValueOnce("weird string rejection");
    const { deleteUserAvatar } = await import("../deleteUserAvatar");

    await expect(deleteUserAvatar("user-42")).resolves.toBeUndefined();
  });
});

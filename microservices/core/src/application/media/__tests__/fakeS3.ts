import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectTaggingCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * An in-memory stand-in for the private bucket (PER-121 tests). It is a REAL
 * S3Client with fake credentials, so `getSignedUrl` signs real URLs offline;
 * only `send` is replaced. `put` plays the phone's presigned PUT.
 */
export interface FakeObject {
  contentType: string;
  size: number;
  tags: Record<string, string>;
}

export class FakeBucket {
  objects = new Map<string, FakeObject>();
  sent: string[] = [];
  /** Make the next calls of this command name throw this error. */
  failures = new Map<string, unknown>();
  /** Page size for ListObjectsV2, to exercise pagination. */
  pageSize = 1000;
  /** DeleteObjects reports these keys as failed. */
  deleteErrors = new Set<string>();

  put(
    key: string,
    contentType: string,
    size: number,
    tags = { upload: "pending" },
  ) {
    this.objects.set(key, { contentType, size, tags: { ...tags } });
  }

  keys(prefix = ""): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  client(): S3Client {
    const client = new S3Client({
      region: "eu-west-2",
      credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    (client as unknown as { send: (cmd: unknown) => Promise<unknown> }).send =
      async (cmd: unknown) => this.handle(cmd);
    return client;
  }

  private async handle(cmd: unknown): Promise<unknown> {
    const name = (cmd as { constructor: { name: string } }).constructor.name;
    this.sent.push(name);
    const failure = this.failures.get(name);
    if (failure) throw failure;
    const input = (cmd as { input: Record<string, unknown> }).input;
    if (cmd instanceof HeadObjectCommand) {
      const obj = this.objects.get(input.Key as string);
      if (!obj) {
        throw Object.assign(new Error("NotFound"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        });
      }
      // Like S3, a header that wasn't set is absent.
      return {
        ContentType: obj.contentType || undefined,
        ContentLength: Number.isNaN(obj.size) ? undefined : obj.size,
      };
    }
    if (cmd instanceof PutObjectTaggingCommand) {
      const obj = this.objects.get(input.Key as string);
      const tagSet = (
        input.Tagging as { TagSet: { Key: string; Value: string }[] }
      ).TagSet;
      if (obj)
        obj.tags = Object.fromEntries(tagSet.map((t) => [t.Key, t.Value]));
      return {};
    }
    if (cmd instanceof DeleteObjectsCommand) {
      const objects = (input.Delete as { Objects: { Key: string }[] }).Objects;
      const errors = [];
      for (const { Key } of objects) {
        if (this.deleteErrors.has(Key)) {
          errors.push({ Key, Code: "AccessDenied" });
          continue;
        }
        this.objects.delete(Key);
      }
      return errors.length > 0 ? { Errors: errors } : {};
    }
    if (cmd instanceof ListObjectsV2Command) {
      // Like S3, the token marks a KEY, so deleting listed keys between
      // pages doesn't skip anything.
      const after = input.ContinuationToken as string | undefined;
      const all = this.keys(input.Prefix as string).filter(
        (k) => after === undefined || k > after,
      );
      const page = all.slice(0, this.pageSize);
      const more = all.length > page.length;
      return {
        // S3 omits Contents for an empty listing.
        Contents: page.length > 0 ? page.map((Key) => ({ Key })) : undefined,
        IsTruncated: more,
        NextContinuationToken: more ? page[page.length - 1] : undefined,
      };
    }
    throw new Error(`FakeBucket: unexpected command ${name}`);
  }
}

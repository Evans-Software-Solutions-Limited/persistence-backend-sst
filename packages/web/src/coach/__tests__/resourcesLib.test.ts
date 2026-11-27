import { describe, expect, it } from "vitest";
import { CoachApiError } from "../api/coachApi";
import {
  FILE_MISSING,
  FILE_SIZE_MESSAGE,
  FILE_TYPE_MESSAGE,
  RESOURCE_FILE_MAX_BYTES,
  TITLE_MESSAGE,
  URL_MESSAGE,
  countByKind,
  dayMonth,
  fileProblem,
  filterLibrary,
  formatBytes,
  hostOf,
  linkResolver,
  openedLabel,
  pickable,
  resourceError,
  resourceMeta,
  sharedLine,
  titleFromFileName,
  typeLabel,
  uploadResolver,
} from "../lib/resources";
import { CLIENT_RESOURCES, LIBRARY, resource } from "./helpers";

const file = (type: string, size: number, name = "Guide.pdf") =>
  new File([new Uint8Array(Math.min(size, 8))], name, { type }) as File & {
    size: number;
  };

function sized(type: string, size: number): File {
  const f = file(type, size);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

const resolve = async <V>(
  resolver: (v: V, c: unknown, o: never) => Promise<unknown>,
  values: V,
) =>
  (await resolver(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  } as never)) as { errors: Record<string, { message: string }> };

describe("resources lib (PER-143)", () => {
  it("labels types, sizes and links", () => {
    expect(typeLabel(resource())).toBe("PDF");
    expect(typeLabel(resource({ mime: "image/jpeg" }))).toBe("Image");
    expect(typeLabel(resource({ mime: null }))).toBe("File");
    expect(typeLabel(LIBRARY[1]!)).toBe("Link");
    expect(formatBytes(2_516_582)).toBe("2.4 MB");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
    expect(formatBytes(860_000)).toBe("840 KB");
    expect(formatBytes(10)).toBe("1 KB");
    expect(hostOf("https://www.studio.example/book")).toBe("studio.example");
    expect(hostOf("not a url")).toBe("not a url");
    expect(resourceMeta(LIBRARY[0]!)).toBe("PDF · 2.4 MB");
    expect(resourceMeta(LIBRARY[1]!)).toBe("Link · studio.example");
    expect(resourceMeta(resource({ kind: "link", url: null }))).toBe("Link");
    expect(resourceMeta(resource({ bytes: null }))).toBe("PDF");
    expect(dayMonth("2026-10-20T10:00:00.000Z")).toBe("20 Oct");
    expect(sharedLine(CLIENT_RESOURCES[0]!)).toBe("PDF · shared 20 Oct");
    expect(openedLabel(CLIENT_RESOURCES[0]!)).toBe("Opened");
    expect(openedLabel(CLIENT_RESOURCES[1]!)).toBe("Not opened");
  });

  it("filters, counts and picks what the client doesn't have", () => {
    expect(countByKind(LIBRARY)).toEqual({ all: 3, file: 2, link: 1 });
    expect(filterLibrary(LIBRARY, "", "link").map((r) => r.id)).toEqual([
      "res-2",
    ]);
    expect(filterLibrary(LIBRARY, "HINGE", "all").map((r) => r.id)).toEqual([
      "res-3",
    ]);
    // The search also finds a link by its site.
    expect(filterLibrary(LIBRARY, "studio.ex", "all").map((r) => r.id)).toEqual(
      ["res-2"],
    );
    expect(pickable(LIBRARY, CLIENT_RESOURCES, "").map((r) => r.id)).toEqual([
      "res-3",
    ]);
    expect(pickable(LIBRARY, CLIENT_RESOURCES, "nothing")).toEqual([]);
  });

  it("starts a title from the file name", () => {
    expect(titleFromFileName("Eating out guide.pdf")).toBe("Eating out guide");
    expect(titleFromFileName(".pdf")).toBe(".pdf");
    expect(titleFromFileName(`${"a".repeat(200)}.png`)).toHaveLength(120);
  });

  it("says resources_off plainly, offline, and other errors", () => {
    const off = new CoachApiError(403, {
      code: "resources_off",
      message: "Resources are switched off for this client",
    });
    expect(resourceError(off, "Sam", "x")).toBe(
      "Resources are switched off for Sam, so nothing was shared. Switch Resources on in Sam's Settings to share.",
    );
    expect(resourceError(off, null, "x")).toMatch(
      /switched off for one of these clients/,
    );
    expect(resourceError(new CoachApiError(0, null, true), "Sam", "x")).toBe(
      "You're offline. Try again when you're back online.",
    );
    expect(
      resourceError(new CoachApiError(500, { message: "Boom" }), "Sam", "x"),
    ).toBe("Boom");
    expect(resourceError(new Error("?"), "Sam", "fallback")).toBe("fallback");
  });

  it("checks the file a JSON schema can't", () => {
    expect(fileProblem(null)).toBe(FILE_MISSING);
    expect(fileProblem(sized("text/plain", 10))).toBe(FILE_TYPE_MESSAGE);
    expect(fileProblem(sized("application/pdf", 0))).toBe(FILE_SIZE_MESSAGE);
    expect(
      fileProblem(sized("application/pdf", RESOURCE_FILE_MAX_BYTES + 1)),
    ).toBe(FILE_SIZE_MESSAGE);
    expect(fileProblem(sized("image/png", 1000))).toBeUndefined();
  });

  it("link form: name 1–120 and an https link", async () => {
    const bad = await resolve(linkResolver as never, {
      title: "  ",
      url: "http://x.com",
    });
    expect(bad.errors.title?.message).toBe(TITLE_MESSAGE);
    expect(bad.errors.url?.message).toBe(URL_MESSAGE);
    const ok = await resolve(linkResolver as never, {
      title: " Booking ",
      url: " https://studio.example/book ",
    });
    expect(ok.errors).toEqual({});
  });

  it("upload form: a name and a PDF, JPEG or PNG up to 25 MB", async () => {
    const bad = await resolve(uploadResolver as never, {
      title: "",
      file: null,
    });
    expect(bad.errors.title?.message).toBe(TITLE_MESSAGE);
    expect(bad.errors.file?.message).toBe(FILE_MISSING);
    const ok = await resolve(uploadResolver as never, {
      title: "Guide",
      file: sized("application/pdf", 1000),
    });
    expect(ok.errors).toEqual({});
  });
});

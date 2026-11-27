import type {
  AthleteResource,
  ClientResource,
  CoachResource,
} from "@/domain/models/coachResources";
import {
  dayMonth,
  defaultImageTitle,
  fileLinkUsable,
  formatBytes,
  hostOf,
  isLocalResourceId,
  matchesQuery,
  openedLabel,
  pickable,
  resourceMeta,
  resourcesFromCoach,
  resourcesOffMessage,
  sharedLine,
  typeLabel,
} from "../coachResources.service";

function resource(over: Partial<CoachResource> = {}): CoachResource {
  return {
    id: "r1",
    kind: "file",
    title: "Shopping list",
    url: null,
    mediaId: "m1",
    mime: "application/pdf",
    bytes: 2_516_582,
    revision: 1,
    archivedAt: null,
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-20T09:00:00.000Z",
    ...over,
  };
}

const LINK = resource({
  id: "r2",
  kind: "link",
  title: "Studio booking",
  url: "https://www.Studio.example/book",
  mediaId: null,
  mime: null,
  bytes: null,
});

function athlete(over: Partial<AthleteResource> = {}): AthleteResource {
  return {
    assignmentId: "a1",
    resourceId: "r1",
    kind: "file",
    title: "Shopping list",
    url: "https://bucket.test/x",
    urlExpiresAt: "2026-11-26T10:15:00.000Z",
    mime: "application/pdf",
    bytes: 1000,
    coach: { id: "t1", name: "Ellie Hart", avatarUrl: null },
    assignedAt: "2026-11-20T09:00:00.000Z",
    openedAt: null,
    ...over,
  };
}

describe("coachResources.service (PER-143)", () => {
  it("labels types, sizes, hosts and lines", () => {
    expect(isLocalResourceId("local-x")).toBe(true);
    expect(isLocalResourceId("r1")).toBe(false);
    expect(typeLabel(resource())).toBe("PDF");
    expect(typeLabel(resource({ mime: "image/png" }))).toBe("Image");
    expect(typeLabel(resource({ mime: null }))).toBe("File");
    expect(typeLabel(LINK)).toBe("Link");
    expect(formatBytes(2_516_582)).toBe("2.4 MB");
    expect(formatBytes(30 * 1024 * 1024)).toBe("30 MB");
    expect(formatBytes(860_000)).toBe("840 KB");
    expect(formatBytes(1)).toBe("1 KB");
    expect(hostOf("https://www.Studio.example/book")).toBe("studio.example");
    expect(hostOf("nope")).toBe("nope");
    expect(resourceMeta(resource())).toBe("PDF · 2.4 MB");
    expect(resourceMeta(resource({ bytes: null }))).toBe("PDF");
    expect(resourceMeta(LINK)).toBe("Link · studio.example");
    expect(resourceMeta(resource({ kind: "link", url: null }))).toBe("Link");
    expect(dayMonth("2026-10-20T12:00:00.000Z")).toBe("20 Oct");
    const cr: ClientResource = {
      assignmentId: "a1",
      clientId: "c1",
      resource: resource(),
      assignedAt: "2026-10-20T12:00:00.000Z",
      openedAt: null,
    };
    expect(sharedLine(cr)).toBe("PDF · shared 20 Oct");
    expect(openedLabel(cr)).toBe("Not opened");
    expect(openedLabel({ openedAt: "x" })).toBe("Opened");
  });

  it("searches and picks what the client doesn't have", () => {
    expect(matchesQuery(LINK, "")).toBe(true);
    expect(matchesQuery(LINK, "BOOK")).toBe(true);
    expect(matchesQuery(LINK, "studio.ex")).toBe(true);
    expect(matchesQuery(resource(), "studio")).toBe(false);
    const have: ClientResource[] = [
      {
        assignmentId: "a1",
        clientId: "c1",
        resource: resource(),
        assignedAt: "2026-10-20T12:00:00.000Z",
        openedAt: null,
      },
    ];
    expect(pickable([resource(), LINK], have, "").map((r) => r.id)).toEqual([
      "r2",
    ]);
    expect(pickable([resource(), LINK], have, "zzz")).toEqual([]);
  });

  it("filters the athlete's resources by coach, newest first", () => {
    const rows = [
      athlete({ assignmentId: "old", assignedAt: "2026-11-01T09:00:00Z" }),
      athlete({ assignmentId: "new", assignedAt: "2026-11-21T09:00:00Z" }),
      athlete({
        assignmentId: "other",
        coach: { id: "t2", name: "Marcus", avatarUrl: null },
      }),
    ];
    expect(resourcesFromCoach(rows, "t1").map((r) => r.assignmentId)).toEqual([
      "new",
      "old",
    ]);
  });

  it("knows when a file link is still good", () => {
    const now = new Date("2026-11-26T10:00:00.000Z");
    expect(fileLinkUsable(athlete(), now)).toBe(true);
    expect(
      fileLinkUsable(
        athlete({ urlExpiresAt: "2026-11-26T10:00:20.000Z" }),
        now,
      ),
    ).toBe(false);
    expect(fileLinkUsable(athlete({ url: null }), now)).toBe(false);
    expect(
      fileLinkUsable(athlete({ kind: "link", urlExpiresAt: null }), now),
    ).toBe(true);
    expect(fileLinkUsable(athlete({ urlExpiresAt: null }), now)).toBe(true);
  });

  it("says resources_off plainly and names a picked photo", () => {
    expect(resourcesOffMessage("Sam")).toBe(
      "Resources are switched off for Sam, so nothing was shared. Switch Resources on in Sam's settings to share.",
    );
    expect(resourcesOffMessage(null)).toMatch(/one of these clients/);
    const now = new Date("2026-11-26T10:00:00.000Z");
    expect(defaultImageTitle("IMG_0042.HEIC", now)).toBe("IMG_0042");
    expect(defaultImageTitle(null, now)).toBe("Image 26 Nov");
    expect(defaultImageTitle(`${"a".repeat(200)}.jpg`, now)).toHaveLength(120);
  });
});

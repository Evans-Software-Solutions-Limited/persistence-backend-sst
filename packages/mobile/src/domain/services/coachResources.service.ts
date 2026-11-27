import type {
  AthleteResource,
  ClientResource,
  CoachResource,
  ResourceKind,
} from "@/domain/models/coachResources";

/**
 * PER-143: pure helpers for the resources screens (coach C3.7b/c, Library →
 * Resources, the athlete's Coach tab). Limits mirror the API: titles 1–120,
 * https links up to 2,000, files PDF / JPEG / PNG up to 25 MB (the phone
 * uploads images only, through the app's photo picker).
 */

export const RESOURCE_TITLE_MAX = 120;
export const RESOURCE_URL_MAX = 2000;
export const RESOURCE_FILE_MAX_BYTES = 25 * 1024 * 1024;

export function isLocalResourceId(id: string): boolean {
  return id.startsWith("local-");
}

export function typeLabel(r: { kind: ResourceKind; mime: string | null }) {
  if (r.kind === "link") return "Link";
  if (r.mime === "application/pdf") return "PDF";
  if (r.mime?.startsWith("image/")) return "Image";
  return "File";
}

/** "2.4 MB", "840 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The link's host without `www.`; the raw text when it won't parse. */
export function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url.trim());
  return m ? m[1]!.replace(/^www\./i, "").toLowerCase() : url;
}

/** "PDF · 2.4 MB", "Image · 840 KB", "Link · studio.com". */
export function resourceMeta(r: {
  kind: ResourceKind;
  mime: string | null;
  bytes: number | null;
  url: string | null;
}): string {
  if (r.kind === "link") return r.url ? `Link · ${hostOf(r.url)}` : "Link";
  const type = typeLabel(r);
  return r.bytes ? `${type} · ${formatBytes(r.bytes)}` : type;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "20 Oct". */
export function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** C3.7b row: "PDF · shared 20 Oct". */
export function sharedLine(cr: ClientResource): string {
  return `${typeLabel(cr.resource)} · shared ${dayMonth(cr.assignedAt)}`;
}

/** The API stamps the first open only, so the pill has no count. */
export function openedLabel(r: { openedAt: string | null }): string {
  return r.openedAt ? "Opened" : "Not opened";
}

export function matchesQuery(
  r: { title: string; url: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    r.title.toLowerCase().includes(q) ||
    (r.url ? hostOf(r.url).includes(q) : false)
  );
}

/** The C3.7c picker: library resources this client doesn't have yet. */
export function pickable(
  library: readonly CoachResource[],
  assigned: readonly ClientResource[],
  query: string,
): CoachResource[] {
  const have = new Set(assigned.map((a) => a.resource.id));
  return library.filter((r) => !have.has(r.id) && matchesQuery(r, query));
}

/** The athlete's resources from one coach, newest first. */
export function resourcesFromCoach(
  all: readonly AthleteResource[],
  trainerId: string,
): AthleteResource[] {
  return all
    .filter((r) => r.coach.id === trainerId)
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
}

/** A file link the API gave out is still good for another 30 s. */
export function fileLinkUsable(r: AthleteResource, now: Date): boolean {
  if (!r.url) return false;
  if (r.kind === "link" || !r.urlExpiresAt) return true;
  return new Date(r.urlExpiresAt).getTime() - now.getTime() > 30_000;
}

export function resourcesOffMessage(clientFirst: string | null): string {
  return clientFirst
    ? `Resources are switched off for ${clientFirst}, so nothing was shared. Switch Resources on in ${clientFirst}'s settings to share.`
    : "Resources are switched off for one of these clients, so nothing was shared. Switch Resources on in their settings to share.";
}

/** The file name without its extension, else "Image 26 Nov". */
export function defaultImageTitle(fileName: string | null, now: Date): string {
  const base = fileName?.replace(/\.[^.]+$/, "").trim();
  return (base || `Image ${dayMonth(now.toISOString())}`).slice(
    0,
    RESOURCE_TITLE_MAX,
  );
}

import { Type } from "@sinclair/typebox";
import { schemaResolver, trimmed, type ServerFieldMap } from "@/lib/form";
import { isCoachApiError } from "../api/coachApi";
import type { ClientResource, CoachResource } from "../api/types";

/**
 * Resources (PER-143: C3.7 client tab, C5b Library → Resources). Pure
 * helpers and the two react-hook-form schemas (Add link, Upload).
 *
 * Limits mirror the API (`coaching/resources/resourceRepository.ts` and the
 * `resource` upload rule in `media/privateMediaRepository.ts`): titles 1–120
 * characters, https links up to 2,000, files PDF / JPEG / PNG up to 25 MB.
 * The server keeps the final say; its 422s land on these fields.
 */

export const RESOURCE_TITLE_MAX = 120;
export const RESOURCE_URL_MAX = 2000;
export const RESOURCE_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const RESOURCE_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export const RESOURCE_FILE_ACCEPT = RESOURCE_FILE_TYPES.join(",");

/** The library filter chips the API can answer (All · Files · Links). */
export type ResourceFilter = "all" | "file" | "link";

export function typeLabel(r: Pick<CoachResource, "kind" | "mime">): string {
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

/** The link's host, without `www.`; the raw text when it won't parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** C5b Type column: "PDF · 2.4 MB", "Image · 840 KB", "Link · studio.com". */
export function resourceMeta(r: CoachResource): string {
  if (r.kind === "link") {
    return r.url ? `Link · ${hostOf(r.url)}` : "Link";
  }
  const type = typeLabel(r);
  return r.bytes ? `${type} · ${formatBytes(r.bytes)}` : type;
}

/** "20 Oct". */
export function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}

/** C3.7 row: "PDF · shared 20 Oct". */
export function sharedLine(cr: ClientResource): string {
  return `${typeLabel(cr.resource)} · shared ${dayMonth(cr.assignedAt)}`;
}

/** The C3.7 pill. The API stamps the first open only, so no count. */
export function openedLabel(cr: Pick<ClientResource, "openedAt">): string {
  return cr.openedAt ? "Opened" : "Not opened";
}

export function matches(r: CoachResource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    r.title.toLowerCase().includes(q) ||
    (r.url ? hostOf(r.url).toLowerCase().includes(q) : false)
  );
}

export function filterLibrary(
  library: readonly CoachResource[],
  query: string,
  filter: ResourceFilter,
): CoachResource[] {
  return library.filter(
    (r) => (filter === "all" || r.kind === filter) && matches(r, query),
  );
}

export function countByKind(library: readonly CoachResource[]) {
  return {
    all: library.length,
    file: library.filter((r) => r.kind === "file").length,
    link: library.filter((r) => r.kind === "link").length,
  };
}

/** The picker (C3.7a/c): library resources this client doesn't have yet. */
export function pickable(
  library: readonly CoachResource[],
  assigned: readonly ClientResource[],
  query: string,
): CoachResource[] {
  const have = new Set(assigned.map((a) => a.resource.id));
  return library.filter((r) => !have.has(r.id) && matches(r, query));
}

/** A file's name without its extension, as a starting title. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return (base || name).slice(0, RESOURCE_TITLE_MAX);
}

/**
 * The API's answer as one line for a banner. 403 `resources_off` (C3.9
 * switched off, PER-150) says so plainly; offline says a connection is
 * needed.
 */
export function resourceError(
  e: unknown,
  clientFirst: string | null,
  fallback: string,
): string {
  if (isCoachApiError(e)) {
    if (e.code === "resources_off") {
      return clientFirst
        ? `Resources are switched off for ${clientFirst}, so nothing was shared. Switch Resources on in ${clientFirst}'s Settings to share.`
        : "Resources are switched off for one of these clients, so nothing was shared. Switch Resources on in their Settings to share.";
    }
    if (e.offline) return "You're offline. Try again when you're back online.";
    return e.message;
  }
  return fallback;
}

// ─── Add link (react-hook-form) ──────────────────────────────────────────────

export interface LinkFormValues {
  title: string;
  url: string;
}

export const TITLE_MESSAGE = `Add a name of up to ${RESOURCE_TITLE_MAX} characters.`;
export const URL_MESSAGE = "Enter a full link starting with https://";

export const linkSchema = Type.Object({
  title: Type.String({
    minLength: 1,
    maxLength: RESOURCE_TITLE_MAX,
    errorMessage: TITLE_MESSAGE,
  }),
  url: Type.String({
    pattern: String.raw`^[Hh][Tt][Tt][Pp][Ss]://[^\s/?#]+\S*$`,
    maxLength: RESOURCE_URL_MAX,
    errorMessage: URL_MESSAGE,
  }),
});

export const linkResolver = schemaResolver<LinkFormValues>(linkSchema, {
  prepare: trimmed,
});

export const LINK_SERVER_FIELDS: ServerFieldMap<LinkFormValues> = {
  title: { field: "title", message: TITLE_MESSAGE },
  url: { field: "url", message: URL_MESSAGE },
};

// ─── Upload (react-hook-form) ────────────────────────────────────────────────

export interface UploadFormValues {
  title: string;
  file: File | null;
}

export const FILE_MISSING = "Choose a file to upload.";
export const FILE_TYPE_MESSAGE = "Choose a PDF, JPEG or PNG file.";
export const FILE_SIZE_MESSAGE = "Files can be up to 25 MB.";

export const uploadSchema = Type.Object({
  title: Type.String({
    minLength: 1,
    maxLength: RESOURCE_TITLE_MAX,
    errorMessage: TITLE_MESSAGE,
  }),
  file: Type.Unknown(),
});

/** The file rules a JSON schema can't say about a `File`. */
export function fileProblem(file: File | null): string | undefined {
  if (!file) return FILE_MISSING;
  if (!(RESOURCE_FILE_TYPES as readonly string[]).includes(file.type)) {
    return FILE_TYPE_MESSAGE;
  }
  if (file.size < 1 || file.size > RESOURCE_FILE_MAX_BYTES) {
    return FILE_SIZE_MESSAGE;
  }
  return undefined;
}

export const uploadResolver = schemaResolver<UploadFormValues>(uploadSchema, {
  prepare: trimmed,
  refine: (v: UploadFormValues) => ({ file: fileProblem(v.file) }),
});

export const UPLOAD_SERVER_FIELDS: ServerFieldMap<UploadFormValues> = {
  title: { field: "title", message: TITLE_MESSAGE },
  contentType: { field: "file", message: FILE_TYPE_MESSAGE },
  bytes: { field: "file", message: FILE_SIZE_MESSAGE },
  mediaId: { field: "file", message: "That upload didn't finish. Try again." },
};

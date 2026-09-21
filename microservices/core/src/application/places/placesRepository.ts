import { decodeCursor, encodeCursor } from "../social/pagination";
import { createHash } from "node:crypto";
import { requireTogether, TogetherError } from "../together/shared";
export type Place = {
  placeId: string;
  label: string;
  center: { latitude: number; longitude: number };
};
type Features = {
  features?: {
    properties?: {
      place_id?: string;
      formatted?: string;
      lat?: number;
      lon?: number;
    };
  }[];
};
/** Geoapify: credentials stay server-side. No raw GPS coordinates are persisted or logged. */
export class PlacesRepository {
  private readonly apiKey: string | undefined;
  private readonly fetcher: typeof fetch;
  constructor(
    apiKey = process.env.GEOAPIFY_API_KEY,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }
  /** Resolve selected provider identity; clients never supply trusted place labels. */
  async resolve(placeId: string): Promise<Place> {
    requireTogether(this.apiKey, "PROVIDER_UNAVAILABLE", 503);
    requireTogether(
      /^geoapify:[A-Za-z0-9_-]{1,512}$/.test(placeId),
      "INVALID_PLACE",
      400,
    );
    const id = placeId.slice("geoapify:".length);
    const url = new URL("https://api.geoapify.com/v2/place-details");
    url.searchParams.set("id", id);
    url.searchParams.set("apiKey", this.apiKey!);
    url.searchParams.set("features", "details");
    let payload: Features;
    try {
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("provider");
      payload = (await response.json()) as Features;
    } catch {
      throw new TogetherError("PROVIDER_UNAVAILABLE", 503);
    }
    const p = Array.isArray(payload?.features)
      ? payload.features.find((f) => f?.properties?.place_id === id)?.properties
      : undefined;
    requireTogether(
      p &&
        typeof p.formatted === "string" &&
        p.formatted.length > 0 &&
        p.formatted.length <= 500 &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Math.abs(p.lat!) <= 90 &&
        Math.abs(p.lon!) <= 180,
      "INVALID_PLACE",
      400,
    );
    return {
      placeId,
      label: p.formatted,
      center: { latitude: p.lat!, longitude: p.lon! },
    };
  }
  async find(
    actor: string,
    input: {
      q?: string;
      latitude?: number;
      longitude?: number;
      cursor?: string;
      limit?: number;
    },
  ) {
    requireTogether(this.apiKey, "PROVIDER_UNAVAILABLE", 503);
    const limit = input.limit ?? 20;
    requireTogether(
      Number.isInteger(limit) && limit >= 1 && limit <= 50,
      "INVALID_QUERY",
      400,
    );
    const q = input.q?.trim();
    const nearby = q === undefined;
    requireTogether(
      nearby
        ? Number.isFinite(input.latitude) &&
            Number.isFinite(input.longitude) &&
            Math.abs(input.latitude!) <= 90 &&
            Math.abs(input.longitude!) <= 180
        : q.length >= 2 && q.length <= 100,
      "INVALID_QUERY",
      400,
    );
    const scope = createHash("sha256")
      .update(
        JSON.stringify([actor, q, input.latitude, input.longitude, limit]),
      )
      .digest("hex");
    let offset = 0;
    if (input.cursor) {
      try {
        const c = decodeCursor(input.cursor);
        requireTogether(
          c.scope === scope &&
            Number.isInteger(c.offset) &&
            typeof c.offset === "number" &&
            c.offset >= 0 &&
            c.offset <= 1000,
          "INVALID_CURSOR",
          400,
        );
        requireTogether(
          typeof c.expires === "number" && c.expires > Date.now(),
          "CURSOR_EXPIRED",
          410,
        );
        offset = c.offset as number;
      } catch (e) {
        if (e instanceof TogetherError) throw e;
        throw new TogetherError("INVALID_CURSOR", 400);
      }
    }
    const url = new URL(
      nearby
        ? "https://api.geoapify.com/v2/places"
        : "https://api.geoapify.com/v1/geocode/search",
    );
    url.searchParams.set("apiKey", this.apiKey!);
    // Forward geocoding has no offset contract: page a bounded top-50 result set.
    url.searchParams.set("limit", String(nearby ? limit : 50));
    if (nearby) url.searchParams.set("offset", String(offset));
    if (nearby) {
      url.searchParams.set("categories", "sport.fitness");
      url.searchParams.set(
        "filter",
        `circle:${input.longitude},${input.latitude},5000`,
      );
      url.searchParams.set(
        "bias",
        `proximity:${input.longitude},${input.latitude}`,
      );
    } else url.searchParams.set("text", q);
    let payload: Features;
    try {
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("provider");
      payload = (await response.json()) as Features;
    } catch {
      throw new TogetherError("PROVIDER_UNAVAILABLE", 503);
    }
    requireTogether(
      payload && Array.isArray(payload.features),
      "PROVIDER_UNAVAILABLE",
      503,
    );
    const data: Place[] = [];
    for (const feature of nearby
      ? payload.features
      : payload.features.slice(offset, offset + limit)) {
      const p = feature?.properties;
      if (
        p?.place_id &&
        p.formatted &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Math.abs(p.lat!) <= 90 &&
        Math.abs(p.lon!) <= 180
      )
        data.push({
          placeId: `geoapify:${p.place_id}`,
          label: p.formatted,
          center: { latitude: p.lat!, longitude: p.lon! },
        });
    }
    return {
      data,
      nextCursor: (
        nearby
          ? payload.features.length === limit && offset + limit <= 1000
          : payload.features.length > offset + limit
      )
        ? encodeCursor({
            scope,
            offset: offset + limit,
            expires: Date.now() + 900_000,
          })
        : null,
    };
  }
}
export const placesRepository = new PlacesRepository();

import { useEffect, useState } from "react";
import type { ClientPhoto } from "./types";

/**
 * Images cached by photo id, not by their view link (PER-138). A coach's
 * link lasts 5 minutes and changes on every read, so the browser's own cache
 * never hits; this keeps each photo once per session as an object URL. A
 * photo only shows while the server still lists it, so a refusal (coaching
 * ended, sharing off) hides cached images too.
 */

const MAX_CACHED = 150;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function remember(id: string, objectUrl: string) {
  cache.set(id, objectUrl);
  while (cache.size > MAX_CACHED) {
    const [oldest, url] = cache.entries().next().value as [string, string];
    cache.delete(oldest);
    URL.revokeObjectURL(url);
  }
}

function load(id: string, url: string): Promise<string> {
  const running = inflight.get(id);
  if (running) return running;
  const p = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`photo ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      remember(id, objectUrl);
      return objectUrl;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** For tests: forget every cached photo. */
export function clearPhotoCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
  inflight.clear();
}

/**
 * The `src` to show for a photo: the cached copy; null while it loads (the
 * tile shows its placeholder); the view link itself if it couldn't be
 * fetched as a file (the `<img>` then tries it directly).
 */
export function usePhotoSrc(photo: ClientPhoto | null): string | null {
  const id = photo?.id ?? null;
  const url = photo?.url ?? null;
  const [, setLoaded] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !url || cache.has(id)) return;
    let live = true;
    load(id, url).then(
      () => {
        if (live) setLoaded((n) => n + 1);
      },
      () => {
        if (live) setFailed(url);
      },
    );
    return () => {
      live = false;
    };
  }, [id, url]);
  if (!id) return null;
  return cache.get(id) ?? (failed === url ? url : null);
}

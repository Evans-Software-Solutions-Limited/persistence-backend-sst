import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { newIdempotencyKey } from "../api/coachApi";
import type { CoachResource } from "../api/types";
import { coachKeys, useCoachApi } from "../hooks/coachQueries";
import type { LinkFormValues, UploadFormValues } from "../lib/resources";

/**
 * Add a link or upload a file to the coach's library (C3.7 picker and C5b).
 * Uploads need a connection: ask for a presigned link, PUT the file to
 * storage, then save the resource with its `mediaId`. Each step has its own
 * Idempotency-Key, so a retry after a dropped answer doesn't add it twice.
 * The new resource goes to the top of the cached library at once.
 */
export function useNewResource() {
  const api = useCoachApi();
  const queryClient = useQueryClient();

  const remember = useCallback(
    (resource: CoachResource) => {
      queryClient.setQueryData<CoachResource[]>(coachKeys.resources, (old) =>
        old
          ? [resource, ...old.filter((r) => r.id !== resource.id)]
          : [resource],
      );
      return resource;
    },
    [queryClient],
  );

  const addLink = useCallback(
    async (values: LinkFormValues) =>
      remember(
        await api.createResource(
          { kind: "link", title: values.title.trim(), url: values.url.trim() },
          newIdempotencyKey(),
        ),
      ),
    [api, remember],
  );

  const upload = useCallback(
    async (values: UploadFormValues) => {
      const file = values.file!;
      const media = await api.createResourceUpload(
        file.type,
        file.size,
        newIdempotencyKey(),
      );
      if (media.upload) await api.putUpload(media.upload, file);
      return remember(
        await api.createResource(
          { kind: "file", title: values.title.trim(), mediaId: media.mediaId },
          newIdempotencyKey(),
        ),
      );
    },
    [api, remember],
  );

  return { addLink, upload };
}

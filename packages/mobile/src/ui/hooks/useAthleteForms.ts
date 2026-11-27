import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import * as ImageManipulator from "expo-image-manipulator";
import { getApiBaseUrl } from "@/adapters/api";
import {
  FORM_LOCAL_TABLES,
  FORM_REQUESTS_TABLES,
  SYNC_QUEUE_TABLES,
} from "@/adapters/storage/tables";
import { withLiveQueue } from "@/domain/services/athleteForms.service";
import {
  liveFormResponseIds,
  markJoinIntroSeenCommand,
  pruneFormLocals,
  queueFormResponseCommand,
  saveFormDraftCommand,
  sendFormNowCommand,
  type SendNowOutcome,
} from "@/application/commands/athleteForms.command";
import { processSyncQueue } from "@/application/commands/sync.command";
import type {
  AnswerValue,
  AthleteFormRequest,
  AthleteFormRequests,
  LocalFormState,
} from "@/domain/models/athleteForms";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/**
 * PER-130 (APP-C2): the athlete's due forms, cache-first from
 * `cached_form_requests` so they show (and can be filled in) offline, plus
 * each one's draft and send state from `form_request_local`.
 */

const NO_REQUESTS: AthleteFormRequest[] = [];

/** Every mounted `useAthleteForms` re-reads the local states through this. */
const reloaders = new Set<() => void>();

/** Re-read `form_request_local` in every mounted `useAthleteForms`, now. */
export function notifyFormLocalsChanged(): void {
  for (const reload of [...reloaders]) reload();
}

export type AthleteFormsState = CachedResourceState<AthleteFormRequests> & {
  /** Due forms in Coach-tab order; [] until read. */
  requests: AthleteFormRequest[];
  locals: LocalFormState[];
};

export function useAthleteForms(opts?: {
  enabled?: boolean;
}): AthleteFormsState {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const res = useCachedResource<AthleteFormRequests>({
    read: (s, uid) => ({ value: s.getCachedFormRequests(uid), isStale: true }),
    fetcher: (api) => api.getMyFormRequests(),
    write: (s, uid, value) => {
      s.cacheFormRequests(uid, value);
      pruneFormLocals(s, uid, value.requests);
      notifyFormLocalsChanged();
    },
    tables: FORM_REQUESTS_TABLES,
    enabled: opts?.enabled,
  });

  // A send whose queue row has died counts as a draft again (#571).
  const read = useCallback(
    () =>
      userId
        ? withLiveQueue(
            storage.getLocalFormStates(userId),
            liveFormResponseIds(storage, userId),
          )
        : [],
    [storage, userId],
  );
  const [locals, setLocals] = useState<LocalFormState[]>(read);
  useEffect(() => {
    const reload = () => setLocals(read());
    reload();
    reloaders.add(reload);
    // The queue too: a send that dies (or is discarded) makes the form
    // fillable again.
    const unsubscribe = storage.subscribe(
      [...FORM_LOCAL_TABLES, ...SYNC_QUEUE_TABLES],
      reload,
    );
    return () => {
      reloaders.delete(reload);
      unsubscribe();
    };
  }, [storage, read]);

  return {
    ...res,
    requests: res.data?.requests ?? NO_REQUESTS,
    locals,
  };
}

/** The photo as a JPEG for upload: the API takes JPEG only, up to 10 MB. */
export async function readFormPhoto(uri: string): Promise<Blob> {
  const jpeg = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  const response = await fetch(jpeg.uri);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Photo file is empty");
  return blob;
}

export type AthleteFormActions = {
  saveDraft: (
    request: AthleteFormRequest,
    answers: Record<string, AnswerValue>,
    step: number,
  ) => void;
  markIntroSeen: (requests: readonly AthleteFormRequest[]) => void;
  /** No photos: wait on the phone and send through the queue. */
  queueSend: (
    request: AthleteFormRequest,
    draft: Record<string, AnswerValue>,
    answers: Record<string, unknown>,
  ) => void;
  /** Photos: upload, then send straight away (needs a connection). */
  sendNow: (
    request: AthleteFormRequest,
    draft: Record<string, AnswerValue>,
    photos: readonly { field: string; uri: string }[],
    toApiAnswers: (
      values: Record<string, AnswerValue>,
    ) => Record<string, unknown>,
  ) => Promise<{ outcome: SendNowOutcome; draft: Record<string, AnswerValue> }>;
};

export function useAthleteFormActions(): AthleteFormActions {
  const { api, auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const userRef = useRef(userId);
  userRef.current = userId;

  const drain = useCallback(async () => {
    try {
      await processSyncQueue(storage, auth, getApiBaseUrl());
    } catch (err) {
      console.error("[useAthleteFormActions] queue flush failed:", err);
    }
    notifyFormLocalsChanged();
  }, [auth, storage]);

  return useMemo<AthleteFormActions>(
    () => ({
      saveDraft: (request, answers, step) => {
        const uid = userRef.current;
        if (!uid) return;
        saveFormDraftCommand({ storage, userId: uid }, request, answers, step);
      },
      markIntroSeen: (requests) => {
        const uid = userRef.current;
        if (!uid) return;
        markJoinIntroSeenCommand({ storage, userId: uid }, requests);
        notifyFormLocalsChanged();
      },
      queueSend: (request, draft, answers) => {
        const uid = userRef.current;
        if (!uid) return;
        queueFormResponseCommand(
          { storage, userId: uid },
          request,
          draft,
          answers,
        );
        notifyFormLocalsChanged();
        void drain();
      },
      sendNow: async (request, draft, photos, toApiAnswers) => {
        const uid = userRef.current;
        if (!uid) {
          return { outcome: { kind: "failed", reason: "network" }, draft };
        }
        const result = await sendFormNowCommand(
          {
            storage,
            userId: uid,
            api,
            readPhoto: readFormPhoto,
            newKey: randomUUID,
          },
          request,
          draft,
          photos,
          toApiAnswers,
        );
        notifyFormLocalsChanged();
        return result;
      },
    }),
    [api, storage, drain],
  );
}

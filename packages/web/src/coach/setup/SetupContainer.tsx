import { useEffect, useMemo, useRef, useState } from "react";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import type {
  ClientProfileDetail,
  SetupItem,
  SetupSection,
} from "../api/types";
import {
  coachKeys,
  useClientProfile,
  useCoachApi,
  useLibrary,
  useOnline,
  useRoster,
} from "../hooks/coachQueries";
import {
  CONFLICT_NOTICE,
  draftError,
  itemsToSave,
  sameItems,
  stillEditable,
} from "../lib/draft";
import { clockTime, firstName, initials } from "../lib/people";
import {
  SECTION_TITLE,
  WEB_SECTIONS,
  buildLibrary,
  checklistCount,
  checklistSummary,
  itemsOf,
} from "../lib/setup";
import { LoadError, Loading } from "../ui/parts";
import { CopyFromDialog, type CopySource } from "./CopyFromDialog";
import { usePreview } from "./usePreview";
import {
  MealPlanEditor,
  RepeatingCheckinsEditor,
  StarterFormsEditor,
  TargetsEditor,
  WelcomeEditor,
} from "./SectionEditors";
import { SetupStepView } from "./SetupStep";

const NOT_EDITABLE =
  "This client has already accepted or the invite was cancelled, so the set-up can't change here.";

/**
 * A section's unsaved edits, with the items and revision they started from.
 * A background refetch must not move that baseline: the save sends the
 * revision the coach began editing, so another device's change gives a 409
 * instead of being silently overwritten.
 */
interface Draft {
  items: SetupItem[];
  base: SetupItem[];
  revision: number;
}
type Drafts = Partial<Record<SetupSection, Draft>>;

/** Add client · 2 Set up, and editing a section from the invited page. */
export function SetupContainer() {
  const { profileId = "", section: sectionParam } = useParams();
  const [search] = useSearchParams();
  const editing = search.get("from") === "invited";
  const navigate = useNavigate();
  const api = useCoachApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const detailQ = useClientProfile(profileId);
  const library = useLibrary();
  const roster = useRoster();

  const [drafts, setDrafts] = useState<Drafts>({});
  const [hidden, setHidden] = useState<SetupSection[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // Leaving by a link that doesn't go through `go()` (the rail, the browser's
  // own navigation) would lose unsaved edits. "Changes save when you move
  // on", so on unmount every valid unsaved draft is saved in the background,
  // one after another, each on the newest revision while its section is
  // unchanged. Best effort: a failure leaves the server as it was.
  const draftsRef = useRef<Drafts>({});
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(
    () => () => {
      const pending = (
        Object.entries(draftsRef.current) as [SetupSection, Draft][]
      ).filter(
        ([s, dr]) => !sameItems(dr.items, dr.base) && !draftError(s, dr.items),
      );
      if (pending.length === 0) return;
      const key = coachKeys.clientProfile(profileId);
      void (async () => {
        let latest: ClientProfileDetail | null = null;
        for (const [s, dr] of pending) {
          const revision =
            latest && sameItems(dr.base, itemsOf(latest, s))
              ? latest.revision
              : dr.revision;
          const put = (rev: number) =>
            api.replaceSection(profileId, s, itemsToSave(s, dr.items), rev);
          try {
            latest = await put(revision);
          } catch (e) {
            const current =
              isCoachApiError(e) && e.code === "revision_conflict"
                ? (e.body?.current as ClientProfileDetail | undefined)
                : undefined;
            // Only when this section is still as the draft found it.
            if (
              current &&
              stillEditable(current) &&
              sameItems(dr.base, itemsOf(current, s))
            ) {
              latest = await put(current.revision).catch(() => current);
            } else if (current) {
              latest = current;
            }
          }
          if (latest) queryClient.setQueryData(key, latest);
        }
        void queryClient.invalidateQueries({ queryKey: key });
      })();
    },
    [api, profileId, queryClient],
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const lib = useMemo(
    () => buildLibrary(library.forms, library.schedules, library.plans),
    [library.forms, library.schedules, library.plans],
  );
  const preview = usePreview(detailQ.data, lib);

  const visible = WEB_SECTIONS.filter((s) => !hidden.includes(s));
  const current: SetupSection =
    sectionParam && (visible as string[]).includes(sectionParam)
      ? (sectionParam as SetupSection)
      : visible[0];

  const detail = detailQ.data;
  if (detailQ.isPending) return <Loading />;
  if (!detail) {
    return (
      <LoadError
        message={
          isCoachApiError(detailQ.error) && detailQ.error.status === 404
            ? "This client isn't in your list."
            : online
              ? "We couldn't load this client."
              : "You're offline. This client loads when you're back online."
        }
        onRetry={() => detailQ.refetch()}
      />
    );
  }
  if (detail.status === "active" && detail.clientId) {
    return <Navigate to={`/coach/clients/${detail.clientId}`} replace />;
  }

  const base = `/coach/clients/invited/${profileId}`;
  const sectionUrl = (s: SetupSection) =>
    `${base}/setup/${s}${editing ? "?from=invited" : ""}`;
  const clientFirst = firstName(detail.displayName);
  const detailKey = coachKeys.clientProfile(profileId);
  const saved = itemsOf(detail, current);
  const draft = drafts[current];
  const items = draft?.items ?? saved;
  const dirty = draft !== undefined && !sameItems(draft.items, draft.base);
  const editable = detail.status === "invited" || detail.status === "cancelled";

  const dropDraft = (section: SetupSection) => {
    // Synchronously too, so the unmount save never resends a saved draft.
    const rest = { ...draftsRef.current };
    delete rest[section];
    draftsRef.current = rest;
    setDrafts((d) => {
      const next = { ...d };
      delete next[section];
      return next;
    });
  };

  async function saveCurrent(): Promise<boolean> {
    if (!dirty) {
      dropDraft(current);
      return true;
    }
    const problem = draftError(current, items);
    if (problem) {
      setError(problem);
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const put = (revision: number) =>
        api.replaceSection(
          profileId,
          current,
          itemsToSave(current, items),
          revision,
        );
      let next: ClientProfileDetail;
      try {
        next = await put(draft!.revision);
      } catch (e) {
        // The revision is per profile: a 409 can come from a change to
        // another section, the notes or a resent code. If THIS section is
        // still as the draft found it, nothing clashes: save once more on
        // the new revision. Only a real change to this section drops it.
        const latest =
          isCoachApiError(e) && e.code === "revision_conflict"
            ? (e.body?.current as ClientProfileDetail | undefined)
            : undefined;
        if (
          !latest ||
          !stillEditable(latest) ||
          !sameItems(draft!.base, itemsOf(latest, current))
        ) {
          throw e;
        }
        next = await put(latest.revision);
      }
      queryClient.setQueryData(detailKey, next);
      // The revision is per profile, so this save moves it for every section.
      // Drafts left in other sections (e.g. after the browser's Back) move to
      // the new revision when their section is unchanged on the server; a
      // real concurrent change to that section still answers 409.
      setDrafts((d) => {
        const rest: Drafts = {};
        for (const [s, dr] of Object.entries(d) as [SetupSection, Draft][]) {
          if (s === current) continue;
          rest[s] = sameItems(dr.base, itemsOf(next, s))
            ? { ...dr, revision: next.revision }
            : dr;
        }
        return rest;
      });
      setToast("Saved");
      void queryClient.invalidateQueries({ queryKey: coachKeys.roster });
      return true;
    } catch (e) {
      if (isCoachApiError(e) && e.code === "revision_conflict") {
        const latest = e.body?.current as ClientProfileDetail | undefined;
        if (latest) queryClient.setQueryData(detailKey, latest);
        else void detailQ.refetch();
        dropDraft(current);
        setNotice(CONFLICT_NOTICE);
        return false;
      }
      if (isCoachApiError(e) && e.code === "section_unavailable") {
        setHidden((h) => [...h, current]);
        dropDraft(current);
        return true;
      }
      if (isCoachApiError(e) && e.code === "profile_not_editable") {
        setError(NOT_EDITABLE);
        return false;
      }
      setError(
        isCoachApiError(e) && e.offline
          ? "You're offline. Your changes save when you're back online."
          : isCoachApiError(e)
            ? e.message
            : "We couldn't save that. Try again.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  const go = async (path: string) => {
    if (await saveCurrent()) {
      setNotice(null);
      navigate(path);
    }
  };

  const disabled = !online || !editable || saving;
  const editorProps = {
    items,
    disabled,
    clientFirst,
    onChange: (next: SetupItem[]) => {
      setError(null);
      setDrafts((d) => ({
        ...d,
        [current]: {
          items: next,
          base: d[current]?.base ?? saved,
          revision: d[current]?.revision ?? detail.revision,
        },
      }));
    },
  };

  let editor;
  switch (current) {
    case "starter_form":
      editor = (
        <StarterFormsEditor {...editorProps} forms={library.forms ?? []} />
      );
      break;
    case "repeating_form":
      editor = (
        <RepeatingCheckinsEditor
          {...editorProps}
          forms={library.forms ?? []}
          schedules={library.schedules ?? []}
        />
      );
      break;
    case "nutrition_target":
      editor = (
        <TargetsEditor
          key={`targets-${detail.revision}`}
          {...editorProps}
          error={error && error.startsWith("Enter calories") ? error : null}
        />
      );
      break;
    case "meal_plan":
      editor = <MealPlanEditor {...editorProps} plans={library.plans ?? []} />;
      break;
    default:
      editor = <WelcomeEditor {...editorProps} />;
  }

  const sources: CopySource[] = [
    ...(roster.data?.data ?? [])
      .filter((c) => c.status === "active")
      .map((c) => ({
        kind: "client" as const,
        id: c.id,
        name: c.name,
        initials: c.initials || initials(c.name),
        detail: c.programLabel ?? "Active client",
      })),
    ...(roster.data?.invited ?? [])
      .filter((p) => p.profileId !== profileId && p.readyCount > 0)
      .map((p) => ({
        kind: "profile" as const,
        id: p.profileId,
        name: p.displayName,
        initials: initials(p.displayName),
        detail: "Invited",
      })),
  ];

  const backTo = editing
    ? { to: base, label: detail.displayName }
    : { to: "/coach/clients", label: "Clients" };

  return (
    <>
      <SetupStepView
        clientFirst={clientFirst}
        backTo={backTo}
        onBackLink={() => void go(backTo.to)}
        editing={editing}
        rows={visible.map((s) => {
          const list = s === current ? items : itemsOf(detail, s);
          return {
            section: s,
            title: SECTION_TITLE[s],
            summary: checklistSummary(s, list, lib, detail.displayName),
            done: list.length > 0,
          };
        })}
        current={current}
        count={checklistCount(detail, visible)}
        offlineAsOf={online ? null : clockTime(detailQ.dataUpdatedAt)}
        notice={notice ?? (editable ? null : NOT_EDITABLE)}
        error={error}
        toast={toast}
        saving={saving}
        dirty={dirty}
        onSelect={(s) => void go(sectionUrl(s))}
        onCopyFrom={() => {
          setCopyError(null);
          setCopyOpen(true);
        }}
        onPreview={async () => {
          if (await saveCurrent()) preview.open();
        }}
        onCancel={() => {
          dropDraft(current);
          setError(null);
        }}
        onBack={() => void go(editing ? base : `${base}/who`)}
        onSkip={() => void go(`${base}/invite`)}
        onNext={() => void go(`${base}/invite`)}
      >
        {editor}
      </SetupStepView>
      {copyOpen && (
        <CopyFromDialog
          sources={sources}
          busy={copyBusy}
          error={copyError}
          clientFirst={clientFirst}
          onClose={() => setCopyOpen(false)}
          onCopy={async (source) => {
            if (!online) {
              setCopyError("You're offline. Copying needs a connection.");
              return;
            }
            setCopyBusy(true);
            setCopyError(null);
            try {
              const next = await api.copyFrom(
                profileId,
                source.kind === "client"
                  ? { sourceClientId: source.id }
                  : { sourceProfileId: source.id },
              );
              queryClient.setQueryData(detailKey, next);
              // The copy only replaces sections the source has: unsaved edits
              // in any other section stay, moved to the new revision.
              setDrafts((d) => {
                const kept: Drafts = {};
                for (const [s, dr] of Object.entries(d) as [
                  SetupSection,
                  Draft,
                ][]) {
                  if (sameItems(dr.base, itemsOf(next, s))) {
                    kept[s] = { ...dr, revision: next.revision };
                  }
                }
                return kept;
              });
              setCopyOpen(false);
              setToast(`Copied from ${source.name}`);
              void queryClient.invalidateQueries({
                queryKey: coachKeys.roster,
              });
            } catch (e) {
              setCopyError(
                isCoachApiError(e) && e.offline
                  ? "You're offline. Copying needs a connection."
                  : isCoachApiError(e)
                    ? e.message
                    : "We couldn't copy that set-up.",
              );
            } finally {
              setCopyBusy(false);
            }
          }}
        />
      )}
      {preview.panel}
    </>
  );
}

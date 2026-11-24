import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isCoachApiError, newIdempotencyKey } from "../api/coachApi";
import type { CoachForm, FormQuestion } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
} from "../hooks/coachQueries";
import {
  EDITED_ELSEWHERE,
  cleanQuestions,
  groupLibrary,
  newQuestion,
  newQuestionId,
  nextSend,
  questionProblems,
  sameQuestions,
  withType,
} from "../lib/forms";
import { LoadError, Loading } from "../ui/parts";
import { FormEditor } from "./FormEditor";
import { FormPreview } from "./FormsLibrary";

/**
 * Build or edit a form (C10b). `/coach/library/forms/new?when=weekly` saves
 * then opens the send dialog for that cadence; `/:formId/edit` saves a new
 * version with `expectedRevision` (409 → "Edited on another device").
 */
export function FormEditorContainer() {
  const api = useCoachApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const { formId } = useParams();
  const [search] = useSearchParams();
  const isNew = !formId;

  const forms = useQuery({
    queryKey: coachKeys.forms,
    queryFn: () => api.forms(),
    networkMode: COACH_NETWORK_MODE,
  });
  const schedules = useQuery({
    queryKey: coachKeys.schedules,
    queryFn: () => api.formSchedules(),
    networkMode: COACH_NETWORK_MODE,
    enabled: !isNew,
  });
  const stats = useQuery({
    queryKey: coachKeys.formStats,
    queryFn: () => api.formStats(),
    networkMode: COACH_NETWORK_MODE,
    enabled: !isNew,
  });

  const saved = forms.data?.find((f) => f.id === formId);
  const [base, setBase] = useState<CoachForm | null>(null);
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<FormQuestion[]>(() =>
    isNew ? [newQuestion([])] : [],
  );
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const key = useRef(newIdempotencyKey());

  // Start from the saved form once it's loaded.
  if (!isNew && saved && base === null) {
    setBase(saved);
    setTitle(saved.title);
    setQuestions(saved.version?.questions ?? []);
  }

  const problems = useMemo(() => questionProblems(questions), [questions]);
  const row = useMemo(() => {
    if (!saved) return null;
    const groups = groupLibrary([saved], schedules.data);
    return Object.values(groups).flat()[0] ?? null;
  }, [saved, schedules.data]);

  if (!isNew) {
    if (forms.isPending) return <Loading />;
    if (!saved) {
      return (
        <LoadError
          message={
            forms.data
              ? "This form isn't in your library."
              : online
                ? "We couldn't load this form."
                : "You're offline. This form loads when you're back online."
          }
          onRetry={() => void forms.refetch()}
        />
      );
    }
  }

  const dirty = isNew
    ? title.trim().length > 0 || questions.some((q) => q.prompt.trim())
    : !!base &&
      (title.trim() !== base.title ||
        !sameQuestions(questions, base.version?.questions ?? []));

  const main = row?.schedules[0];
  const reached = stats.data?.forms.find((f) => f.formId === formId)?.reached;
  const subtitle = isNew
    ? null
    : [
        `${questions.length} ${questions.length === 1 ? "question" : "questions"}`,
        base?.version ? `version ${base.version.version}` : null,
        main && reached
          ? `sent ${main.trigger === "weekly" || main.trigger === "daily" ? `${main.trigger} ` : ""}to ${reached} ${reached === 1 ? "client" : "clients"}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
  const banner =
    !isNew && reached
      ? {
          clients: reached,
          nextSend: main ? nextSend(main) : null,
        }
      : null;

  function update(next: FormQuestion[], select?: number) {
    setQuestions(next);
    if (select !== undefined) setSelected(select);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const clean = cleanQuestions(questions);
    try {
      if (isNew) {
        const created = await api.createForm(
          { title: title.trim(), questions: clean },
          key.current,
        );
        await queryClient.invalidateQueries({ queryKey: coachKeys.forms });
        const when = search.get("when");
        navigate(
          `/coach/library/forms/${created.id}${when ? `/send?when=${when}` : ""}`,
        );
        return;
      }
      const patch: { title?: string; questions?: FormQuestion[] } = {};
      if (title.trim() !== base!.title) patch.title = title.trim();
      if (!sameQuestions(questions, base!.version?.questions ?? [])) {
        patch.questions = clean;
      }
      const updated = await api.patchForm(formId!, patch, base!.revision);
      queryClient.setQueryData<CoachForm[]>(coachKeys.forms, (old) =>
        (old ?? []).map((f) => (f.id === updated.id ? updated : f)),
      );
      setBase(updated);
      setTitle(updated.title);
      setQuestions(updated.version?.questions ?? []);
      navigate(`/coach/library/forms/${updated.id}`);
    } catch (e) {
      if (isCoachApiError(e) && e.code === "revision_conflict") {
        const current = e.body?.current as CoachForm | undefined;
        if (current) {
          queryClient.setQueryData<CoachForm[]>(coachKeys.forms, (old) =>
            (old ?? []).map((f) => (f.id === current.id ? current : f)),
          );
          setBase(current);
          setTitle(current.title);
          setQuestions(current.version?.questions ?? []);
          setSelected(0);
        } else {
          setBase(null);
          void forms.refetch();
        }
        setNotice(EDITED_ELSEWHERE);
      } else if (isCoachApiError(e) && e.code === "invalid_questions") {
        setError("Some questions aren't valid. Check each one and try again.");
      } else {
        setError(
          isCoachApiError(e) && e.offline
            ? "You're offline. Your changes are still here; save when you're back online."
            : isCoachApiError(e)
              ? e.message
              : "We couldn't save this form. Try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <FormEditor
        isNew={isNew}
        title={title}
        subtitle={subtitle}
        banner={banner}
        questions={questions}
        selected={Math.min(selected, Math.max(questions.length - 1, 0))}
        problems={problems}
        dirty={dirty}
        busy={busy}
        offline={!online}
        notice={notice}
        error={error}
        onTitle={setTitle}
        onSelect={setSelected}
        onAdd={() =>
          update(
            [...questions, newQuestion(questions.map((q) => q.id))],
            questions.length,
          )
        }
        onChange={(i, q) => update(questions.map((x, j) => (j === i ? q : x)))}
        onType={(i, t) =>
          update(questions.map((x, j) => (j === i ? withType(x, t) : x)))
        }
        onDuplicate={(i) => {
          const copy = {
            ...questions[i]!,
            id: newQuestionId(questions.map((q) => q.id)),
          };
          update(
            [...questions.slice(0, i + 1), copy, ...questions.slice(i + 1)],
            i + 1,
          );
        }}
        onDelete={(i) =>
          update(
            questions.filter((_, j) => j !== i),
            Math.max(0, i - 1),
          )
        }
        onMove={(i, by) => {
          const j = i + by;
          if (j < 0 || j >= questions.length) return;
          const next = [...questions];
          [next[i], next[j]] = [next[j]!, next[i]!];
          update(next, j);
        }}
        onPreview={() => setPreview(true)}
        onSave={() => void save()}
      />
      {preview && (
        <FormPreview
          form={{
            title: title || "New form",
            version: { id: "draft", version: 0, questions },
          }}
          onClose={() => setPreview(false)}
        />
      )}
    </>
  );
}

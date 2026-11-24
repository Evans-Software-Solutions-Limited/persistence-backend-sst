import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  formConflictKey,
  type CoachForm,
  type Question,
} from "@/domain/models/coachForms";
import {
  draftProblem,
  duplicateQuestion,
  moveQuestion,
  newQuestion,
  plural,
  retypeQuestion,
} from "@/domain/services/coachForms.service";
import { resolveCoachFormsId } from "@/application/commands/coachForms.command";
import {
  useCoachFormConflicts,
  useCoachFormsActions,
  useCoachFormsLibrary,
} from "@/ui/hooks/useCoachForms";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { FormEditorPresenter } from "@/ui/presenters/coachForms/FormEditorPresenter";

type Draft = { title: string; description: string; questions: Question[] };

function draftFrom(form: CoachForm | null): Draft {
  if (!form) {
    return { title: "", description: "", questions: [newQuestion()] };
  }
  return {
    title: form.title,
    description: form.description ?? "",
    questions: (form.version?.questions ?? []).map((q) => ({ ...q })),
  };
}

/**
 * C10b editor. `/coach-forms/edit` for a new form (`?trigger=` carries a
 * C10g section's "+ Add" through to the send sheet), `?id=` to edit. A 409
 * already resolved by the queue shows "Edited on another device" with the
 * server copy loaded.
 */
export function CoachFormEditorContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; trigger?: string }>();
  const id = params.id ? resolveCoachFormsId(params.id) : null;
  const library = useCoachFormsLibrary();
  const actions = useCoachFormsActions();
  const { conflicts, dismiss } = useCoachFormConflicts();
  const online = useOnlineStatus();

  const form = id
    ? (library.data?.forms.find((f) => f.id === id) ?? null)
    : null;
  const conflictKey = id ? formConflictKey(id) : null;
  const conflict = conflicts.some((c) => c.key === conflictKey);

  const [draft, setDraft] = useState<Draft>(() => draftFrom(form));
  const [openIndex, setOpenIndex] = useState<number | null>(id ? null : 0);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // An edit opened before the library was read, or one whose server copy
  // just replaced ours (409): start from the cached form.
  const [loadedFrom, setLoadedFrom] = useState<string | null>(
    form ? `${form.id}:${form.revision}:${conflict}` : null,
  );
  useEffect(() => {
    if (!form) return;
    const key = `${form.id}:${form.revision}:${conflict}`;
    if (key === loadedFrom) return;
    if (loadedFrom === null || conflict) setDraft(draftFrom(form));
    setLoadedFrom(key);
  }, [form, conflict, loadedFrom]);

  const setQuestions = (questions: Question[]) =>
    setDraft((d) => ({ ...d, questions }));

  const onSave = useCallback(async () => {
    const payload = {
      ...(id ? { id } : {}),
      title: draft.title,
      description: draft.description,
      questions: draft.questions,
    };
    const issue = draftProblem(payload);
    setProblem(issue);
    if (issue) return;
    // Saving over the server copy acknowledges the conflict; a new 409 from
    // this save records a fresh one.
    if (conflictKey) dismiss(conflictKey);
    setSaving(true);
    const saved = await actions.saveForm(payload);
    setSaving(false);
    if (!saved) return;
    if (id) {
      router.back();
      return;
    }
    router.replace({
      pathname: "/(app)/coach-forms/[id]",
      params: {
        id: resolveCoachFormsId(saved.id),
        send: "1",
        ...(params.trigger ? { trigger: params.trigger } : {}),
      },
    } as never);
  }, [id, draft, actions, conflictKey, dismiss, router, params.trigger]);

  return (
    <FormEditorPresenter
      isNew={!id}
      title={draft.title}
      onTitle={(title) => setDraft((d) => ({ ...d, title }))}
      description={draft.description}
      onDescription={(description) => setDraft((d) => ({ ...d, description }))}
      meta={
        form?.version
          ? `${plural(draft.questions.length, "question")} · version ${form.version.version}`
          : null
      }
      questions={draft.questions}
      openIndex={openIndex}
      onOpen={setOpenIndex}
      onChangeQuestion={(i, q) =>
        setQuestions(draft.questions.map((x, xi) => (xi === i ? q : x)))
      }
      onRetype={(i, type) =>
        setQuestions(
          draft.questions.map((x, xi) =>
            xi === i ? retypeQuestion(x, type) : x,
          ),
        )
      }
      onMove={(i, dir) => {
        setQuestions(moveQuestion(draft.questions, i, dir));
        setOpenIndex(i + dir);
      }}
      onDuplicate={(i) => {
        const next = [...draft.questions];
        next.splice(i + 1, 0, duplicateQuestion(draft.questions[i]!));
        setQuestions(next);
        setOpenIndex(i + 1);
      }}
      onDelete={(i) => {
        setQuestions(draft.questions.filter((_, xi) => xi !== i));
        setOpenIndex(null);
      }}
      onAdd={() => {
        setQuestions([...draft.questions, newQuestion()]);
        setOpenIndex(draft.questions.length);
      }}
      problem={problem}
      saving={saving}
      onSave={() => void onSave()}
      onBack={() => router.back()}
      offline={!online}
      conflict={conflict}
      onDismissConflict={() => conflictKey && dismiss(conflictKey)}
    />
  );
}

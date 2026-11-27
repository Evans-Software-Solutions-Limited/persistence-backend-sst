import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocalSearchParams, useRouter } from "expo-router";

import type {
  AnswerValue,
  AthleteFormRequest,
  LocalFormState,
} from "@/domain/models/athleteForms";
import {
  isWaiting,
  nextJoiningForm,
} from "@/domain/services/athleteForms.service";
import { applyServerErrors, messageAt } from "@/shared/form";
import {
  answerDefaults,
  answerForm,
  fieldOf,
  firstErrorIndex,
  hasPhotoAnswer,
  photosToUpload,
  type AnswerValues,
} from "@/ui/forms/formAnswerForms";
import { pickFormPhoto } from "@/ui/hooks/formPhotoPicker";
import {
  useAthleteFormActions,
  useAthleteForms,
} from "@/ui/hooks/useAthleteForms";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { FormFillPresenter } from "@/ui/presenters/athleteForms/FormFillPresenter";

/** Copy for a form with photos that can't send right now (new, PER-130). */
export const PHOTOS_NEED_CONNECTION =
  "Photos need a connection to send. Your answers are saved on this phone.";
export const SEND_FAILED =
  "Couldn’t send it. Your answers are saved on this phone. Try again.";
export const PHOTO_UNREADABLE = "That photo can’t be read. Take it again.";
export const CHECK_ANSWERS = "Some answers need changing.";

const SAVE_DELAY_MS = 400;

/**
 * `/forms/[id]` — PER-130, canvas C4f: fill in one due form, one question per
 * screen. Works offline: the request and its questions come from the cache,
 * the draft is saved as you go, and Send queues the response. A form with a
 * photo needs a connection to send (upload first, then the response).
 * `?then=joining` carries on to the coach's next joining form (C10q).
 */
export function FormFillContainer() {
  const router = useRouter();
  const { id, then } = useLocalSearchParams<{ id: string; then?: string }>();
  const forms = useAthleteForms();
  const live = forms.requests.find((r) => r.id === id) ?? null;
  // Keep the request once seen: sending drops it from the cached list
  // before this screen has gone.
  const [request, setRequest] = useState<AthleteFormRequest | null>(live);
  useEffect(() => {
    if (live && live !== request) setRequest(live);
  }, [live, request]);
  const local = forms.locals.find((l) => l.requestId === id);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/coach");
  }, [router]);

  // Sent from this phone and still able to send: read-only, so it can't be
  // sent a second time (Inspector Brad, #571). Once its queue row dies the
  // hook shows it as a draft again and it's fillable.
  const waiting = isWaiting(local);
  if (!request || local?.closed || waiting) {
    return (
      <FormFillPresenter
        state={
          local?.closed
            ? "closed"
            : waiting
              ? "waiting"
              : forms.data === null && forms.error === null
                ? "loading"
                : "missing"
        }
        formTitle={local?.title ?? ""}
        step={0}
        total={0}
        question={null}
        value={null}
        error={null}
        saved={false}
        isLast={false}
        nextDisabled
        busy={false}
        banner={null}
        onChange={() => {}}
        onAddPhoto={() => {}}
        onBack={close}
        onNext={() => {}}
        onClose={close}
      />
    );
  }
  return (
    <FormFill
      key={request.id}
      request={request}
      local={local}
      joining={then === "joining"}
      onClose={close}
      openNext={(next) =>
        router.replace({
          pathname: "/(app)/forms/[id]",
          params: { id: next.id, then: "joining" },
        } as never)
      }
      nextJoining={(after) =>
        nextJoiningForm(forms.requests, forms.locals, request.coach.id, after)
      }
    />
  );
}

function FormFill(p: {
  request: AthleteFormRequest;
  local: LocalFormState | undefined;
  joining: boolean;
  onClose(): void;
  openNext(next: AthleteFormRequest): void;
  nextJoining(afterId: string): AthleteFormRequest | null;
}) {
  const { request } = p;
  const questions = request.version.questions;
  const actions = useAthleteFormActions();
  const online = useOnlineStatus();
  const form = useMemo(() => answerForm(questions), [questions]);
  const rhf = useForm<AnswerValues>({
    resolver: form.resolver,
    defaultValues: answerDefaults(questions, p.local?.answers),
    mode: "onChange",
  });
  const total = questions.length;
  const [step, setStep] = useState(() =>
    Math.min(Math.max(p.local?.step ?? 0, 0), Math.max(total - 1, 0)),
  );
  const [saved, setSaved] = useState(
    !!p.local && Object.keys(p.local.answers).length > 0,
  );
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const values = rhf.watch();
  const field = fieldOf(step);
  const sendingRef = useRef(false);

  /** The first question showing an error, read straight from the form. */
  const firstError = useCallback(() => {
    const errors: Record<string, unknown> = {};
    questions.forEach((_q, i) => {
      const e = rhf.getFieldState(fieldOf(i)).error;
      if (e) errors[fieldOf(i)] = e;
    });
    return firstErrorIndex(questions, errors);
  }, [questions, rhf]);

  const showErrors = useCallback(
    (error: unknown) => {
      if (applyServerErrors(error, rhf.setError, form.serverMap)) {
        const first = firstError();
        if (first !== null) setStep(first);
      }
      setBanner(CHECK_ANSWERS);
    },
    [rhf, form, firstError],
  );

  // A queued send the server refused (422) comes back with its errors,
  // shown once when the screen opens.
  const rejected = p.local?.rejected;
  const shownRejection = useRef(false);
  useEffect(() => {
    if (!rejected || shownRejection.current) return;
    shownRejection.current = true;
    showErrors(rejected);
  }, [rejected, showErrors]);

  // "Saved as you go": once something changes, the draft follows the
  // answers and the question shown.
  const saveDraft = actions.saveDraft;
  const snapshot = JSON.stringify(values);
  const initial = useRef({ snapshot, step });
  const savedOnce = useRef(false);
  useEffect(() => {
    if (sendingRef.current) return;
    if (
      snapshot === initial.current.snapshot &&
      step === initial.current.step
    ) {
      return;
    }
    // The first change saves at once: on a send whose queue row died, that
    // save is what retires the row before a reconnect could revive it
    // with the old answers (Inspector Brad, #571).
    const timer = setTimeout(
      () => {
        savedOnce.current = true;
        saveDraft(request, rhf.getValues(), step);
        setSaved(true);
      },
      savedOnce.current ? SAVE_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [snapshot, step, request, rhf, saveDraft]);

  const done = () => {
    if (p.joining) {
      const next = p.nextJoining(request.id);
      if (next) return p.openNext(next);
    }
    p.onClose();
  };

  const send = async (answers: AnswerValues) => {
    if (sendingRef.current) return;
    setBanner(null);
    if (!hasPhotoAnswer(questions, answers)) {
      sendingRef.current = true;
      actions.queueSend(request, answers, form.toApiAnswers(answers));
      done();
      return;
    }
    if (!online) {
      setBanner(PHOTOS_NEED_CONNECTION);
      return;
    }
    sendingRef.current = true;
    setBusy(true);
    const photos = photosToUpload(questions, answers).map((x) => ({
      field: fieldOf(x.index),
      uri: x.uri,
    }));
    const { outcome, draft } = await actions.sendNow(
      request,
      answers,
      photos,
      form.toApiAnswers,
    );
    setBusy(false);
    // Uploaded photos keep their media ids, so a retry doesn't redo them.
    for (const [key, value] of Object.entries(draft)) {
      if (value !== answers[key]) rhf.setValue(key, value);
    }
    if (outcome.kind === "sent") return done();
    sendingRef.current = false;
    if (outcome.kind === "closed") return setClosed(true);
    if (outcome.kind === "invalid") return showErrors(outcome.error);
    setBanner(outcome.reason === "photo" ? PHOTO_UNREADABLE : SEND_FAILED);
  };

  const onNext = async () => {
    if (!form.accepts(values, step)) {
      await rhf.trigger(field);
      return;
    }
    if (step < total - 1) {
      setStep(step + 1);
      return;
    }
    await rhf.handleSubmit(send, (errors) => {
      const first = firstErrorIndex(questions, errors);
      if (first !== null) setStep(first);
    })();
  };

  const onBack = () => {
    if (step === 0) return p.onClose();
    setStep(step - 1);
  };

  const onChange = (value: AnswerValue) => {
    rhf.setValue(field, value, { shouldDirty: true, shouldValidate: true });
  };

  const onAddPhoto = async () => {
    const uri = await pickFormPhoto();
    if (uri) onChange({ uri, mediaId: null });
  };

  const question = questions[step] ?? null;
  return (
    <FormFillPresenter
      state={closed ? "closed" : "form"}
      formTitle={request.title}
      step={step}
      total={total}
      question={question}
      value={values[field] ?? null}
      error={messageAt(rhf.formState.errors, field) ?? null}
      saved={saved}
      isLast={step === total - 1}
      nextDisabled={
        question !== null && question.required && !form.accepts(values, step)
      }
      busy={busy}
      banner={banner}
      onChange={onChange}
      onAddPhoto={() => void onAddPhoto()}
      onBack={onBack}
      onNext={() => void onNext()}
      onClose={p.onClose}
    />
  );
}

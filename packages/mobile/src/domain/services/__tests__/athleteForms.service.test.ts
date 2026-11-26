import type {
  AthleteFormRequest,
  LocalFormState,
} from "@/domain/models/athleteForms";
import type { Question } from "@/domain/models/coachForms";
import {
  clockTime,
  coachFormsView,
  dayTime,
  dueCount,
  dueLine,
  hasPhotoQuestion,
  joinHeadline,
  joinSummary,
  joiningForms,
  lateNote,
  minutesFor,
  nextJoiningForm,
  offlineLine,
  pastDay,
  shouldShowJoinIntro,
  sizeLine,
} from "../athleteForms.service";

// Thursday 26 Nov 2026, 09:00 local.
const NOW = new Date(2026, 10, 26, 9, 0);
const at = (d: number, h = 12, m = 0) =>
  new Date(2026, 10, d, h, m).toISOString();

const q = (
  type: Question["type"],
  extra: Partial<Question> = {},
): Question => ({
  id: `${type}-${Math.random()}`,
  type,
  prompt: type,
  required: false,
  ...extra,
});

function req(
  id: string,
  extra: Partial<AthleteFormRequest> = {},
): AthleteFormRequest {
  return {
    id,
    formId: `f-${id}`,
    title: `Form ${id}`,
    description: null,
    coach: { id: "ellie", name: "Ellie Hart" },
    trigger: "weekly",
    periodKey: "p",
    sentAt: at(23),
    dueAt: null,
    closesAt: null,
    status: "pending",
    late: false,
    version: { id: "v", version: 1, questions: [q("scale"), q("short_text")] },
    ...extra,
  };
}

function loc(id: string, extra: Partial<LocalFormState> = {}): LocalFormState {
  return {
    requestId: id,
    title: `Form ${id}`,
    coachId: "ellie",
    trigger: "weekly",
    answers: {},
    step: 0,
    updatedAt: at(26, 8),
    submittedAt: null,
    sentAt: null,
    closed: false,
    rejected: null,
    submitKey: null,
    uploadKeys: {},
    introSeen: false,
    ...extra,
  };
}

describe("times", () => {
  it("clock, day + time within a week, date beyond", () => {
    expect(clockTime(at(26, 8, 12))).toBe("08:12");
    expect(clockTime("nope")).toBe("");
    expect(dayTime(at(24), NOW)).toBe("Tue 12:00");
    expect(dayTime(at(30), NOW)).toBe("Mon 12:00");
    expect(dayTime(at(12), NOW)).toBe("12 Nov 12:00");
    expect(dayTime("bad", NOW)).toBe("");
  });

  it("past days: today, yesterday, last weekday, then a date", () => {
    expect(pastDay(at(26, 7), NOW)).toBe("today");
    expect(pastDay(at(25), NOW)).toBe("yesterday");
    expect(pastDay(at(22), NOW)).toBe("last Sunday");
    expect(pastDay(at(12), NOW)).toBe("12 Nov");
    expect(pastDay("bad", NOW)).toBe("");
  });
});

describe("size of a form (C10p)", () => {
  it("counts questions and minutes, and says when there are photos", () => {
    const questions = [
      q("short_text"),
      q("photo"),
      q("yes_no", { detailsIfYes: true }),
    ];
    expect(minutesFor(questions)).toBe(2);
    expect(minutesFor([])).toBe(1);
    expect(sizeLine(questions)).toBe("3 questions · about 2 min · photos");
    expect(sizeLine([q("scale")])).toBe("1 question · about 1 min");
    expect(hasPhotoQuestion(questions)).toBe(true);
    expect(hasPhotoQuestion([q("number")])).toBe(false);
  });
});

describe("due line (C10p / C10r)", () => {
  it("today, tomorrow, a weekday, none", () => {
    expect(dueLine({ dueAt: at(26, 18), status: "pending" }, NOW)).toEqual({
      text: "Due today 18:00",
      tone: "due",
    });
    expect(dueLine({ dueAt: at(27), status: "pending" }, NOW)).toEqual({
      text: "Due tomorrow 12:00",
      tone: "due",
    });
    expect(dueLine({ dueAt: at(30), status: "pending" }, NOW).text).toBe(
      "Due Mon 12:00",
    );
    expect(dueLine({ dueAt: null, status: "pending" }, NOW)).toEqual({
      text: "No due date",
      tone: "none",
    });
  });

  it("late: missed, or past due before the server marks it", () => {
    expect(dueLine({ dueAt: at(24), status: "missed" }, NOW)).toEqual({
      text: "Late · was due Tue 12:00",
      tone: "late",
    });
    expect(dueLine({ dueAt: at(26, 8), status: "pending" }, NOW).tone).toBe(
      "late",
    );
    expect(dueLine({ dueAt: null, status: "missed" }, NOW)).toEqual({
      text: "Late",
      tone: "late",
    });
  });

  it("late note: until when it can still be sent", () => {
    expect(lateNote({ closesAt: at(30) }, NOW)).toBe(
      "You can still send it until Monday",
    );
    expect(lateNote({ closesAt: at(26, 18) }, NOW)).toBe(
      "You can still send it until 18:00 today",
    );
    expect(lateNote({ closesAt: at(10 + 30) }, NOW)).toMatch(/until \d+ Dec/);
    expect(lateNote({ closesAt: null }, NOW)).toBeNull();
    expect(lateNote({ closesAt: "bad" }, NOW)).toBeNull();
  });
});

describe("coachFormsView", () => {
  it("to fill in: this coach's forms not sent, late ones with their note", () => {
    const view = coachFormsView({
      requests: [
        req("a", { dueAt: at(27) }),
        req("b", { status: "missed", dueAt: at(24), closesAt: at(30) }),
        req("c", { coach: { id: "marcus", name: "Marcus" } }),
        req("d"),
        req("e"),
      ],
      locals: [
        loc("a", { answers: { q0: 3 } }),
        loc("d", { submittedAt: at(26, 8, 12) }),
        loc("e", { submittedAt: at(25), rejected: { status: 422 } }),
      ],
      coachId: "ellie",
      now: NOW,
    });
    expect(view.toFill.map((c) => c.requestId)).toEqual(["a", "b", "e"]);
    expect(view.toFill[0]).toMatchObject({
      started: true,
      due: { text: "Due tomorrow 12:00", tone: "due" },
      detail: "2 questions · about 1 min",
    });
    expect(view.toFill[1]).toMatchObject({
      started: false,
      detail: "You can still send it until Monday",
    });
    expect(view.done.map((d) => d.requestId)).toEqual(["d"]);
    expect(view.waitingTitles).toEqual(["Form d"]);
  });

  it("done: waiting, sent today, sent earlier, no longer needed — newest first, five at most", () => {
    const locals = [
      loc("w", { submittedAt: at(26, 8, 12) }),
      loc("s", { submittedAt: at(26, 7, 50), sentAt: at(26, 7, 58) }),
      loc("old", { submittedAt: at(22, 10, 10), sentAt: at(22, 10, 14) }),
      loc("x", { closed: true, submittedAt: at(21) }),
      loc("y", { submittedAt: at(20), sentAt: at(20) }),
      loc("z", { submittedAt: at(19), sentAt: at(19) }),
      loc("other", { coachId: "marcus", submittedAt: at(26), sentAt: at(26) }),
    ];
    const view = coachFormsView({
      requests: [],
      locals,
      coachId: "ellie",
      now: NOW,
    });
    expect(view.done.map((d) => d.requestId)).toEqual([
      "w",
      "s",
      "old",
      "x",
      "y",
    ]);
    expect(view.done[0]).toEqual({
      requestId: "w",
      title: "Form w · today",
      subtitle: "Waiting to send · saved 08:12",
      waiting: true,
      closed: false,
    });
    expect(view.done[1]!.subtitle).toBe("Sent 07:58");
    expect(view.done[2]).toMatchObject({
      title: "Form old · last Sunday",
      subtitle: "Sent Sun 10:14",
    });
    expect(view.done[3]).toMatchObject({
      subtitle: "This check-in is no longer needed",
      closed: true,
    });
    expect(view.waitingTitles).toEqual(["Form w"]);
  });

  it("offline line names what waits to send", () => {
    expect(offlineLine(["Daily check-in"])).toBe(
      "You’re offline. Daily check-in is saved on this phone and sends when you’re back.",
    );
    expect(offlineLine(["a", "b"])).toBe(
      "You’re offline. 2 forms are saved on this phone and send when you’re back.",
    );
    expect(offlineLine([])).toMatch(/^You’re offline. Forms you fill in/);
  });

  it("badge count across coaches", () => {
    expect(
      dueCount(
        [req("a"), req("b"), req("c", { coach: { id: "m", name: null } })],
        [loc("a", { closed: true })],
      ),
    ).toBe(2);
  });
});

describe("joining forms (C10q)", () => {
  const requests = [
    req("j1", { trigger: "on_join" }),
    req("w", { trigger: "weekly" }),
    req("j2", { trigger: "on_join" }),
    req("j3", { trigger: "on_join", coach: { id: "marcus", name: "M" } }),
  ];

  it("one coach's joining forms in order, not yet sent", () => {
    expect(joiningForms(requests, [], "ellie").map((r) => r.id)).toEqual([
      "j1",
      "j2",
    ]);
    expect(
      joiningForms(requests, [loc("j1", { submittedAt: at(26) })], "ellie").map(
        (r) => r.id,
      ),
    ).toEqual(["j2"]);
  });

  it("opens by itself only while none has been seen or started", () => {
    const joining = joiningForms(requests, [], "ellie");
    expect(shouldShowJoinIntro(joining, [])).toBe(true);
    expect(shouldShowJoinIntro(joining, [loc("j1")])).toBe(true);
    expect(shouldShowJoinIntro(joining, [loc("j2", { introSeen: true })])).toBe(
      false,
    );
    expect(
      shouldShowJoinIntro(joining, [loc("j1", { answers: { q0: "x" } })]),
    ).toBe(false);
    expect(shouldShowJoinIntro([], [])).toBe(false);
  });

  it("headline, strip and the next one", () => {
    expect(joinHeadline(2)).toBe("Two forms to get started");
    expect(joinHeadline(1)).toBe("One form to get started");
    expect(joinHeadline(12)).toBe("12 forms to get started");
    expect(joinSummary(joiningForms(requests, [], "ellie"))).toEqual({
      forms: 2,
      questions: 4,
      minutes: 2,
    });
    expect(nextJoiningForm(requests, [], "ellie", "j1")?.id).toBe("j2");
    expect(nextJoiningForm(requests, [], "ellie", "j2")?.id).toBe("j1");
    expect(
      nextJoiningForm(
        requests,
        [loc("j1", { submittedAt: at(26) })],
        "ellie",
        "j2",
      ),
    ).toBeNull();
  });
});

import { useRef, useState, type ReactNode } from "react";
import type {
  CoachForm,
  FormSchedule,
  MealPlan,
  RuleOverride,
  SetupItem,
} from "../api/types";
import {
  WEEKDAY_ABBR,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  effectiveRule,
  hoursUntil,
  normaliseReminders,
  overrideFrom,
  pointAfter,
  MAX_REMINDERS,
  type EffectiveRule,
} from "../lib/schedule";
import {
  formMeta,
  formatKcal,
  planMeta,
  questionTypeLabel,
  targetNumbers,
} from "../lib/setup";
import {
  IconChevronDown,
  IconForm,
  IconGrip,
  IconPlus,
  IconX,
} from "../ui/icons";

/**
 * The right-hand pane of the set-up step (C11b and the clickable prototype),
 * one editor per section. Pure: each takes the section's items and reports a
 * new list. The container decides when that becomes a save.
 */

interface EditorBase {
  items: SetupItem[];
  onChange: (items: SetupItem[]) => void;
  disabled: boolean;
  clientFirst: string;
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h2 className="h2">{title}</h2>
      <span
        style={{
          display: "block",
          fontSize: 13,
          lineHeight: "18px",
          color: "var(--muted)",
          margin: "2px 0 10px",
        }}
      >
        {sub}
      </span>
    </>
  );
}

const renumber = (items: SetupItem[]) =>
  items.map((item, i) => ({ ...item, sortOrder: i }));

function Questions({ form }: { form: CoachForm | undefined }) {
  const [open, setOpen] = useState(false);
  const questions = form?.version?.questions ?? [];
  if (questions.length === 0) return null;
  const shown = questions.slice(0, 5);
  return (
    <div style={{ paddingLeft: 26 }}>
      <button
        type="button"
        className="lk quiet"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide questions" : "Show questions"}
        <span
          style={{
            display: "inline-flex",
            transform: open ? "rotate(180deg)" : undefined,
          }}
        >
          <IconChevronDown size={14} />
        </span>
      </button>
      {open && (
        <>
          {shown.map((q, i) => (
            <div className="q-row" key={q.id}>
              <span className="num mono">{i + 1}</span>
              <span className="p">{q.prompt}</span>
              <span className="t">{questionTypeLabel(q.type)}</span>
            </div>
          ))}
          {questions.length > shown.length && (
            <span className="hint">
              +{questions.length - shown.length} more questions
            </span>
          )}
        </>
      )}
    </div>
  );
}

function Picker({
  label,
  empty,
  children,
  count,
  disabled,
}: {
  label: string;
  empty: string;
  count: number;
  disabled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="lk"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <IconPlus size={16} />
        {label}
      </button>
      {open &&
        (count === 0 ? (
          <p className="hint">{empty}</p>
        ) : (
          <div role="list" aria-label={label}>
            {children}
          </div>
        ))}
    </div>
  );
}

// ─── Starter forms ───────────────────────────────────────────────────────────

export function StarterFormsEditor({
  items,
  onChange,
  disabled,
  clientFirst,
  forms,
}: EditorBase & { forms: CoachForm[] }) {
  const byId = new Map(forms.map((f) => [f.id, f]));
  const dragFrom = useRef<number | null>(null);
  const chosen = new Set(items.map((i) => i.refId));
  const available = forms.filter((f) => !chosen.has(f.id) && !f.archivedAt);
  return (
    <>
      <Heading
        title="Starter forms"
        sub={`Your usual starter forms, sent together when ${clientFirst} accepts. Drag to reorder.`}
      />
      {items.map((item, index) => {
        const form = byId.get(item.refId ?? "");
        const title = form?.title ?? "Form";
        return (
          <section
            key={item.refId ?? index}
            className="sec-block"
            draggable={!disabled}
            onDragStart={() => {
              dragFrom.current = index;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const from = dragFrom.current;
              dragFrom.current = null;
              if (from === null || from === index) return;
              const next = [...items];
              const [moved] = next.splice(from, 1);
              next.splice(index, 0, moved);
              onChange(renumber(next));
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  color: "var(--muted)",
                  cursor: disabled ? undefined : "grab",
                }}
              >
                <IconGrip size={16} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: "block", fontSize: 15 }}>{title}</b>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {formMeta(form)}
                </span>
              </span>
              <button
                type="button"
                className="ibtn danger"
                aria-label={`Remove ${title}`}
                disabled={disabled}
                onClick={() =>
                  onChange(renumber(items.filter((_, i) => i !== index)))
                }
              >
                <IconX size={16} />
              </button>
            </div>
            <Questions form={form} />
          </section>
        );
      })}
      <Picker
        label="Add a form from your Library"
        empty="No forms in your Library yet."
        count={available.length}
        disabled={disabled}
      >
        {available.map((f) => (
          <div className="row" role="listitem" key={f.id}>
            <IconForm size={16} />
            <span className="tx">
              <span className="n">{f.title}</span>
              <span className="s">{formMeta(f)}</span>
            </span>
            <button
              type="button"
              className="act"
              disabled={disabled}
              onClick={() =>
                onChange(
                  renumber([
                    ...items,
                    { refId: f.id, config: {}, sortOrder: items.length },
                  ]),
                )
              }
            >
              Add
            </button>
          </div>
        ))}
      </Picker>
    </>
  );
}

// ─── Repeating check-ins ─────────────────────────────────────────────────────

function DayTime({
  label,
  weekly,
  weekday,
  time,
  onChange,
  disabled,
}: {
  label: string;
  weekly: boolean;
  weekday: number | null;
  time: string;
  onChange: (v: { weekday: number | null; time: string }) => void;
  disabled: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      {weekly && (
        <select
          className="fld"
          style={{ width: "auto" }}
          aria-label={`${label} day`}
          value={weekday ?? 1}
          disabled={disabled}
          onChange={(e) => onChange({ weekday: Number(e.target.value), time })}
        >
          {WEEKDAY_LONG.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}
            </option>
          ))}
        </select>
      )}
      <input
        className="fld"
        type="time"
        style={{ width: "auto" }}
        aria-label={`${label} time`}
        value={time}
        disabled={disabled}
        onChange={(e) => onChange({ weekday, time: e.target.value })}
      />
    </span>
  );
}

function RuleEditor({
  schedule,
  rule,
  onRule,
  disabled,
}: {
  schedule: FormSchedule;
  rule: EffectiveRule;
  onRule: (rule: EffectiveRule) => void;
  disabled: boolean;
}) {
  const weekly = rule.trigger === "weekly";
  const timed = weekly || rule.trigger === "daily";
  const point = (h: number) =>
    pointAfter(rule, h) ?? {
      weekday: rule.weekday,
      time: rule.timeLocal ?? "09:00",
    };
  const toHours = (v: { weekday: number | null; time: string }) =>
    hoursUntil(rule, { weekday: weekly ? v.weekday : null, time: v.time });
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        paddingLeft: 26,
        marginTop: 6,
      }}
    >
      <div>
        <span className="fl">How often</span>
        <div className="seg" role="group" aria-label="How often">
          {(["once", "weekly", "daily"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={schedule.trigger === t}
              disabled
            >
              {t === "once" ? "Once" : t === "weekly" ? "Weekly" : "Daily"}
            </button>
          ))}
        </div>
        <span className="hint">Set on the send rule in your Library.</span>
      </div>
      {weekly && (
        <div>
          <span className="fl">Day</span>
          <div
            style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
            role="group"
            aria-label="Day"
          >
            {WEEKDAY_SHORT.map((d, i) => (
              <button
                key={d}
                type="button"
                className="day"
                aria-pressed={rule.weekday === i + 1}
                aria-label={WEEKDAY_LONG[i]}
                disabled={disabled}
                onClick={() => onRule({ ...rule, weekday: i + 1 })}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
      {timed && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <label>
            <span className="fl">Time</span>
            <input
              className="fld"
              type="time"
              style={{ width: "auto" }}
              value={rule.timeLocal ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onRule({ ...rule, timeLocal: e.target.value || null })
              }
            />
          </label>
          <div>
            <span className="fl">Due</span>
            <DayTime
              label="Due"
              weekly={weekly}
              weekday={point(rule.dueAfterHours ?? 24).weekday}
              time={point(rule.dueAfterHours ?? 24).time}
              disabled={disabled}
              onChange={(v) => onRule({ ...rule, dueAfterHours: toHours(v) })}
            />
          </div>
        </div>
      )}
      {timed && (
        <div>
          <span className="fl">Reminders</span>
          {rule.reminders.map((r, i) => {
            const p = point(r.afterHours);
            return (
              <div
                key={`${r.afterHours}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <DayTime
                  label={`Reminder ${i + 1}`}
                  weekly={weekly}
                  weekday={p.weekday}
                  time={p.time}
                  disabled={disabled}
                  onChange={(v) => {
                    const h = toHours(v);
                    if (h === null) return;
                    onRule({
                      ...rule,
                      reminders: normaliseReminders(
                        rule.reminders.map((x, j) =>
                          j === i ? { afterHours: h } : x,
                        ),
                      ),
                    });
                  }}
                />
                <span className="hint" style={{ margin: 0 }}>
                  if not done
                </span>
                <button
                  type="button"
                  className="ibtn danger"
                  aria-label={`Remove reminder ${i + 1}`}
                  disabled={disabled}
                  onClick={() =>
                    onRule({
                      ...rule,
                      reminders: rule.reminders.filter((_, j) => j !== i),
                    })
                  }
                >
                  <IconX size={16} />
                </button>
              </div>
            );
          })}
          {rule.reminders.length < MAX_REMINDERS && (
            <button
              type="button"
              className="lk"
              disabled={disabled}
              onClick={() => {
                const last =
                  rule.reminders[rule.reminders.length - 1]?.afterHours ?? 8;
                onRule({
                  ...rule,
                  reminders: normaliseReminders([
                    ...rule.reminders,
                    { afterHours: Math.min(720, last + 12) },
                  ]),
                });
              }}
            >
              + Add reminder
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function RepeatingCheckinsEditor({
  items,
  onChange,
  disabled,
  clientFirst,
  forms,
  schedules,
}: EditorBase & { forms: CoachForm[]; schedules: FormSchedule[] }) {
  const formById = new Map(forms.map((f) => [f.id, f]));
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const chosen = new Set(items.map((i) => i.refId));
  const available = schedules.filter(
    (s) =>
      !chosen.has(s.id) &&
      s.status !== "stopped" &&
      s.audience === "selected" &&
      ["once", "weekly", "daily"].includes(s.trigger),
  );
  const first = items[0]?.refId ? scheduleById.get(items[0].refId) : undefined;
  const firstRule = first
    ? effectiveRule(first, items[0].config.override as RuleOverride)
    : null;
  const starts =
    firstRule?.trigger === "weekly" && firstRule.weekday
      ? `Starts the first ${WEEKDAY_LONG[firstRule.weekday - 1]} after ${clientFirst} accepts.`
      : `Starts when ${clientFirst} accepts.`;
  return (
    <>
      <Heading
        title="Repeating check-ins"
        sub={`For ${clientFirst} only. ${starts}`}
      />
      {items.map((item, index) => {
        const schedule = item.refId ? scheduleById.get(item.refId) : undefined;
        const form = schedule ? formById.get(schedule.formId) : undefined;
        const title = form?.title ?? "Check-in";
        const rule = schedule
          ? effectiveRule(schedule, item.config.override as RuleOverride)
          : null;
        return (
          <section key={item.refId ?? index} className="sec-block">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <IconForm size={16} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: "block", fontSize: 15 }}>{title}</b>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {form?.version?.questions.length ?? 0} questions
                </span>
              </span>
              <button
                type="button"
                className="ibtn danger"
                aria-label={`Remove ${title}`}
                disabled={disabled}
                onClick={() =>
                  onChange(renumber(items.filter((_, i) => i !== index)))
                }
              >
                <IconX size={16} />
              </button>
            </div>
            <Questions form={form} />
            {schedule && rule && (
              <RuleEditor
                schedule={schedule}
                rule={rule}
                disabled={disabled}
                onRule={(next) => {
                  const override = overrideFrom(schedule, next);
                  onChange(
                    items.map((it, i) =>
                      i === index
                        ? { ...it, config: override ? { override } : {} }
                        : it,
                    ),
                  );
                }}
              />
            )}
          </section>
        );
      })}
      <Picker
        label="Add a check-in from your Library"
        empty="No repeating check-ins in your Library yet."
        count={available.length}
        disabled={disabled}
      >
        {available.map((s) => {
          const title = formById.get(s.formId)?.title ?? "Check-in";
          const when =
            s.trigger === "weekly" && s.weekday
              ? `Weekly · ${WEEKDAY_ABBR[s.weekday - 1]} ${s.timeLocal ?? ""}`
              : s.trigger === "daily"
                ? `Daily · ${s.timeLocal ?? ""}`
                : "Once";
          return (
            <div className="row" role="listitem" key={s.id}>
              <IconForm size={16} />
              <span className="tx">
                <span className="n">{title}</span>
                <span className="s">{when}</span>
              </span>
              <button
                type="button"
                className="act"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    renumber([
                      ...items,
                      { refId: s.id, config: {}, sortOrder: items.length },
                    ]),
                  )
                }
              >
                Add
              </button>
            </div>
          );
        })}
      </Picker>
    </>
  );
}

// ─── Calorie and macro targets ───────────────────────────────────────────────

const MACROS = [
  ["proteinG", "Protein"],
  ["carbsG", "Carbs"],
  ["fatG", "Fat"],
] as const;

function numOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function TargetsEditor({
  items,
  onChange,
  disabled,
  clientFirst,
  error,
}: EditorBase & { error: string | null }) {
  const coachSets = items.length > 0;
  const numbers = targetNumbers(items[0]);
  const [editing, setEditing] = useState(!numbers);
  const config = items[0]?.config ?? {};
  const set = (key: string, raw: string) =>
    onChange([
      {
        refId: null,
        sortOrder: 0,
        config: { ...config, [key]: numOrNull(raw) },
      },
    ]);
  const value = (key: string) =>
    typeof config[key] === "number" ? String(config[key]) : "";
  return (
    <>
      <Heading
        title="Calorie and macro targets"
        sub={`${clientFirst}'s meal plans and Fuel build toward these.`}
      />
      <div className="seg" role="radiogroup" aria-label="Who sets the targets">
        <button
          type="button"
          role="radio"
          aria-checked={coachSets}
          disabled={disabled}
          onClick={() => {
            if (!coachSets) {
              setEditing(true);
              onChange([{ refId: null, sortOrder: 0, config: {} }]);
            }
          }}
        >
          You set them
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!coachSets}
          disabled={disabled}
          onClick={() => onChange([])}
        >
          {clientFirst} sets them
        </button>
      </div>
      {coachSets && (
        <div
          style={{
            marginTop: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {editing || !numbers ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label>
                <span className="fl">kcal a day</span>
                <input
                  className="fld num mono"
                  inputMode="numeric"
                  value={value("dailyKcal")}
                  disabled={disabled}
                  aria-invalid={!!error && value("dailyKcal") === ""}
                  onChange={(e) => set("dailyKcal", e.target.value)}
                />
              </label>
              {MACROS.map(([key, label]) => (
                <label key={key}>
                  <span className="fl">{label}, g</span>
                  <input
                    className="fld num mono"
                    inputMode="numeric"
                    value={value(key)}
                    disabled={disabled}
                    aria-invalid={!!error && value(key) === ""}
                    onChange={(e) => set(key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="big-num">{formatKcal(numbers.dailyKcal)}</span>
                <span className="sub">kcal a day</span>
              </div>
              <div className="macro-grid">
                {MACROS.map(([key, label]) => (
                  <div key={key}>
                    <b>
                      {formatKcal(numbers[key])}
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          marginLeft: 2,
                          letterSpacing: 0,
                          textTransform: "none",
                        }}
                      >
                        g
                      </span>
                    </b>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="lk"
                disabled={disabled}
                onClick={() => setEditing(true)}
              >
                Edit numbers
              </button>
            </>
          )}
          {error && <span className="err">{error}</span>}
          <span className="hint">
            Training and rest days can differ: set that in {clientFirst}'s
            Nutrition tab after they accept.
          </span>
        </div>
      )}
    </>
  );
}

// ─── Meal plan ───────────────────────────────────────────────────────────────

export function MealPlanEditor({
  items,
  onChange,
  disabled,
  clientFirst,
  plans,
}: EditorBase & { plans: MealPlan[] }) {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const chosen = new Set(items.map((i) => i.refId));
  const available = plans.filter((p) => !chosen.has(p.id));
  return (
    <>
      <Heading
        title="Meal plan"
        sub={`A list of meal ideas toward ${clientFirst}'s target. Optional.`}
      />
      {items.length === 0 && (
        <p className="sub" style={{ margin: "4px 0 8px" }}>
          No meal plan added. Pick one from your Library, or skip this.
        </p>
      )}
      {items.map((item, index) => {
        const plan = byId.get(item.refId ?? "");
        const name = plan?.name ?? "Meal plan";
        return (
          <div className="row" key={item.refId ?? index}>
            <span className="tx">
              <span className="n">{name}</span>
              <span className="s">{planMeta(plan)}</span>
            </span>
            <button
              type="button"
              className="lk danger"
              aria-label={`Remove ${name}`}
              disabled={disabled}
              onClick={() =>
                onChange(renumber(items.filter((_, i) => i !== index)))
              }
            >
              Remove
            </button>
          </div>
        );
      })}
      {available.length === 0 && plans.length === 0 ? (
        <p className="hint">No meal plans in your Library yet.</p>
      ) : (
        available.map((p) => (
          <div className="row" key={p.id}>
            <span className="tx">
              <span className="n">{p.name}</span>
              <span className="s">{planMeta(p)}</span>
            </span>
            <button
              type="button"
              className="act"
              disabled={disabled}
              onClick={() =>
                onChange(
                  renumber([
                    ...items,
                    { refId: p.id, config: {}, sortOrder: items.length },
                  ]),
                )
              }
            >
              Add
            </button>
          </div>
        ))
      )}
    </>
  );
}

// ─── Welcome message ─────────────────────────────────────────────────────────

const WELCOME_MAX = 1000;

export function WelcomeEditor({
  items,
  onChange,
  disabled,
  clientFirst,
}: EditorBase) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = String((items[0]?.config.text as string | undefined) ?? "");
  const setText = (next: string) =>
    onChange(
      next === ""
        ? []
        : [{ refId: null, sortOrder: 0, config: { text: next } }],
    );
  return (
    <>
      <Heading
        title="Welcome message"
        sub={`Sent from you the moment ${clientFirst} accepts.`}
      />
      <label htmlFor="welcome-text" className="fl">
        Message
      </label>
      <textarea
        id="welcome-text"
        ref={ref}
        className="fld"
        rows={5}
        maxLength={WELCOME_MAX}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="act"
          disabled={disabled}
          onClick={() => {
            const el = ref.current;
            const at = el?.selectionStart ?? text.length;
            setText(
              (text.slice(0, at) + clientFirst + text.slice(at)).slice(
                0,
                WELCOME_MAX,
              ),
            );
          }}
        >
          + First name
        </button>
      </div>
    </>
  );
}

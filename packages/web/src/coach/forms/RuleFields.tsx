import {
  AFTER_CHOICES,
  TRIGGER_LABELS,
  afterLabel,
  isTimed,
  reminderWords,
  withTrigger,
} from "../lib/forms";
import {
  MAX_REMINDERS,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  hoursUntil,
  normaliseReminders,
  pointAfter,
  type EffectiveRule,
} from "../lib/schedule";
import { IconClock, IconX } from "../ui/icons";

/**
 * When · day · time · due · reminders (C10c send, C10j one client). Due and
 * reminders are hours after the send in the API; a weekly or daily rule shows
 * them as a day and a time, anything else as "N days after it's sent".
 */
export function RuleFields({
  rule,
  onRule,
  triggers,
  disabled = false,
}: {
  rule: EffectiveRule;
  onRule: (rule: EffectiveRule) => void;
  /** The "When" choices; one choice shows it without a control. */
  triggers: string[];
  disabled?: boolean;
}) {
  const weekly = rule.trigger === "weekly";
  const timed = isTimed(rule.trigger);
  const point = (h: number) =>
    pointAfter(rule, h) ?? {
      weekday: rule.weekday,
      time: rule.timeLocal ?? "09:00",
    };
  const toHours = (v: { weekday: number | null; time: string }) =>
    hoursUntil(rule, { weekday: weekly ? v.weekday : null, time: v.time });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <span className="fl">When</span>
        <div className="seg" role="group" aria-label="When">
          {triggers.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={rule.trigger === t}
              disabled={disabled}
              onClick={() => onRule(withTrigger(rule, t))}
            >
              {TRIGGER_LABELS[t] ?? t}
            </button>
          ))}
        </div>
      </div>

      {timed && (
        <div>
          <span className="fl">{weekly ? "Send on" : "Send at"}</span>
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {weekly && (
              <div
                role="group"
                aria-label="Day"
                style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
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
            )}
            <input
              className="fld"
              type="time"
              aria-label="Time"
              style={{ width: "auto", marginLeft: weekly ? 8 : 0 }}
              value={rule.timeLocal ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onRule({ ...rule, timeLocal: e.target.value || null })
              }
            />
          </div>
        </div>
      )}

      <div>
        <span className="fl">Due</span>
        {timed ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ display: "inline-flex", gap: 8 }}>
              <input
                type="checkbox"
                checked={rule.dueAfterHours !== null}
                disabled={disabled}
                onChange={(e) =>
                  onRule({
                    ...rule,
                    dueAfterHours: e.target.checked ? (weekly ? 27 : 4) : null,
                  })
                }
              />
              <span className="sub">Has a due time</span>
            </label>
            {rule.dueAfterHours !== null && (
              <DayTime
                label="Due"
                weekly={weekly}
                value={point(rule.dueAfterHours)}
                disabled={disabled}
                onChange={(v) => onRule({ ...rule, dueAfterHours: toHours(v) })}
              />
            )}
          </div>
        ) : (
          <select
            className="fld"
            aria-label="Due"
            style={{ width: "auto" }}
            value={rule.dueAfterHours ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onRule({
                ...rule,
                dueAfterHours: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">No due date</option>
            {AFTER_CHOICES.map((h) => (
              <option key={h} value={h}>
                {afterLabel(h)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <span className="fl">Reminders</span>
        {rule.reminders.map((r, i) => {
          const words = reminderWords(rule, r.afterHours);
          return (
            <div
              key={`${r.afterHours}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
                flexWrap: "wrap",
              }}
            >
              <IconClock size={16} />
              {timed ? (
                <DayTime
                  label={`Reminder ${i + 1}`}
                  weekly={weekly}
                  value={point(r.afterHours)}
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
              ) : (
                <select
                  className="fld"
                  aria-label={`Reminder ${i + 1}`}
                  style={{ width: "auto" }}
                  value={r.afterHours}
                  disabled={disabled}
                  onChange={(e) =>
                    onRule({
                      ...rule,
                      reminders: normaliseReminders(
                        rule.reminders.map((x, j) =>
                          j === i ? { afterHours: Number(e.target.value) } : x,
                        ),
                      ),
                    })
                  }
                >
                  {[...new Set([...AFTER_CHOICES, r.afterHours])]
                    .sort((a, b) => a - b)
                    .map((h) => (
                      <option key={h} value={h}>
                        {afterLabel(h)}
                      </option>
                    ))}
                </select>
              )}
              <span className="hint" style={{ margin: 0 }}>
                if not done
              </span>
              <button
                type="button"
                className="ibtn danger"
                aria-label={`Remove reminder ${words}`}
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
                rule.reminders[rule.reminders.length - 1]?.afterHours ?? 0;
              const step = timed ? 9 : 24;
              onRule({
                ...rule,
                reminders: normaliseReminders([
                  ...rule.reminders,
                  { afterHours: Math.min(720, last + step) },
                ]),
              });
            }}
          >
            + Add reminder
          </button>
        )}
      </div>
    </div>
  );
}

function DayTime({
  label,
  weekly,
  value,
  onChange,
  disabled,
}: {
  label: string;
  weekly: boolean;
  value: { weekday: number | null; time: string };
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
          value={value.weekday ?? 1}
          disabled={disabled}
          onChange={(e) =>
            onChange({ weekday: Number(e.target.value), time: value.time })
          }
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
        value={value.time}
        disabled={disabled}
        onChange={(e) =>
          e.target.value &&
          onChange({ weekday: value.weekday, time: e.target.value })
        }
      />
    </span>
  );
}

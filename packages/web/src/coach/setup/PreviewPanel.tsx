import { IconChat, IconEye, IconForm } from "../ui/icons";
import { Avatar, Loading } from "../ui/parts";

/**
 * "Preview as Lena" (C11b2): the client's Coach tab as it will look when they
 * accept. Built from the API's accept preview (the same projection the
 * athlete sees) plus the targets and form details the coach has set.
 */
export interface PreviewModel {
  clientFirstName: string;
  coachName: string;
  coachInitials: string;
  welcomeMessage: string | null;
  startForms: { title: string; meta: string }[];
  plans: string[];
  targets: string | null;
}

export function PreviewPanel({
  model,
  loading,
  onClose,
}: {
  model: PreviewModel;
  loading: boolean;
  onClose: () => void;
}) {
  const coachFirst = model.coachName.split(/\s+/)[0] ?? model.coachName;
  return (
    <div
      className="scrim"
      style={{
        alignItems: "flex-start",
        background: "rgba(5,6,10,.78)",
        overflow: "auto",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: what ${model.clientFirstName} sees when they accept`}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: 360,
            maxWidth: "100%",
          }}
        >
          <IconEye size={16} />
          <span
            style={{
              flex: 1,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--violet-soft)",
            }}
          >
            Preview: what {model.clientFirstName} sees when they accept
          </span>
          <button
            type="button"
            className="btn v sm"
            style={{ height: 40 }}
            onClick={onClose}
            autoFocus
          >
            Close
          </button>
        </div>
        <div className="ph">
          {loading ? (
            <Loading />
          ) : (
            <>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                Your coach
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar initials={model.coachInitials} size={52} />
                <div style={{ flex: 1 }}>
                  <b
                    style={{
                      display: "block",
                      fontSize: 24,
                      lineHeight: "30px",
                      fontWeight: 800,
                    }}
                  >
                    {model.coachName}
                  </b>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    Your coach from today
                  </span>
                </div>
              </div>
              {model.welcomeMessage && (
                <div
                  className="row"
                  style={{
                    alignItems: "flex-start",
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  <IconChat size={16} />
                  <span className="tx">
                    <span className="n">{coachFirst}</span>
                    <span
                      style={{
                        fontSize: 13.5,
                        lineHeight: "19px",
                        color: "var(--ink-2)",
                      }}
                    >
                      {model.welcomeMessage}
                    </span>
                  </span>
                </div>
              )}
              {model.startForms.map((f, i) => (
                <div
                  key={`${f.title}-${i}`}
                  style={{
                    padding: "14px 0",
                    borderBottom: "1px solid var(--line)",
                    borderTop: i === 0 ? "1px solid var(--line)" : undefined,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <IconForm size={16} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: i === 0 ? "var(--violet)" : "var(--muted)",
                      }}
                    >
                      Before you start
                    </span>
                    <b
                      style={{
                        display: "block",
                        fontSize: 17,
                        lineHeight: "22px",
                      }}
                    >
                      {f.title}
                    </b>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {f.meta}
                    </span>
                  </span>
                  {i === 0 && (
                    <span className="btn v xs" aria-hidden="true">
                      Fill in
                    </span>
                  )}
                </div>
              ))}
              {model.plans.map((p) => (
                <div className="row" key={p}>
                  <span className="tx">
                    <span className="n">{p}</span>
                    <span className="s">Meal plan</span>
                  </span>
                </div>
              ))}
              {model.targets && (
                <div className="row">
                  <span className="tx">
                    <span className="n">Targets</span>
                    <span className="s">{model.targets}</span>
                  </span>
                </div>
              )}
            </>
          )}
          <div className="tabbar" aria-hidden="true">
            <span>Home</span>
            <span>Train</span>
            <span>Fuel</span>
            <span className="on">Coach</span>
            <span>You</span>
          </div>
        </div>
      </div>
    </div>
  );
}

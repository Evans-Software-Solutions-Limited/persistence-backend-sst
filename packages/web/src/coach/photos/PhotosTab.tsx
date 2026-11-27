import { Link } from "react-router";
import { OfflineBanner } from "../ui/parts";
import { cadenceLabel, compareStats, dateLabel, photoFor } from "./lib";
import {
  POSE_LABEL,
  POSES,
  type ClientPhoto,
  type ClientPhotoSet,
  type CompareMode,
  type PhotoPose,
  type PhotosDenial,
} from "./types";
import { usePhotoSrc } from "./usePhotoSrc";
import "./photos.css";

/**
 * Client → Photos on the web (canvas C3.4a): sets by date on the left, two
 * dates compared on the right (side by side or with a wipe), by pose, with
 * weight and body fat for both dates.
 */

/** One photo on the board's dark placeholder; the image once it loads. */
export function PhotoTile({
  photo,
  label,
  width,
  height,
  radius,
}: {
  photo: ClientPhoto | null;
  label: string;
  width: number | string;
  height: number | string;
  radius: number;
}) {
  const src = usePhotoSrc(photo);
  return (
    <span
      className="photo-tile"
      role="img"
      aria-label={label}
      style={{ width, height, borderRadius: radius }}
    >
      {label}
      {src && <img src={src} alt="" draggable={false} />}
    </span>
  );
}

export interface PhotosTabProps {
  clientFirst: string;
  /** Ready sets, newest first. */
  sets: ClientPhotoSet[];
  /** The compared sets as [older, newer]; null with fewer than two sets. */
  pair: [ClientPhotoSet, ClientPhotoSet] | null;
  pose: PhotoPose;
  mode: CompareMode;
  /** Wipe position, 0–100 (% of the older photo shown). */
  wipe: number;
  offlineAsOf: string | null;
  onPose: (pose: PhotoPose) => void;
  onMode: (mode: CompareMode) => void;
  onWipe: (value: number) => void;
  /** Compare this set with the latest. */
  onPickSet: (setId: string) => void;
  onOlder: (setId: string) => void;
  onNewer: (setId: string) => void;
}

export function PhotosTab(p: PhotosTabProps) {
  const pairIds = new Set(p.pair?.map((s) => s.id) ?? []);
  return (
    <>
      {p.offlineAsOf !== null && (
        <OfflineBanner
          subject={`${p.clientFirst}'s photos`}
          asOf={p.offlineAsOf}
        />
      )}
      <div className="photos-grid">
        <section className="photos-sets" aria-label="Photo sets">
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span className="eb" style={{ flex: 1 }}>
              {cadenceLabel(p.sets)}
            </span>
          </div>
          <div className="photos-sets-grid">
            {p.sets.map((set) => {
              const date = dateLabel(set.takenOn);
              return (
                <button
                  key={set.id}
                  type="button"
                  className="photo-set"
                  aria-pressed={pairIds.has(set.id)}
                  aria-label={`${date}: compare with the latest`}
                  onClick={() => p.onPickSet(set.id)}
                >
                  <span>{date}</span>
                  <span className="thumbs">
                    {POSES.map((pose) => (
                      <PhotoTile
                        key={pose}
                        photo={photoFor(set, pose)}
                        label={POSE_LABEL[pose]}
                        width={62}
                        height={82}
                        radius={8}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <section className="photos-compare" aria-label="Compare">
          <div className="photos-compare-head">
            <span className="eb" style={{ flex: 1 }}>
              Compare
            </span>
            {p.pair && (
              <select
                className="photos-mode"
                aria-label="Compare view"
                value={p.mode}
                onChange={(e) => p.onMode(e.target.value as CompareMode)}
              >
                <option value="side">Side by side</option>
                <option value="wipe">Wipe</option>
              </select>
            )}
            <span className="pose-tabs" role="tablist" aria-label="Pose">
              {POSES.map((pose) => (
                <button
                  key={pose}
                  type="button"
                  role="tab"
                  aria-selected={pose === p.pose}
                  onClick={() => p.onPose(pose)}
                >
                  {POSE_LABEL[pose]}
                </button>
              ))}
            </span>
          </div>
          {p.pair ? (
            <Compare {...p} pair={p.pair} />
          ) : (
            <>
              <PhotoTile
                photo={photoFor(p.sets[0], p.pose)}
                label={`${POSE_LABEL[p.pose]} · ${dateLabel(p.sets[0]!.takenOn)}`}
                width={230}
                height={320}
                radius={12}
              />
              <p className="hint" style={{ marginTop: 12 }}>
                Compare needs two dates. {p.clientFirst} has one set so far.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}

function Compare(
  p: PhotosTabProps & { pair: [ClientPhotoSet, ClientPhotoSet] },
) {
  const [older, newer] = p.pair;
  const pose = POSE_LABEL[p.pose];
  const olderLabel = `${pose} · ${dateLabel(older.takenOn)}`;
  const newerLabel = `${pose} · ${dateLabel(newer.takenOn)}`;
  const stats = compareStats(older, newer);
  return (
    <>
      {p.mode === "side" ? (
        <div className="photos-pair">
          <PhotoTile
            photo={photoFor(older, p.pose)}
            label={olderLabel}
            width={230}
            height={320}
            radius={12}
          />
          <PhotoTile
            photo={photoFor(newer, p.pose)}
            label={newerLabel}
            width={230}
            height={320}
            radius={12}
          />
        </div>
      ) : (
        <div className="photos-wipe">
          <PhotoTile
            photo={photoFor(newer, p.pose)}
            label={newerLabel}
            width="100%"
            height="100%"
            radius={0}
          />
          <span
            style={{
              position: "absolute",
              inset: 0,
              clipPath: `inset(0 ${100 - p.wipe}% 0 0)`,
            }}
          >
            <PhotoTile
              photo={photoFor(older, p.pose)}
              label={olderLabel}
              width="100%"
              height="100%"
              radius={0}
            />
          </span>
          <span className="wipe-line" style={{ left: `${p.wipe}%` }} />
          <input
            type="range"
            min={0}
            max={100}
            value={p.wipe}
            aria-label={`Wipe between ${dateLabel(older.takenOn)} and ${dateLabel(newer.takenOn)}`}
            onChange={(e) => p.onWipe(Number(e.target.value))}
          />
        </div>
      )}
      <div className="photos-dates">
        <DateSelect
          label="Earlier date"
          sets={p.sets}
          value={older.id}
          other={newer.id}
          onChange={p.onOlder}
        />
        <DateSelect
          label="Later date"
          sets={p.sets}
          value={newer.id}
          other={older.id}
          onChange={p.onNewer}
        />
      </div>
      <div className="photos-strip">
        <div className="strip">
          <div>
            <b>
              {stats.weight.from}
              <i>→{stats.weight.to}</i>
            </b>
            <span>Weight kg</span>
          </div>
          <div>
            <b>
              {stats.bodyFat.from}
              <i>→{stats.bodyFat.to}</i>
            </b>
            <span>Body fat %</span>
          </div>
          <div>
            <b>
              {stats.apart.value}
              <i>{stats.apart.unit}</i>
            </b>
            <span>Apart</span>
          </div>
        </div>
      </div>
    </>
  );
}

function DateSelect({
  label,
  sets,
  value,
  other,
  onChange,
}: {
  label: string;
  sets: ClientPhotoSet[];
  value: string;
  other: string;
  onChange: (id: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {sets
        .filter((s) => s.id !== other)
        .map((s) => (
          <option key={s.id} value={s.id}>
            {dateLabel(s.takenOn)}
          </option>
        ))}
    </select>
  );
}

const STATE_COPY: Record<
  PhotosDenial | "empty",
  (first: string) => { title: string; body: string }
> = {
  empty: (first) => ({
    title: "No photos yet",
    body: `${first}'s front, side and back photos show here by date once they add some.`,
  }),
  not_shared: (first) => ({
    title: `${first} hasn't shared photos with you`,
    body: `${first} chooses whether their coaches see their progress photos. They show here once ${first} shares them.`,
  }),
  photos_off: (first) => ({
    title: `Photos are off for ${first}`,
    body: `Turn on Photos in ${first}'s settings to see their progress photos.`,
  }),
  ended: (first) => ({
    title: "Coaching has ended",
    body: `You can no longer see ${first}'s photos.`,
  }),
};

/** No photos, not shared, the switch off, or coaching ended. */
export function PhotosState({
  kind,
  clientFirst,
  settingsHref,
}: {
  kind: PhotosDenial | "empty";
  clientFirst: string;
  settingsHref: string;
}) {
  const copy = STATE_COPY[kind](clientFirst);
  return (
    <div className="photos-empty" role="status" data-state={kind}>
      <b>{copy.title}</b>
      <span className="sub">{copy.body}</span>
      {kind === "photos_off" && (
        <Link to={settingsHref} className="lk" style={{ alignSelf: "start" }}>
          Open settings
        </Link>
      )}
    </div>
  );
}

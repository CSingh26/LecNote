import { useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Merge, X } from "lucide-react";
import type { Lecture } from "../types";
import { activeStatus, api, json, message, time } from "../lib/api";
import { Button, ErrorNotice, Field, IconButton, Modal } from "./ui";
import { storageSize } from "./StorageStatus";
import "./MergeRecordings.css";

// Keep optional storage metadata local until the lecture contract is finalized.
export type MergeSource = Lecture & { source_bytes?: number | null };

function unavailable(source: MergeSource) {
  if (!source.course_id) return "No class assigned";
  if (!source.media_type || !source.source_name) return "No recording";
  if (
    activeStatus(source.status) ||
    (source.job && activeStatus(source.job.status)) ||
    [
      "processing",
      "merging",
      "compressing",
      "finalizing",
      "uploading",
    ].includes(source.status)
  )
    return "Busy";
  return "";
}

export function MergeRecordings({
  lectures,
  onClose,
  onSaved,
}: {
  lectures: MergeSource[];
  onClose: () => void;
  onSaved: (lecture: Lecture) => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const byId = new Map(lectures.map((lecture) => [lecture.id, lecture]));
  const selected = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const course = selected[0]?.course_id;
  const duration = selected.reduce(
    (sum, row) =>
      sum + (Number.isFinite(row.duration) ? Math.max(0, row.duration) : 0),
    0,
  );
  const knownSizes = selected
    .map((row) => row.source_bytes)
    .filter(
      (size): size is number =>
        typeof size === "number" && Number.isFinite(size) && size >= 0,
    );
  const size = knownSizes.reduce((sum, bytes) => sum + bytes, 0);
  const unknownDuration = selected.some(
    (row) => !Number.isFinite(row.duration) || row.duration <= 0,
  );
  const invalid =
    selected.length !== ids.length ||
    selected.some((row) => unavailable(row) || row.course_id !== course);
  const problem = invalid
    ? "A selected source is unavailable or belongs to a different class."
    : duration > 6 * 3600
      ? "Merged recordings cannot exceed six hours."
      : size > 4 * 1024 ** 3
        ? "Merged source files cannot exceed 4 GiB."
        : "";
  const canMerge =
    ids.length >= 2 &&
    ids.length <= 20 &&
    title.trim().length > 0 &&
    !problem &&
    !busy;

  function toggle(id: string) {
    setError("");
    setIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }
  function move(index: number, direction: number) {
    setError("");
    setIds((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canMerge || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const lecture = await api<Lecture>(
        "/lectures/merge",
        json("POST", { lecture_ids: ids, title: title.trim() }),
      );
      onSaved(lecture);
    } catch (error) {
      setError(message(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title="Merge recordings" onClose={onClose} busy={busy} wide>
      <form onSubmit={submit} className="merge-recordings" aria-busy={busy}>
        <div className="modal-body">
          <Field label="Merged lecture title">
            <input
              required
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <fieldset disabled={busy} className="merge-sources">
            <legend>Recordings</legend>
            {lectures.length === 0 && (
              <p className="muted">No recordings available.</p>
            )}
            {lectures.map((source) => {
              const checked = ids.includes(source.id);
              const reason =
                unavailable(source) ||
                (course && source.course_id !== course
                  ? "Different class"
                  : "") ||
                (!checked && ids.length >= 20 ? "20-part limit" : "");
              return (
                <label key={source.id} className="merge-source">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && Boolean(reason)}
                    onChange={() => toggle(source.id)}
                  />
                  <span>
                    <strong>{source.title}</strong>
                    <small>
                      {source.course_code ||
                        source.course_name ||
                        source.course_id ||
                        "Unassigned"}{" "}
                      ·{" "}
                      {source.duration > 0
                        ? time(source.duration)
                        : "Duration unknown"}
                      {reason ? ` · ${reason}` : ""}
                    </small>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {ids.length > 0 && (
            <section
              className="merge-selection"
              aria-label="Selected recordings"
            >
              <h3>Merge order</h3>
              <ol aria-label="Merge order">
                {ids.map((id, index) => {
                  const source = byId.get(id);
                  const name = source?.title || "Unavailable recording";
                  return (
                    <li key={id}>
                      <span className="merge-index">{index + 1}</span>
                      <span className="merge-part-title">{name}</span>
                      <div className="merge-order-actions">
                        <IconButton
                          icon={ArrowUp}
                          label={`Move ${name} up`}
                          disabled={busy || index === 0}
                          onClick={() => move(index, -1)}
                        />
                        <IconButton
                          icon={ArrowDown}
                          label={`Move ${name} down`}
                          disabled={busy || index === ids.length - 1}
                          onClick={() => move(index, 1)}
                        />
                        <IconButton
                          icon={X}
                          label={`Remove ${name}`}
                          disabled={busy}
                          onClick={() => toggle(id)}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          <div className="merge-totals" aria-live="polite">
            <span>{ids.length} / 20 parts</span>
            <span>
              {time(duration)}
              {unknownDuration ? "+ known" : ""} / 6:00:00
            </span>
            <span>
              {knownSizes.length
                ? `${storageSize(size)}${knownSizes.length < selected.length ? "+ known" : ""}`
                : "Size unknown"}{" "}
              / 4 GiB
            </span>
          </div>
          <ErrorNotice error={problem || error} />
          {busy && (
            <p role="status" className="muted">
              Merging recordings...
            </p>
          )}
        </div>
        <footer>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            icon={Merge}
            variant="primary"
            disabled={!canMerge}
          >
            Merge recordings
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

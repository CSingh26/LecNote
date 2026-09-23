import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileAudio,
  FileText,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import type { Course, Lecture as LectureData, Settings } from "../types";
import {
  activeStatus,
  api,
  date,
  downloadExport,
  json,
  lecturePath,
  message,
  time,
  useResource,
} from "../lib/api";
import {
  Button,
  Confirm,
  ErrorNotice,
  IconButton,
  JobProgress,
  Loading,
  Status,
} from "../components/ui";
import { LectureForm } from "../components/LectureForm";
import { NotesView, Review } from "../components/Notes";
import { TranscriptView } from "../components/Transcript";
import { Materials } from "../components/Materials";

export function Lecture({
  id,
  courses,
  settings,
  onChanged,
  onDirty,
  dirty,
  seekTo,
}: {
  id: string;
  courses: Course[];
  settings?: Settings;
  onChanged: () => void;
  onDirty: (dirty: boolean) => void;
  dirty: boolean;
  seekTo: number | null;
}) {
  const resource = useResource<LectureData>(lecturePath(id), 2500);
  const lecture = resource.data;
  const [tab, setTab] = useState("Notes");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const [diarize, setDiarize] = useState<boolean | null>(null);
  const media = useRef<HTMLMediaElement | null>(null);
  const pendingSeek = useRef<number | null>(seekTo);
  const refresh = () => {
    resource.refresh();
    onChanged();
  };
  async function process(force = false, transcribeOnly = false) {
    setBusy("process");
    setError("");
    try {
      await api(
        `${lecturePath(id)}/process`,
        json("POST", {
          force,
          diarize: diarize ?? settings?.diarization ?? false,
          ...(transcribeOnly ? { transcribe_only: true } : {}),
        }),
      );
      setRegenerate(false);
      refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy("");
    }
  }
  async function cancel() {
    setBusy("cancel");
    setError("");
    try {
      await api(`${lecturePath(id)}/cancel`, json("POST"));
      refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy("");
    }
  }
  async function deleteLecture() {
    setBusy("delete");
    setError("");
    try {
      await api(lecturePath(id), json("DELETE"));
      onDirty(false);
      onChanged();
      window.location.hash = "/library";
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy("");
    }
  }
  async function exportFile(format: string) {
    if (!lecture) return;
    setBusy("export");
    setError("");
    try {
      await downloadExport(id, format, lecture.title);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy("");
    }
  }
  function seek(seconds: number) {
    if (!media.current) {
      setError(
        "This lecture has no playable recording. Its transcript timestamps are still available.",
      );
      return;
    }
    pendingSeek.current = seconds;
    if (media.current.readyState >= 1) {
      media.current.currentTime = Math.max(0, seconds);
      pendingSeek.current = null;
      void media.current
        .play()
        .catch(() =>
          setError("Playback is paused. Press play in the source player."),
        );
    }
    media.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  useEffect(() => {
    pendingSeek.current = seekTo;
    if (seekTo != null && media.current?.readyState) {
      media.current.currentTime = seekTo;
      pendingSeek.current = null;
    }
  }, [seekTo]);
  if (resource.loading && !lecture) return <Loading label="Opening lecture" />;
  if (!lecture)
    return (
      <>
        <a className="text-link" href="#/library">
          <ArrowLeft size={16} />
          Library
        </a>
        <ErrorNotice error={resource.error} retry={resource.refresh} />
      </>
    );
  const active = activeStatus(lecture.status);
  const hasMedia = Boolean(lecture.media_type);
  const video =
    lecture.media_type?.startsWith("video") ||
    /\.(mp4|webm|mov)$/i.test(lecture.source_name || "");
  return (
    <>
      <a className="back-link" href="#/library">
        <ArrowLeft size={16} />
        Library
      </a>
      <div className="lecture-header">
        <div>
          <div className="eyebrow">
            {courses.find((c) => c.id === lecture.course_id)?.name ||
              "UNASSIGNED"}
          </div>
          <h1>{lecture.title}</h1>
          <div className="lecture-meta">
            <Status status={lecture.status} />
            <span>{date(lecture.created_at)}</span>
            {lecture.duration > 0 && <span>{time(lecture.duration)}</span>}
          </div>
        </div>
        <div className="actions">
          <IconButton
            label="Edit lecture details"
            icon={Pencil}
            onClick={() => setEdit(true)}
          />
          <div className="export-control">
            <Download size={16} />
            <select
              aria-label="Export lecture"
              value=""
              disabled={Boolean(busy)}
              onChange={(e) => {
                if (e.target.value) void exportFile(e.target.value);
              }}
            >
              <option value="">
                {busy === "export" ? "Exporting…" : "Export"}
              </option>
              <option value="md">Markdown (.md)</option>
              <option value="html">HTML (.html)</option>
              <option value="pdf">PDF (.pdf)</option>
              <option value="json">JSON (.json)</option>
            </select>
          </div>
          <IconButton
            label="Delete lecture"
            icon={Trash2}
            disabled={active || Boolean(busy)}
            onClick={() => {
              setError("");
              setRemove(true);
            }}
          />
        </div>
      </div>
      <ErrorNotice
        error={error || resource.error}
        retry={resource.error ? resource.refresh : undefined}
      />
      <ErrorNotice error={lecture.error || ""} />
      {hasMedia ? (
        <section
          className={`source-player ${video ? "video-player" : ""}`}
          aria-label="Lecture source"
        >
          <div className="source-label">
            <FileAudio size={18} />
            <span>{lecture.source_name || "Recorded lecture"}</span>
          </div>
          {video ? (
            <video
              ref={(node) => {
                media.current = node;
              }}
              controls
              preload="metadata"
              src={`/api${lecturePath(id)}/media`}
              onLoadedMetadata={() => {
                if (pendingSeek.current != null && media.current) {
                  media.current.currentTime = pendingSeek.current;
                  pendingSeek.current = null;
                }
              }}
              onError={() =>
                setError(
                  "The source media is not available yet or this browser cannot play its format.",
                )
              }
            />
          ) : (
            <audio
              ref={(node) => {
                media.current = node;
              }}
              controls
              preload="metadata"
              src={`/api${lecturePath(id)}/media`}
              onLoadedMetadata={() => {
                if (pendingSeek.current != null && media.current) {
                  media.current.currentTime = pendingSeek.current;
                  pendingSeek.current = null;
                }
              }}
              onError={() =>
                setError(
                  "The source media is not available yet or this browser cannot play its format.",
                )
              }
            />
          )}
        </section>
      ) : (
        <div className="source-unavailable">
          <FileText size={17} />
          <span>Imported transcript · No source recording</span>
        </div>
      )}
      <div className="processing-bar">
        {active && lecture.job ? (
          <JobProgress job={lecture.job} />
        ) : (
          <span className="muted small">
            {lecture.notes
              ? "Notes generated from your lecture."
              : lecture.status === "recording"
                ? "Live recording in progress."
                : "Ready to turn this lecture into study notes."}
          </span>
        )}
        <div className="actions">
          {active && lecture.status !== "recording" ? (
            <Button icon={Square} disabled={Boolean(busy)} onClick={cancel}>
              Cancel processing
            </Button>
          ) : lecture.status === "recording" ? (
            <a className="button" href="#/record">
              Open recorder
            </a>
          ) : (
            <>
              <label className="check small">
                <input
                  type="checkbox"
                  checked={diarize ?? settings?.diarization ?? false}
                  onChange={(e) => setDiarize(e.target.checked)}
                />
                Detect speakers
              </label>
              {hasMedia && !lecture.transcript && (
                <Button
                  icon={FileAudio}
                  disabled={Boolean(busy) || dirty}
                  onClick={() => void process(false, true)}
                >
                  Transcribe locally
                </Button>
              )}
              <Button
                variant="primary"
                icon={lecture.notes ? RotateCcw : Play}
                disabled={Boolean(busy) || dirty}
                onClick={() =>
                  lecture.notes ? setRegenerate(true) : void process(false)
                }
              >
                {busy === "process"
                  ? "Queuing…"
                  : lecture.notes
                    ? "Regenerate notes"
                    : ["failed", "cancelled", "interrupted"].includes(
                          lecture.status,
                        )
                      ? "Retry processing"
                      : "Generate notes"}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Lecture views">
        {["Notes", "Transcript", "Materials", "Review"].map((name, index) => (
          <button
            key={name}
            id={`tab-${name}`}
            role="tab"
            aria-selected={tab === name}
            aria-controls={`panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const names = ["Notes", "Transcript", "Materials", "Review"];
                const target =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 3
                      : (index + (event.key === "ArrowRight" ? 1 : 3)) % 4;
                document.getElementById(`tab-${names[target]}`)?.click();
                document.getElementById(`tab-${names[target]}`)?.focus();
              }
            }}
            onClick={() => {
              if (dirty && !window.confirm("Discard your unsaved edits?"))
                return;
              onDirty(false);
              setTab(name);
            }}
          >
            {name}
            {name === "Materials" && Boolean(lecture.attachments?.length) && (
              <span>{lecture.attachments.length}</span>
            )}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === "Notes" ? (
          <NotesView
            lecture={lecture}
            prices={settings}
            onSeek={seek}
            onSaved={refresh}
            onDirty={onDirty}
          />
        ) : tab === "Transcript" ? (
          <TranscriptView
            lecture={lecture}
            onSeek={seek}
            onSaved={refresh}
            onDirty={onDirty}
          />
        ) : tab === "Materials" ? (
          <Materials lecture={lecture} onSaved={refresh} />
        ) : (
          <Review lecture={lecture} />
        )}
      </div>
      {edit && (
        <LectureForm
          lecture={lecture}
          courses={courses}
          settings={settings}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            refresh();
          }}
        />
      )}
      {remove && (
        <Confirm
          title="Delete lecture?"
          busy={Boolean(busy)}
          error={error}
          onClose={() => setRemove(false)}
          onConfirm={deleteLecture}
        >
          The recording, transcript, notes, and attachments for {lecture.title}{" "}
          will be permanently deleted.
        </Confirm>
      )}
      {regenerate && (
        <div>
          <Regenerate
            onClose={() => setRegenerate(false)}
            busy={Boolean(busy)}
            onConfirm={() => void process(true)}
            error={error}
          />
        </div>
      )}
    </>
  );
}
import { Modal } from "../components/ui";
function Regenerate({
  onClose,
  onConfirm,
  busy,
  error,
}: {
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <Modal title="Regenerate notes?" onClose={onClose} busy={busy}>
      <div className="modal-body">
        <p>
          Generate new notes using the current transcript, context, attachments,
          and settings. This uses your OpenAI API key and may incur charges.
          Your personal notes are kept.
        </p>
        <ErrorNotice error={error} />
      </div>
      <footer>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={busy}>
          Regenerate
        </Button>
      </footer>
    </Modal>
  );
}

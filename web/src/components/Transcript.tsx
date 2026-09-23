import { useState } from "react";
import { FileText, Pencil, Save, Search } from "lucide-react";
import type { Lecture, Segment } from "../types";
import {
  activeStatus,
  api,
  json,
  lecturePath,
  message,
  time,
} from "../lib/api";
import { parseTranscript, parseTimestamp } from "../lib/transcript";
import { Button, Empty, ErrorNotice } from "./ui";

export function TranscriptView({
  lecture,
  onSeek,
  onSaved,
  onDirty,
}: {
  lecture: Lecture;
  onSeek: (seconds: number) => void;
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const original = lecture.transcript?.segments ?? [];
  const current = editing ? segments : original;
  function change(index: number, patch: Partial<Segment>) {
    setSegments((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
    onDirty(true);
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const transcript = parseTranscript(
        JSON.stringify({ ...lecture.transcript, segments }),
      );
      await api(
        `${lecturePath(lecture.id)}/transcript`,
        json("PUT", transcript),
      );
      setEditing(false);
      onDirty(false);
      onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="transcript-view">
      <div className="transcript-toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label="Find in transcript"
            value={query}
            placeholder="Find in transcript…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {original.length > 0 && !editing && (
          <Button
            icon={Pencil}
            disabled={activeStatus(lecture.status)}
            onClick={() => {
              setSegments(original.map((s) => ({ ...s })));
              setEditing(true);
            }}
          >
            Edit transcript
          </Button>
        )}
        {editing && (
          <div className="actions">
            <Button
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setError("");
                onDirty(false);
              }}
            >
              Discard changes
            </Button>
            <Button
              icon={Save}
              variant="primary"
              disabled={busy}
              onClick={save}
            >
              {busy ? "Saving…" : "Save transcript"}
            </Button>
          </div>
        )}
      </div>
      {editing && (
        <div className="notice warning">
          Saving transcript or speaker changes clears generated notes. Your
          personal notes are kept. Generate notes again when corrections are
          complete.
        </div>
      )}
      <ErrorNotice error={error} />
      {current.length ? (
        <div className="segments">
          {current.map((segment, index) =>
            !query ||
            `${segment.text} ${segment.speaker ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase()) ? (
              <article key={`${segment.id}-${index}`}>
                <Button
                  variant="timestamp"
                  onClick={() => onSeek(segment.start)}
                >
                  {time(segment.start)}
                </Button>
                {editing ? (
                  <div className="segment-editor">
                    <div className="form-grid">
                      <label className="field">
                        <span>Speaker {index + 1}</span>
                        <input
                          value={segment.speaker ?? ""}
                          placeholder="Unlabeled"
                          onChange={(e) =>
                            change(index, { speaker: e.target.value || null })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Start {index + 1} (seconds)</span>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={segment.start}
                          onChange={(e) =>
                            change(index, { start: e.target.valueAsNumber })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>End {index + 1} (seconds)</span>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={segment.end}
                          onChange={(e) =>
                            change(index, { end: e.target.valueAsNumber })
                          }
                        />
                      </label>
                    </div>
                    <textarea
                      aria-label={`Segment ${index + 1} text`}
                      rows={3}
                      value={segment.text}
                      onChange={(e) => change(index, { text: e.target.value })}
                    />
                  </div>
                ) : (
                  <div>
                    {segment.speaker && (
                      <strong className="speaker">{segment.speaker}</strong>
                    )}
                    <p>{segment.text}</p>
                  </div>
                )}
              </article>
            ) : null,
          )}
        </div>
      ) : (
        <Empty icon={FileText} title="No transcript yet">
          The transcript will appear after local transcription completes.
        </Empty>
      )}
      <form
        className="seek-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const form = new FormData(e.currentTarget);
            onSeek(parseTimestamp(String(form.get("timestamp"))));
            setError("");
          } catch (error) {
            setError(message(error));
          }
        }}
      >
        <label>
          Jump to time
          <input
            name="timestamp"
            placeholder="0:00"
            aria-label="Jump to timestamp"
            required
          />
        </label>
        <Button type="submit">Go</Button>
      </form>
    </div>
  );
}

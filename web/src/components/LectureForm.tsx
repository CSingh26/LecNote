import { useRef, useState, type FormEvent } from "react";
import { FileAudio, FileText, Mic, Upload } from "lucide-react";
import type { Course, Lecture, RecordingDraft, Settings } from "../types";
import { api, json, lecturePath, message } from "../lib/api";
import { parseTranscript } from "../lib/transcript";
import { Button, CourseSelect, ErrorNotice, Field, Modal } from "./ui";

export function LectureForm({
  courses,
  settings,
  onClose,
  onSaved,
  onRecord,
  lecture,
  initialMode = "upload",
}: {
  courses: Course[];
  settings?: Settings;
  onClose: () => void;
  onSaved: (lecture: Lecture) => void;
  onRecord?: (draft: RecordingDraft) => void;
  lecture?: Lecture;
  initialMode?: "upload" | "transcript";
}) {
  const [mode, setMode] = useState<"upload" | "transcript" | "record">(
    initialMode,
  );
  const [title, setTitle] = useState(lecture?.title ?? "");
  const [courseId, setCourseId] = useState(lecture?.course_id ?? "");
  const [context, setContext] = useState(lecture?.context ?? "");
  const [language, setLanguage] = useState(settings?.language ?? "");
  const [process, setProcess] = useState(Boolean(settings?.api_key_configured));
  const [file, setFile] = useState<File>();
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRead = useRef(0);
  async function readTranscript(selected: File) {
    const request = ++fileRead.current;
    try {
      const text = await selected.text();
      if (request !== fileRead.current) return;
      setSource(text);
      setTitle(
        (current) =>
          current || selected.name.replace(/\.[^.]+$/, "").slice(0, 200),
      );
    } catch (error) {
      if (request === fileRead.current) setError(message(error));
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!lecture && mode === "record") {
      onRecord?.({
        title: title.trim(),
        course_id: courseId,
        context,
        language,
      });
      return;
    }
    setError("");
    setBusy(true);
    try {
      let result: Lecture;
      if (lecture)
        result = await api<Lecture>(
          lecturePath(lecture.id),
          json("PATCH", {
            title: title.trim(),
            course_id: courseId || null,
            context,
          }),
        );
      else if (mode === "transcript")
        result = await api<Lecture>(
          "/lectures/import",
          json("POST", {
            title: title.trim(),
            course_id: courseId || null,
            context,
            transcript: parseTranscript(source, language),
          }),
        );
      else {
        if (!file) throw new Error("Choose an audio or video recording.");
        const form = new FormData();
        form.append("file", file);
        form.append("title", title.trim());
        form.append("context", context);
        form.append("language", language);
        form.append("process", String(process));
        if (courseId) form.append("course_id", courseId);
        result = await api<Lecture>("/lectures", {
          method: "POST",
          body: form,
        });
      }
      onSaved(result);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={lecture ? "Lecture details" : "New lecture"}
      onClose={onClose}
      busy={busy}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          {!lecture && (
            <div className="segmented" aria-label="Lecture source">
              {onRecord && (
                <Button
                  icon={Mic}
                  aria-pressed={mode === "record"}
                  onClick={() => setMode("record")}
                >
                  Record live
                </Button>
              )}
              <Button
                icon={FileAudio}
                aria-pressed={mode === "upload"}
                onClick={() => setMode("upload")}
              >
                Upload file
              </Button>
              <Button
                icon={FileText}
                aria-pressed={mode === "transcript"}
                onClick={() => setMode("transcript")}
              >
                Transcript
              </Button>
            </div>
          )}
          {!lecture && mode === "upload" && (
            <div className="file-drop">
              <Upload size={28} />
              <Field label="Recording file">
                <input
                  type="file"
                  accept=".wav,.mp3,.m4a,.mp4,.webm,.ogg,.flac,.mov,.aac"
                  required
                  onChange={(e) => {
                    const selected = e.target.files?.[0];
                    setFile(selected);
                    if (selected)
                      setTitle(
                        (current) =>
                          current ||
                          selected.name.replace(/\.[^.]+$/, "").slice(0, 200),
                      );
                  }}
                />
              </Field>
              <small>
                Audio or video · WAV, MP3, M4A, MP4, WebM, OGG, FLAC, MOV, AAC
              </small>
            </div>
          )}
          {!lecture && mode === "transcript" && (
            <>
              <Field label="Transcript file">
                <input
                  type="file"
                  accept=".json,.txt,.srt,.vtt"
                  onChange={async (e) => {
                    const selected = e.target.files?.[0];
                    if (!selected) return;
                    await readTranscript(selected);
                  }}
                />
              </Field>
              <Field
                label="Transcript text"
                hint="JSON, SRT, VTT, or text with [00:00] timestamps. Untimed text uses estimated timing."
              >
                <textarea
                  rows={7}
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="[00:00] Professor: …"
                />
              </Field>
            </>
          )}
          <Field label="Lecture title">
            <input
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field label="Course">
              <CourseSelect
                courses={courses}
                value={courseId}
                onChange={setCourseId}
              />
            </Field>
            {!lecture && (
              <Field
                label="Language"
                hint="Leave blank for automatic detection."
              >
                <input
                  value={language}
                  placeholder="Auto-detect"
                  onChange={(e) => setLanguage(e.target.value)}
                />
              </Field>
            )}
          </div>
          <Field
            label="Lecture context"
            hint="Optional topics, syllabus context, or terms to pay attention to."
          >
            <textarea
              rows={3}
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </Field>
          {!lecture && mode === "upload" && (
            <label className="check">
              <input
                type="checkbox"
                checked={process}
                onChange={(e) => setProcess(e.target.checked)}
              />
              Generate notes after upload
            </label>
          )}
          {!lecture && mode !== "record" && !settings?.api_key_configured && (
            <p className="muted small">
              No OpenAI key is configured. Save a draft and add a key in
              Settings before generating notes.
            </p>
          )}
          {!lecture && mode === "transcript" && (
            <p className="muted small">
              Imported transcripts are saved as drafts. Review the transcript
              before generating notes.
            </p>
          )}
          <ErrorNotice error={error} />
        </div>
        <footer>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={mode === "record" ? Mic : Upload}
            disabled={busy}
          >
            {busy
              ? "Saving…"
              : lecture
                ? "Save changes"
                : mode === "record"
                  ? "Open recorder"
                  : mode === "transcript"
                    ? "Import transcript"
                    : "Add lecture"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

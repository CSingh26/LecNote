import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Download,
  Mic,
  Monitor,
  RotateCcw,
  Square,
} from "lucide-react";
import type { Course, RecordingDraft, Settings } from "../types";
import { time } from "../lib/api";
import { recorder, useRecorder } from "../lib/recorder";
import type { RecordingSource } from "../lib/capture";
import {
  Button,
  CourseSelect,
  ErrorNotice,
  Field,
  LectureLink,
  PageHeader,
} from "../components/ui";

function Waveform({ signal }: { signal: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#d8dfd9";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      if (!signal.length) return;
      ctx.strokeStyle = "#235b44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      signal.forEach((value, index) => {
        const x = (index / (signal.length - 1)) * width;
        const y = height / 2 + value * (height / 2 - 8);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [signal]);
  return (
    <canvas
      ref={ref}
      className="waveform"
      aria-label="Live recording waveform"
      role="img"
    />
  );
}
export function Record({
  courses,
  settings,
  initialDraft,
  initialCourse = "",
}: {
  courses: Course[];
  settings?: Settings;
  initialDraft?: RecordingDraft;
  initialCourse?: string;
}) {
  const state = useRecorder();
  const [title, setTitle] = useState(
    recorder.protected ? state.title : (initialDraft?.title ?? state.title),
  );
  const [course, setCourse] = useState(
    initialCourse || initialDraft?.course_id || "",
  );
  const [language, setLanguage] = useState(
    initialDraft?.language ?? settings?.language ?? "",
  );
  const [context, setContext] = useState(initialDraft?.context ?? "");
  const [source, setSource] = useState<RecordingSource>(state.source);
  const active = recorder.protected;
  return (
    <>
      <PageHeader eyebrow="Live capture" title="Record" />
      <div className="record-layout">
        <section className="record-console">
          <div className="split">
            <span className="eyebrow">
              {source === "both"
                ? "MICROPHONE + LECTURE"
                : source === "lecture"
                  ? "LECTURE AUDIO"
                  : "MICROPHONE"}
            </span>
            <span
              className={`record-state ${state.phase === "recording" ? "is-live" : ""}`}
            >
              <i />
              {state.phase === "recording"
                ? "Recording"
                : state.phase === "stopping"
                  ? "Finishing"
                  : state.phase === "blocked"
                    ? "Upload paused"
                    : state.phase === "complete"
                      ? "Saved"
                      : "Standby"}
            </span>
          </div>
          <div className="record-time">{time(state.elapsed)}</div>
          <Waveform signal={state.signal} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void recorder.start(
                title.trim(),
                course,
                language,
                context,
                source,
              );
            }}
          >
            <fieldset disabled={active}>
              <div className="field">
                <span id="record-source-label">Audio source</span>
                <div
                  className="segmented recording-sources"
                  role="group"
                  aria-labelledby="record-source-label"
                >
                  <Button
                    icon={Mic}
                    aria-pressed={source === "microphone"}
                    onClick={() => setSource("microphone")}
                  >
                    Microphone
                  </Button>
                  <Button
                    icon={Monitor}
                    aria-pressed={source === "lecture"}
                    onClick={() => setSource("lecture")}
                  >
                    Lecture audio
                  </Button>
                  <Button
                    icon={AudioLines}
                    aria-pressed={source === "both"}
                    onClick={() => setSource("both")}
                  >
                    Both
                  </Button>
                </div>
              </div>
              <Field label="Recording title">
                <input
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Lecture title"
                />
              </Field>
              <div className="form-grid">
                <Field label="Course">
                  <CourseSelect
                    courses={courses}
                    value={course}
                    onChange={setCourse}
                  />
                </Field>
                <Field label="Language">
                  <input
                    value={language}
                    placeholder="Auto-detect"
                    onChange={(e) => setLanguage(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Lecture context">
                <textarea
                  rows={2}
                  maxLength={100000}
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                />
              </Field>
            </fieldset>
            <div className="record-actions">
              {!active ? (
                <Button type="submit" variant="primary" icon={Mic}>
                  {state.phase === "complete"
                    ? "Record another lecture"
                    : "Start recording"}
                </Button>
              ) : state.phase === "recording" ? (
                <Button
                  variant="danger"
                  icon={Square}
                  onClick={() => void recorder.stop()}
                >
                  Stop & save
                </Button>
              ) : (
                <Button disabled>
                  {state.phase === "requesting"
                    ? "Waiting for audio access…"
                    : state.phase === "blocked"
                      ? "Recording retained"
                      : "Saving final audio…"}
                </Button>
              )}
            </div>
          </form>
          <p className="muted small">
            Audio capture starts only after you grant access. Only audio is
            saved; shared video is not recorded. Keep this tab open until saving
            finishes.
          </p>
          {!settings?.api_key_configured && (
            <div className="notice warning">
              Local transcription is available without an OpenAI key. Add a key
              in Settings to generate notes after recording.
            </div>
          )}
          <ErrorNotice error={state.error} />
          {state.error && active && state.phase !== "requesting" && (
            <Button
              icon={RotateCcw}
              onClick={() => void recorder.retry()}
              disabled={state.phase === "stopping"}
            >
              Retry uploads & finish
            </Button>
          )}
          {state.hasAudio && (
            <Button icon={Download} onClick={() => recorder.download()}>
              Download{" "}
              {state.phase === "recording" ? "captured chunks" : "recording"}{" "}
              (WAV)
            </Button>
          )}
          {state.lectureId && (
            <div className="record-receipt">
              <span>
                {state.uploaded} chunks uploaded · {state.pending} pending
              </span>
              <LectureLink id={state.lectureId}>Open lecture</LectureLink>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

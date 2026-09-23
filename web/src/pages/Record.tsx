import { useEffect, useRef, useState } from "react";
import { AudioLines, Download, Mic, RotateCcw, Square } from "lucide-react";
import type { Course, Lecture, Settings } from "../types";
import { time, useResource } from "../lib/api";
import { recorder, useRecorder } from "../lib/recorder";
import {
  Button,
  CourseSelect,
  Empty,
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
      aria-label="Live microphone waveform"
      role="img"
    />
  );
}
export function Record({
  courses,
  settings,
}: {
  courses: Course[];
  settings?: Settings;
}) {
  const state = useRecorder();
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [language, setLanguage] = useState(settings?.language ?? "");
  const lecture = useResource<Lecture>(
    state.lectureId ? `/lectures/${state.lectureId}` : null,
    2500,
  );
  const active = recorder.protected;
  const segments = lecture.data?.transcript?.segments ?? [];
  return (
    <>
      <PageHeader eyebrow="Live capture" title="Record" />
      <div className="record-layout">
        <section className="record-console">
          <div className="split">
            <span className="eyebrow">MICROPHONE</span>
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
              void recorder.start(title.trim(), course, language);
            }}
          >
            <fieldset disabled={active}>
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
                    ? "Waiting for microphone…"
                    : state.phase === "blocked"
                      ? "Recording retained"
                      : "Saving final audio…"}
                </Button>
              )}
            </div>
          </form>
          <p className="muted small">
            Microphone access starts only when you press Record. You can move
            around this workspace while recording; keep this browser tab open.
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
        <section className="live-transcript">
          <div className="split">
            <h2>Live transcript</h2>
            <AudioLines size={19} />
          </div>
          <p className="muted small">
            Transcription appears as local Whisper finishes each chunk.
          </p>
          <ErrorNotice error={lecture.error} retry={lecture.refresh} />
          {segments.length ? (
            <div className="segments">
              {segments.map((segment, i) => (
                <article key={`${segment.id}-${i}`}>
                  <span className="timestamp-label">{time(segment.start)}</span>
                  <div>
                    {segment.speaker && (
                      <strong className="speaker">{segment.speaker}</strong>
                    )}
                    <p>{segment.text}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              icon={AudioLines}
              title={
                state.phase === "recording" || state.phase === "stopping"
                  ? "Listening for the first words"
                  : "Ready when you are"
              }
            >
              {active
                ? "Chunks are sent about every 15 seconds. Transcription time depends on your computer."
                : "Your live transcript will appear here."}
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}

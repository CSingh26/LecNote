import { useEffect, useState } from "react";
import { BookOpen, Clock3, Pencil, Save } from "lucide-react";
import type { Lecture, Question, Settings } from "../types";
import { api, json, lecturePath, message, time } from "../lib/api";
import { Button, Empty, ErrorNotice } from "./ui";
import { Markdown, NoteVisual } from "./Markdown";

export function NotesView({
  lecture,
  onSeek,
  onSaved,
  onDirty,
  prices,
}: {
  lecture: Lecture;
  onSeek: (seconds: number) => void;
  onSaved: () => void;
  onDirty: (dirty: boolean) => void;
  prices?: Pick<
    Settings,
    "input_price_per_million" | "output_price_per_million"
  >;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(lecture.user_notes || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setValue(lecture.user_notes || "");
  }, [lecture.user_notes, editing]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(
        `${lecturePath(lecture.id)}/notes`,
        json("PUT", { user_notes: value }),
      );
      onDirty(false);
      setEditing(false);
      onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  const notes = lecture.notes;
  const estimate =
    notes?.usage &&
    prices &&
    prices.input_price_per_million > 0 &&
    prices.output_price_per_million > 0
      ? (notes.usage.input_tokens * prices.input_price_per_million +
          notes.usage.output_tokens * prices.output_price_per_million) /
        1_000_000
      : null;
  return (
    <div className="notes-layout">
      <div className="notes-content">
        {notes && lecture.notes_stale && (
          <div className="notice warning" role="status">
            Saved notes may be out of date. Lecture inputs have changed since
            they were generated.
          </div>
        )}
        {notes ? (
          <>
            <section className="note-section" id="overview">
              <div className="eyebrow">OVERVIEW</div>
              <h2>{notes.title || lecture.title}</h2>
              <Markdown>{notes.overview}</Markdown>
            </section>
            {!!notes.takeaways?.length && (
              <section className="note-section">
                <h2>Key takeaways</h2>
                <ul className="takeaways">
                  {notes.takeaways.map((item, i) => (
                    <li key={i}>
                      <Markdown>{item}</Markdown>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {notes.chunks?.map((chunk, i) => (
              <section
                className="note-section"
                id={`chunk-${i}`}
                key={`${chunk.index}-${i}`}
              >
                <div className="chunk-heading">
                  <span className="eyebrow">
                    SECTION {String(i + 1).padStart(2, "0")}
                  </span>
                  <Button
                    icon={Clock3}
                    variant="timestamp"
                    onClick={() => onSeek(chunk.start)}
                  >
                    {time(chunk.start)} – {time(chunk.end)}
                  </Button>
                </div>
                <h2>{chunk.title}</h2>
                <Markdown>{chunk.summary}</Markdown>
                {!!chunk.key_points?.length && (
                  <>
                    <h3>Key points</h3>
                    <ul className="key-points">
                      {chunk.key_points.map((point, index) => (
                        <li key={index}>
                          <Markdown>{point.text}</Markdown>
                          <Button
                            variant="timestamp"
                            onClick={() => onSeek(point.timestamp)}
                          >
                            {time(point.timestamp)}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {!!chunk.definitions?.length && (
                  <>
                    <h3>Definitions</h3>
                    <dl>
                      {chunk.definitions.map((entry, index) => (
                        <div key={index}>
                          <dt>{entry.term}</dt>
                          <dd>
                            <Markdown>{entry.definition}</Markdown>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
                {chunk.formulas?.map((formula, index) => (
                  <div className="formula" key={index}>
                    <Markdown>{`$$\n${formula.latex}\n$$`}</Markdown>
                    <Markdown>{formula.explanation}</Markdown>
                  </div>
                ))}
                {!!chunk.examples?.length && (
                  <>
                    <h3>Examples from the lecture</h3>
                    {chunk.examples.map((example, index) => (
                      <Markdown key={index}>{example}</Markdown>
                    ))}
                  </>
                )}
                {!!chunk.emphasized_points?.length && (
                  <aside className="emphasis">
                    <h3>Emphasized in class</h3>
                    {chunk.emphasized_points.map((point, index) => (
                      <Markdown key={index}>{point}</Markdown>
                    ))}
                  </aside>
                )}
                {chunk.visual && (
                  <NoteVisual visual={chunk.visual} lectureId={lecture.id} />
                )}{" "}
                {!!chunk.practice?.length && (
                  <div className="practice">
                    <h3>Supplementary practice</h3>
                    <p className="muted small">
                      Generated practice, beyond the lecture.
                    </p>
                    <Questions questions={chunk.practice} />
                  </div>
                )}
              </section>
            ))}
          </>
        ) : (
          <Empty icon={BookOpen} title="Your notes are next">
            Generate notes from this lecture when the transcript and context are
            ready.
          </Empty>
        )}
        <section className="note-section personal-notes" id="personal-notes">
          <div className="split">
            <h2>My notes</h2>
            {!editing && (
              <Button icon={Pencil} onClick={() => setEditing(true)}>
                Edit notes
              </Button>
            )}
          </div>
          <ErrorNotice error={error} />
          {editing ? (
            <>
              <label className="field">
                <span>Your notes</span>
                <textarea
                  rows={12}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    onDirty(true);
                  }}
                />
              </label>
              <div className="actions">
                <Button
                  disabled={busy}
                  onClick={() => {
                    setValue(lecture.user_notes || "");
                    setEditing(false);
                    onDirty(false);
                  }}
                >
                  Discard changes
                </Button>
                <Button
                  variant="primary"
                  icon={Save}
                  disabled={busy}
                  onClick={save}
                >
                  {busy ? "Saving…" : "Save notes"}
                </Button>
              </div>
            </>
          ) : value ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="muted">
              Add your own observations, questions, and connections.
            </p>
          )}
        </section>
        {notes && (
          <div className="notes-provenance">
            {(notes.provenance?.context ||
              notes.provenance?.resource_provenance?.length) && (
              <details>
                <summary>Used for these notes</summary>
                {notes.provenance.context && <p>{notes.provenance.context}</p>}
                <ul>
                  {notes.provenance.resource_provenance?.map((source) => (
                    <li key={source.id}>
                      {source.name} · Revision {source.revision}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <small>
              {notes.model} ·{" "}
              {(
                (notes.usage?.input_tokens || 0) +
                (notes.usage?.output_tokens || 0)
              ).toLocaleString()}{" "}
              tokens
            </small>
            {estimate !== null && (
              <small>
                Estimated cost for these saved notes:{" "}
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 4,
                  maximumFractionDigits: 6,
                }).format(estimate)}{" "}
                at configured prices.
              </small>
            )}
          </div>
        )}
      </div>
      {notes && (
        <aside className="notes-outline">
          <h3>In this lecture</h3>
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById("overview")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Overview
          </a>
          {notes.chunks?.map((chunk, i) => (
            <button
              key={i}
              onClick={() =>
                document
                  .getElementById(`chunk-${i}`)
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {chunk.title}
            </button>
          ))}
          <button
            onClick={() =>
              document
                .getElementById("personal-notes")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            My notes
          </button>
        </aside>
      )}
    </div>
  );
}
export function Questions({ questions }: { questions: Question[] }) {
  return (
    <div className="questions">
      {questions.map((q, i) => (
        <details key={i}>
          <summary>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {q.question}
          </summary>
          <div>
            <Markdown>{q.answer}</Markdown>
          </div>
        </details>
      ))}
    </div>
  );
}
export function Review({ lecture }: { lecture: Lecture }) {
  const questions = lecture.notes?.review_questions ?? [];
  const glossary = lecture.notes?.glossary ?? [];
  return questions.length || glossary.length ? (
    <div className="review-content">
      {!!questions.length && (
        <section className="note-section">
          <div className="eyebrow">RECALL & REFLECT</div>
          <h2>Review questions</h2>
          <Questions questions={questions} />
        </section>
      )}
      {!!glossary.length && (
        <section className="note-section">
          <h2>Lecture glossary</h2>
          <dl className="glossary-list">
            {glossary.map((entry, i) => (
              <div key={i}>
                <dt>{entry.term}</dt>
                <dd>
                  <Markdown>{entry.definition}</Markdown>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  ) : (
    <Empty icon={BookOpen} title="Nothing to review yet">
      Review questions and definitions appear with generated notes.
    </Empty>
  );
}

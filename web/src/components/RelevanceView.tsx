import { useEffect, useRef, useState } from "react";
import { FileText, Play } from "lucide-react";
import type { Lecture } from "../types";
import {
  activeStatus,
  api,
  json,
  lecturePath,
  message,
  time,
} from "../lib/api";
import { Button, Empty, ErrorNotice } from "./ui";
import "./RelevanceView.css";

const categories = {
  course_material: "Course material",
  class_logistics: "Class logistics",
  off_topic: "Off topic",
  needs_review: "Needs review",
} as const;
type Category = keyof typeof categories;
type Overrides = Record<string, Category>;
type Decision = {
  segment_id: string | number;
  start: number;
  end: number;
  text?: string;
  category: string;
  reason: string;
  confidence?: number;
  source?: string;
};
export type RelevanceLecture = Lecture & {
  relevance?: {
    segments: Decision[];
    topic_map?: { summary: string; topics: string[] };
  } | null;
  relevance_overrides?: Record<string, string> | null;
};
type Props = {
  lecture: RelevanceLecture;
  onSaved: () => void;
  onSeek: (seconds: number) => void;
};
const isCategory = (value: string): value is Category =>
  Object.hasOwn(categories, value);

// The adapter treats every unmatched transcript segment as included, pending review.
function relevanceRows(lecture: RelevanceLecture, overrides: Overrides) {
  const decisions = new Map(
    lecture.relevance?.segments.map((segment) => [
      String(segment.segment_id),
      segment,
    ]),
  );
  return (lecture.transcript?.segments ?? []).map((segment) => {
    const id = String(segment.id);
    const decision = decisions.get(id);
    return {
      ...segment,
      id,
      category:
        overrides[id] ??
        (decision && isCategory(decision.category)
          ? decision.category
          : "needs_review"),
      reason: decision?.reason || "Awaiting review",
      manual: Boolean(overrides[id]) || decision?.source === "manual",
    };
  });
}

export function RelevanceView(props: Props) {
  return <RelevanceEditor key={props.lecture.id} {...props} />;
}

function RelevanceEditor({ lecture, onSaved, onSeek }: Props) {
  const savedOverrides = JSON.stringify(lecture.relevance_overrides ?? {});
  const [overrides, setOverrides] = useState<Overrides>(() =>
    readOverrides(savedOverrides),
  );
  const [filter, setFilter] = useState<Category | "all">("all");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saving.current) setOverrides(readOverrides(savedOverrides));
  }, [savedOverrides]);
  const rows = relevanceRows(lecture, overrides);
  const counts = rows.reduce(
    (count, row) => ({ ...count, [row.category]: count[row.category] + 1 }),
    { course_material: 0, class_logistics: 0, off_topic: 0, needs_review: 0 },
  );
  const visible = rows.filter(
    (row) => filter === "all" || row.category === filter,
  );
  const disabled =
    busy ||
    activeStatus(lecture.status) ||
    Boolean(lecture.job && activeStatus(lecture.job.status));

  async function override(id: string, category: Category) {
    if (disabled || saving.current) return;
    const next = { ...overrides, [id]: category };
    saving.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api<RelevanceLecture>(
        `${lecturePath(lecture.id)}/relevance`,
        json("PUT", { overrides: next }),
      );
      setOverrides(next);
      setSaved(true);
      onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="relevance-view" aria-busy={busy}>
      {lecture.relevance?.topic_map && (
        <section className="relevance-topic-map" aria-label="Lecture topics">
          {lecture.relevance.topic_map.summary && (
            <p>{lecture.relevance.topic_map.summary}</p>
          )}
          {lecture.relevance.topic_map.topics.length > 0 && (
            <ul>
              {lecture.relevance.topic_map.topics.map((topic, index) => (
                <li key={index}>{topic}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div
        className="relevance-filters"
        role="group"
        aria-label="Filter by relevance"
      >
        <button
          type="button"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All ({rows.length})
        </button>
        {Object.entries(categories).map(([category, label]) => (
          <button
            type="button"
            key={category}
            aria-pressed={filter === category}
            onClick={() => setFilter(category as Category)}
          >
            {label} ({counts[category as Category]})
          </button>
        ))}
      </div>
      <ErrorNotice error={error} />
      {(busy || saved || lecture.notes_stale) && (
        <p className="relevance-save-status" role="status">
          {busy ? "Saving category..." : "Saved notes may be out of date."}
        </p>
      )}
      {rows.length === 0 ? (
        <Empty icon={FileText} title="No transcript yet" />
      ) : visible.length === 0 ? (
        <p className="muted relevance-empty">No segments in this category.</p>
      ) : (
        <div className="relevance-segments">
          {visible.map((row) => (
            <article
              key={row.id}
              className={`relevance-segment relevance-${row.category}`}
            >
              <Button
                icon={Play}
                variant="timestamp"
                aria-label={`Seek to ${time(row.start)}`}
                onClick={() => onSeek(row.start)}
              >
                {time(row.start)}
              </Button>
              <div className="relevance-content">
                <p>{row.text}</p>
                <small>
                  {row.manual ? "Manual category" : row.reason}
                  {row.category === "needs_review"
                    ? " · Included pending review"
                    : ""}
                </small>
              </div>
              <select
                aria-label={`Category for segment ${row.id}`}
                value={row.category}
                disabled={disabled}
                onChange={(event) =>
                  void override(row.id, event.target.value as Category)
                }
              >
                {Object.entries(categories).map(([category, label]) => (
                  <option key={category} value={category}>
                    {label}
                  </option>
                ))}
              </select>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function readOverrides(serialized: string): Overrides {
  return Object.fromEntries(
    Object.entries(JSON.parse(serialized) as Record<string, string>).filter(
      (entry): entry is [string, Category] => isCategory(entry[1]),
    ),
  );
}

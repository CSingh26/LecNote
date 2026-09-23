import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  FileAudio,
  FileText,
  Library as LibraryIcon,
  Mic,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import type { Course, Lecture } from "../types";
import { date, time, useResource } from "../lib/api";
import {
  Button,
  CourseSelect,
  Empty,
  ErrorNotice,
  Loading,
  PageHeader,
  Status,
} from "../components/ui";

export function Library({
  courses,
  onNew,
  version,
  initialCourse = "",
}: {
  courses: Course[];
  onNew: (mode: "upload" | "transcript", courseId: string) => void;
  version: number;
  initialCourse?: string;
}) {
  const [course, setCourse] = useState(initialCourse);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const lectures = useResource<Lecture[]>(
    `/lectures?course_id=${encodeURIComponent(course)}&q=${encodeURIComponent(query)}${version ? "&refresh=" + version : ""}`,
    4000,
  );
  const rows = (lectures.data ?? []).filter(
    (item) => !status || item.status === status,
  );
  return (
    <>
      <PageHeader
        eyebrow="Your workspace"
        title="Library"
        actions={
          <>
            <Button icon={Upload} onClick={() => onNew("transcript", course)}>
              Import transcript
            </Button>
            <Button icon={Plus} onClick={() => onNew("upload", course)}>
              New lecture
            </Button>
            <a
              className="button primary"
              href={`#/record${course ? `?course=${encodeURIComponent(course)}` : ""}`}
            >
              <Mic size={16} aria-hidden="true" />
              Record lecture
            </a>
          </>
        }
      />
      <div className="toolbar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search library"
            placeholder="Find a lecture…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <CourseSelect
          courses={courses}
          value={course}
          onChange={setCourse}
          all
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {[
            "draft",
            "queued",
            "transcribing",
            "generating",
            "ready",
            "failed",
            "cancelled",
            "recording",
            "interrupted",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <ErrorNotice error={lectures.error} retry={lectures.refresh} />
      <div className="section-label">
        <span>LECTURES</span>
        <span>
          {lectures.data
            ? `${rows.length} ${rows.length === 1 ? "lecture" : "lectures"}`
            : "—"}
        </span>
      </div>
      {lectures.loading ? (
        <Loading label="Loading lectures" />
      ) : rows.length ? (
        <div className="lecture-list">
          <div className="lecture-list-heading">
            <span>Lecture</span>
            <span>Course</span>
            <span>Status</span>
            <span>Added</span>
            <span />
          </div>
          {rows.map((lecture) => (
            <a
              key={lecture.id}
              className="lecture-row"
              href={`#/lecture/${lecture.id}`}
            >
              <span className="lecture-name">
                <span className="file-icon">
                  {lecture.source_name ? (
                    <FileAudio size={21} />
                  ) : (
                    <FileText size={21} />
                  )}
                </span>
                <span>
                  <strong>{lecture.title}</strong>
                  <small>
                    {lecture.duration
                      ? time(lecture.duration)
                      : "No duration yet"}
                    {lecture.source_name
                      ? ` · ${lecture.source_name}`
                      : " · Transcript"}
                  </small>
                </span>
              </span>
              <span className="course-cell">
                <i
                  style={{ backgroundColor: lecture.course_color || "#a0a59e" }}
                />
                {lecture.course_code || lecture.course_name || "Unassigned"}
              </span>
              <Status status={lecture.status} />
              <span className="date-cell">{date(lecture.created_at)}</span>
              <ArrowUpRight size={17} />
            </a>
          ))}
        </div>
      ) : !lectures.error ? (
        <Empty
          icon={LibraryIcon}
          title={
            query || course || status
              ? "No matching lectures"
              : "Your library starts here"
          }
          action={
            query || course || status ? (
              <Button
                onClick={() => {
                  setQuery("");
                  setCourse("");
                  setStatus("");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <>
                <Button
                  icon={Plus}
                  variant="primary"
                  onClick={() => onNew("upload", course)}
                >
                  New lecture
                </Button>
                <a className="button" href="#/record">
                  Record a lecture
                </a>
              </>
            )
          }
        >
          {query || course || status
            ? "Try a different title, course, or status."
            : "Add a recording or import a transcript to start your collection."}
        </Empty>
      ) : null}
      {!lectures.data?.length && !query && !course && !status && (
        <div className="library-footer">
          <BookOpen size={18} />
          <span>Keep related lectures together.</span>
          <a className="text-link" href="#/courses">
            Create a course
            <ArrowUpRight size={14} />
          </a>
        </div>
      )}
    </>
  );
}

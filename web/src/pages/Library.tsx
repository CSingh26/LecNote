import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  FileAudio,
  FileText,
  Library as LibraryIcon,
  Merge,
  Search,
  Upload,
} from "lucide-react";
import type { Course, Lecture } from "../types";
import { date, time, useResource } from "../lib/api";
import { MergeRecordings } from "../components/MergeRecordings";
import { ActionMenu } from "../components/ActionMenu";
import {
  Button,
  CourseSelect,
  Empty,
  ErrorNotice,
  Loading,
  Status,
} from "../components/ui";

// The compact index drops the year only when it is the current year.
const shortDate = (value: string) => {
  if (!value) return "";
  const when = new Date(value);
  return when.getFullYear() === new Date().getFullYear()
    ? when.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : date(value);
};
const statuses = [
  "draft",
  "queued",
  "transcribing",
  "generating",
  "ready",
  "failed",
  "cancelled",
  "recording",
  "interrupted",
];

export function Library({
  courses,
  onNew,
  onCourseChange,
  version,
  initialCourse = "",
  apiKeyConfigured = false,
  layout = "full",
  selectedLectureId,
}: {
  courses: Course[];
  onNew: (mode: "upload" | "transcript", courseId: string) => void;
  onCourseChange?: (courseId: string) => void;
  version: number;
  initialCourse?: string;
  apiKeyConfigured?: boolean;
  layout?: "full" | "index";
  selectedLectureId?: string;
}) {
  const [course, setCourse] = useState(initialCourse);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [merging, setMerging] = useState(false);
  const lectures = useResource<Lecture[]>(
    `/lectures?course_id=${encodeURIComponent(course)}&q=${encodeURIComponent(query)}${version ? "&refresh=" + version : ""}`,
    4000,
  );
  const rows = (lectures.data ?? []).filter(
    (item) => !status || item.status === status,
  );
  const index = layout === "index";
  const current = courses.find((item) => item.id === course);
  const heading = current?.name || (course ? "Course" : "All courses");
  const Heading = index ? "h2" : "h1";
  const chooseCourse = (value: string) => {
    setCourse(value);
    onCourseChange?.(value);
  };
  // A course chosen in the rail is a destination, not a clearable filter.
  const filtered = Boolean(
    query || status || (course && !onCourseChange && !index),
  );
  const addMenu = (
    <ActionMenu
      label="Add lecture"
      items={[
        {
          id: "upload",
          label: "Upload recording",
          icon: FileAudio,
          onSelect: () => onNew("upload", course),
        },
        {
          id: "transcript",
          label: "Import transcript",
          icon: Upload,
          onSelect: () => onNew("transcript", course),
        },
      ]}
    />
  );
  return (
    <div className={`library library-${layout}`}>
      <header className="library-header">
        <div>
          <Heading>{heading}</Heading>
          {current?.code && (
            <span className="library-code">{current.code}</span>
          )}
          {!index && (
            <p className="library-intro">
              {current
                ? "Your lectures, notes, and ideas. Ready when you are."
                : "A little space for everything you’re learning."}
            </p>
          )}
        </div>
        <div className="actions">{addMenu}</div>
      </header>
      <div className="toolbar">
        <div className="search-input">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search library"
            placeholder="Search lectures"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!index && (
          <CourseSelect
            courses={courses}
            value={course}
            onChange={chooseCourse}
            all
          />
        )}
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <ErrorNotice error={lectures.error} retry={lectures.refresh} />
      <div className="section-label">
        <span>
          {lectures.data
            ? `${rows.length} ${rows.length === 1 ? "lecture" : "lectures"}`
            : "Lectures"}
        </span>
        <Button
          icon={Merge}
          className="quiet"
          onClick={() => setMerging(true)}
          disabled={lectures.loading || !lectures.data?.length}
        >
          Merge recordings
        </Button>
      </div>
      {lectures.loading ? (
        <Loading label="Loading lectures" />
      ) : rows.length ? (
        <div className="lecture-list">
          <div className="lecture-list-heading" aria-hidden="true">
            <span>Title</span>
            {!index && <span>Course</span>}
            <span>Status</span>
            <span>Duration</span>
            <span>Date</span>
          </div>
          <ul>
            {rows.map((lecture) => (
              <li key={lecture.id}>
                <a
                  className="lecture-row"
                  href={`#/lecture/${encodeURIComponent(lecture.id)}`}
                  aria-current={
                    lecture.id === selectedLectureId ? "page" : undefined
                  }
                >
                  <span className="lecture-name">
                    <strong>{lecture.title}</strong>
                    <small>
                      {lecture.source_name ? (
                        <FileAudio size={13} aria-hidden="true" />
                      ) : (
                        <FileText size={13} aria-hidden="true" />
                      )}
                      {lecture.source_name || "Transcript"}
                    </small>
                  </span>
                  {!index && (
                    <span className="course-cell">
                      <i
                        style={{
                          backgroundColor: lecture.course_color || "#c9c5b8",
                        }}
                      />
                      {lecture.course_code ||
                        lecture.course_name ||
                        "Unassigned"}
                    </span>
                  )}
                  <Status status={lecture.status} />
                  <span className="duration-cell">
                    {lecture.duration ? time(lecture.duration) : "—"}
                  </span>
                  <span className="date-cell">
                    {index
                      ? shortDate(lecture.created_at)
                      : date(lecture.created_at)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : !lectures.error ? (
        <Empty
          icon={LibraryIcon}
          title={
            filtered
              ? "No matching lectures"
              : course
                ? "No lectures in this course yet"
                : "Your library starts here"
          }
          action={
            filtered ? (
              <Button
                onClick={() => {
                  setQuery("");
                  setStatus("");
                  if (!onCourseChange && !index) setCourse("");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <>
                <Button
                  icon={FileAudio}
                  variant="primary"
                  onClick={() => onNew("upload", course)}
                >
                  Upload recording
                </Button>
                <Button
                  icon={Upload}
                  onClick={() => onNew("transcript", course)}
                >
                  Import transcript
                </Button>
              </>
            )
          }
        >
          {filtered
            ? "Try a different title or status."
            : "Record a lecture, upload a recording, or import a transcript."}
        </Empty>
      ) : null}
      {!index && !lectures.data?.length && !filtered && !course && (
        <div className="library-footer">
          <BookOpen size={18} aria-hidden="true" />
          <span>Keep related lectures together.</span>
          <a className="text-link" href="#/courses">
            Create a course
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      )}
      {merging && (
        <MergeRecordings
          lectures={lectures.data ?? []}
          apiKeyConfigured={apiKeyConfigured}
          onClose={() => setMerging(false)}
          onSaved={(lecture) => {
            setMerging(false);
            lectures.refresh();
            window.location.hash = `/lecture/${encodeURIComponent(lecture.id)}`;
          }}
        />
      )}
    </div>
  );
}

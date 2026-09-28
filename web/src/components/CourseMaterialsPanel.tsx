import { useId, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  File,
  FileText,
  FolderCog,
  Search,
  X,
} from "lucide-react";
import type { Course, Resource } from "../types";
import { useResource } from "../lib/api";
import { ClassResources, courseResourcesPath } from "./ClassResources";
import { Markdown } from "./Markdown";
import { Button, ErrorNotice, IconButton, Loading } from "./ui";

const typedNote = (resource: Resource) =>
  resource.kind === "note" && !resource.url;
const markdownKind = (resource: Resource) =>
  ["md", "markdown"].includes(resource.kind) || typedNote(resource);
const kindLabel = (resource: Resource) =>
  typedNote(resource)
    ? "Note"
    : resource.kind === "md"
      ? "Markdown"
      : (resource.kind || "File").toUpperCase();

export function CourseMaterialsPanel({
  course,
  layout = "rail",
}: {
  course: Course;
  layout?: "rail" | "page";
}) {
  // A new course starts with a clean search and no stale source preview.
  return <CoursePanel key={course.id} course={course} layout={layout} />;
}

function CoursePanel({
  course,
  layout,
}: {
  course: Course;
  layout: "rail" | "page";
}) {
  const path = courseResourcesPath(course.id);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [managing, setManaging] = useState(false);
  // Narrow layouts collapse the tray below the notes; wide layouts ignore it.
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const resources = useResource<Resource[]>(
    `${path}?q=${encodeURIComponent(query)}`,
  );
  const rows = (resources.data ?? []).filter(
    (resource) => resource.course_id === course.id,
  );
  const selected = rows.find((resource) => resource.id === selectedId);
  const filePath = (resource: Resource) =>
    `/api${path}/${encodeURIComponent(resource.id)}/file`;
  const Heading = layout === "page" ? "h2" : "h3";
  return (
    <section
      className={`course-materials course-materials-${layout} ${expanded ? "is-expanded" : "is-collapsed"}`}
      aria-label={`${course.name} course materials`}
    >
      <header className="course-materials-header">
        <Heading>Course materials</Heading>
        {layout === "rail" && (
          <button
            type="button"
            className="icon-button materials-disclosure"
            aria-expanded={expanded}
            aria-controls={bodyId}
            aria-label={`${expanded ? "Hide" : "Show"} course materials`}
            title={`${expanded ? "Hide" : "Show"} course materials`}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown size={18} aria-hidden="true" />
          </button>
        )}
        <Button
          icon={FolderCog}
          className="quiet"
          aria-label="Manage materials"
          title="Upload, edit, or delete course materials"
          onClick={() => setManaging(true)}
        >
          Manage
        </Button>
      </header>
      <div className="course-materials-body" id={bodyId}>
        <label className="resource-search course-materials-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={`Search ${course.name} materials`}
            placeholder="Search materials"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <ErrorNotice error={resources.error} retry={resources.refresh} />
        {resources.loading ? (
          <Loading label="Loading course materials" />
        ) : rows.length ? (
          <ul className="material-list">
            {rows.map((resource) => (
              <li
                key={resource.id}
                className={resource.id === selectedId ? "selected" : undefined}
              >
                <button
                  type="button"
                  className="material-row"
                  aria-label={`Preview ${resource.name}`}
                  aria-pressed={resource.id === selectedId}
                  onClick={() =>
                    setSelectedId((current) =>
                      current === resource.id ? "" : resource.id,
                    )
                  }
                >
                  <span className={`material-kind kind-${resource.kind}`}>
                    {markdownKind(resource) ||
                    ["txt", "pdf"].includes(resource.kind) ? (
                      <FileText size={18} aria-hidden="true" />
                    ) : (
                      <File size={18} aria-hidden="true" />
                    )}
                  </span>
                  <span className="material-name">
                    <strong>{resource.name}</strong>
                    <small>
                      {kindLabel(resource)}
                      {resource.error
                        ? " · Extraction failed"
                        : !resource.text?.trim()
                          ? " · No readable text"
                          : ""}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : !resources.error ? (
          <p className="muted small course-materials-empty">
            {query
              ? "No matching materials."
              : "No course materials yet. Use Manage materials to add files or notes."}
          </p>
        ) : null}
        {selected && (
          <article className="material-preview" aria-live="polite">
            <header>
              <Heading className="material-preview-title">
                {selected.name}
              </Heading>
              <IconButton
                label="Close preview"
                icon={X}
                onClick={() => setSelectedId("")}
              />
            </header>
            <ErrorNotice error={selected.error || ""} />
            {!selected.text?.trim() ? (
              <p className="muted">No readable text available.</p>
            ) : markdownKind(selected) ? (
              <Markdown>{selected.text}</Markdown>
            ) : (
              <pre className="text-preview">{selected.text}</pre>
            )}
            {!typedNote(selected) && (
              <a
                className="button"
                href={filePath(selected)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} aria-hidden="true" />
                Open original
              </a>
            )}
          </article>
        )}
      </div>
      {managing && (
        <ClassResources
          course={course}
          onClose={() => {
            setManaging(false);
            resources.refresh();
          }}
        />
      )}
    </section>
  );
}

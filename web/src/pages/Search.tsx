import { useEffect, useState } from "react";
import { BookOpen, Search as SearchIcon } from "lucide-react";
import type { Course, GlossaryEntry, SearchResult } from "../types";
import { time, useResource } from "../lib/api";
import {
  Button,
  CourseSelect,
  Empty,
  ErrorNotice,
  LectureLink,
  Loading,
  PageHeader,
} from "../components/ui";

export function Search({ courses }: { courses: Course[] }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [course, setCourse] = useState("");
  const [tab, setTab] = useState("lectures");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const results = useResource<SearchResult[]>(
    tab === "lectures" && debounced.trim()
      ? `/search?q=${encodeURIComponent(debounced.trim())}&course_id=${encodeURIComponent(course)}`
      : null,
  );
  const glossary = useResource<GlossaryEntry[]>(
    tab === "glossary"
      ? `/glossary?course_id=${encodeURIComponent(course)}`
      : null,
  );
  const terms = (glossary.data ?? [])
    .filter((entry) =>
      `${entry.term} ${entry.definition}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => a.term.localeCompare(b.term));
  return (
    <>
      <PageHeader eyebrow="Connect ideas" title="Search" />
      <div className="toolbar">
        <div className="search-input large">
          <SearchIcon size={20} />
          <input
            aria-label="Search all lectures"
            placeholder="Search notes, transcripts, and concepts…"
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
      </div>
      <div className="tabs" role="tablist" aria-label="Search views">
        {["lectures", "glossary"].map((t) => (
          <Button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "lectures" ? "All results" : "Glossary"}
          </Button>
        ))}
      </div>
      <ErrorNotice
        error={tab === "lectures" ? results.error : glossary.error}
        retry={tab === "lectures" ? results.refresh : glossary.refresh}
      />
      {tab === "lectures" ? (
        results.loading ? (
          <Loading label="Searching your library" />
        ) : results.data?.length ? (
          <div className="search-results">
            {results.data.map((result, index) => (
              <article key={`${result.lecture_id}-${index}`}>
                <div className="split">
                  <span className="eyebrow">
                    {result.course_name || "UNASSIGNED"} · {result.kind}
                  </span>
                  {result.timestamp != null && (
                    <span className="timestamp-label">
                      {time(result.timestamp)}
                    </span>
                  )}
                </div>
                <h2>
                  <LectureLink
                    id={result.lecture_id}
                    timestamp={result.timestamp}
                  >
                    {result.title}
                  </LectureLink>
                </h2>
                <p>{result.snippet}</p>
              </article>
            ))}
          </div>
        ) : !results.error ? (
          <Empty
            icon={SearchIcon}
            title={debounced ? "No results found" : "What are you looking for?"}
          >
            {debounced
              ? "Try a different phrase or course."
              : "Search across the lectures in your local library."}
          </Empty>
        ) : null
      ) : glossary.loading ? (
        <Loading label="Loading glossary" />
      ) : terms.length ? (
        <dl className="glossary-list">
          {terms.map((entry, i) => (
            <div key={`${entry.lecture_id}-${entry.term}-${i}`}>
              <dt>{entry.term}</dt>
              <dd>
                {entry.definition}
                <small>
                  <LectureLink id={entry.lecture_id}>
                    {entry.lecture_title}
                  </LectureLink>
                </small>
              </dd>
            </div>
          ))}
        </dl>
      ) : !glossary.error ? (
        <Empty icon={BookOpen} title="No glossary terms yet">
          Terms from generated lecture notes will appear here.
        </Empty>
      ) : null}
    </>
  );
}

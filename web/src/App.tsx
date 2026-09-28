import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Activity,
  BookOpen,
  ChevronRight,
  FolderOpen,
  Library as LibraryIcon,
  Mic,
  PanelLeft,
  Search as SearchIcon,
  SearchX,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import type { Course, RecordingDraft, Settings as SettingsData } from "./types";
import { time, useResource } from "./lib/api";
import { useRecorder } from "./lib/recorder";
import { Library } from "./pages/Library";
import { Courses } from "./pages/Courses";
import { Search } from "./pages/Search";
import { Record } from "./pages/Record";
import { Settings } from "./pages/Settings";
import { Jobs } from "./pages/Jobs";
import { Lecture } from "./pages/Lecture";
import { MaterialsPage } from "./pages/Materials";
import { LectureForm } from "./components/LectureForm";
import { Empty, Loading } from "./components/ui";

const destinations = [
  { path: "library", label: "Library", icon: LibraryIcon },
  { path: "courses", label: "Courses", icon: BookOpen },
  { path: "materials", label: "Materials", icon: FolderOpen },
  { path: "search", label: "Search", icon: SearchIcon },
];
const utilities = [
  { path: "jobs", label: "Jobs", icon: Activity },
  { path: "settings", label: "Settings", icon: SettingsIcon },
];
const navigation = [
  ...destinations,
  { path: "record", label: "Record lecture", icon: Mic },
  ...utilities,
];
const withCourse = (path: string, courseId?: string | null) =>
  `#/${path}${courseId ? `?course=${encodeURIComponent(courseId)}` : ""}`;
export default function App() {
  const [route, setRoute] = useState(window.location.hash || "#/library");
  const [drawer, setDrawer] = useState(false);
  const [create, setCreate] = useState<{
    mode: "upload" | "transcript";
    courseId: string;
  } | null>(null);
  const [version, setVersion] = useState(0);
  const [recordingDraft, setRecordingDraft] = useState<RecordingDraft>();
  const [dirty, setDirty] = useState(false);
  const [resolved, setResolved] = useState<{
    id: string;
    course: string | null;
  }>();
  const lastIndexCourse = useRef<string | null | undefined>(undefined);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const courses = useResource<Course[]>("/courses", 10000);
  const settings = useResource<SettingsData>("/settings");
  const health = useResource<{ status: string }>("/health", 15000);
  const recording = useRecorder();
  const [pathname, query = ""] = route.replace(/^#\/?/, "").split("?");
  const [page = "library", encodedId, ...extra] = (pathname || "library").split(
    "/",
  );
  let id = "";
  try {
    id = encodedId ? decodeURIComponent(encodedId) : "";
  } catch {
    // Malformed links use the same recovery view as an unknown route.
  }
  const knownRoute =
    extra.length === 0 &&
    (page === "lecture"
      ? Boolean(id)
      : !encodedId && navigation.some((item) => item.path === page));
  const params = new URLSearchParams(query);
  const title = knownRoute
    ? page === "record"
      ? "Record"
      : navigation.find((item) => item.path === page)?.label || "Lecture"
    : "Page not found";
  // The lecture route reports its actual course; context from another lecture
  // is never treated as current.
  const lectureCourse =
    page === "lecture" && resolved?.id === id ? resolved.course : undefined;
  if (lectureCourse !== undefined) lastIndexCourse.current = lectureCourse;
  const indexCourse =
    lectureCourse !== undefined ? lectureCourse : lastIndexCourse.current;
  const selectedCourse =
    page === "lecture" ? lectureCourse || "" : params.get("course") || "";
  const onCourseResolved = useCallback(
    (course: string | null) => setResolved({ id, course }),
    [id],
  );
  const changed = () => {
    setVersion((v) => v + 1);
    courses.refresh();
  };
  const selectCourse = (path: string) => (courseId: string) => {
    window.location.hash = withCourse(path, courseId).slice(1);
  };
  useEffect(() => {
    const update = () => {
      if (
        dirty &&
        window.location.hash !== route &&
        !window.confirm("Discard your unsaved edits?")
      ) {
        window.history.replaceState(null, "", route);
        return;
      }
      setDirty(false);
      setRoute(window.location.hash || "#/library");
      setDrawer(false);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, [dirty, route]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  useEffect(() => {
    document.title = `${title} · LecNote`;
  }, [title]);
  useEffect(() => {
    if (!drawer) return;
    document.querySelector<HTMLElement>("#course-rail nav a")?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(false);
        drawerToggle.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [drawer]);
  const courseList = courses.data ?? [];
  const coursePage = page === "materials" ? "materials" : "library";
  const capturing = ["recording", "paused", "stopping", "blocked"].includes(
    recording.phase,
  );
  const online = Boolean(health.data && !health.error);
  return (
    <div className={`app-shell ${page === "lecture" ? "is-reading" : ""}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="app-header">
        <div className="brand-cell">
          <span className="drawer-toggle">
            <button
              ref={drawerToggle}
              type="button"
              className="icon-button"
              aria-label={drawer ? "Close courses" : "Open courses"}
              aria-expanded={drawer}
              aria-controls="course-rail"
              onClick={() => setDrawer((value) => !value)}
            >
              {drawer ? <X size={18} /> : <PanelLeft size={18} />}
            </button>
          </span>
          <a className="brand" href="#/library">
            LecNote
          </a>
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          {destinations.map(({ path, label, icon: Icon }) => (
            <a
              key={path}
              href={
                path === "materials" || path === "library"
                  ? withCourse(path, selectedCourse)
                  : `#/${path}`
              }
              aria-current={
                page === path || (path === "library" && page === "lecture")
                  ? "page"
                  : undefined
              }
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <a
            className={`button record-action ${capturing ? "is-live" : ""}`}
            href={withCourse("record", selectedCourse)}
            aria-current={page === "record" ? "page" : undefined}
          >
            <span className="record-mark" aria-hidden="true" />
            {capturing ? (
              <>
                <span>
                  {recording.phase === "paused" ? "Paused" : "Recording"}
                </span>
                <span className="record-elapsed">
                  {time(recording.elapsed)}
                </span>
              </>
            ) : (
              <span>Record lecture</span>
            )}
          </a>
          <nav className="utility-nav" aria-label="Utilities">
            {utilities.map(({ path, label, icon: Icon }) => (
              <a
                key={path}
                href={`#/${path}`}
                aria-current={page === path ? "page" : undefined}
                title={label}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </a>
            ))}
          </nav>
        </div>
      </header>
      {drawer && (
        <button
          className="drawer-scrim"
          aria-label="Close courses"
          tabIndex={-1}
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        id="course-rail"
        className={`course-rail ${drawer ? "open" : ""}`}
        aria-label="Course index"
      >
        <nav aria-label="Courses">
          <h2 className="rail-heading">My courses</h2>
          <a
            href={`#/${coursePage}`}
            className="rail-all"
            aria-current={
              !selectedCourse && page !== "lecture" ? "page" : undefined
            }
          >
            All courses
          </a>
          {courseList.map((course) => (
            <a
              key={course.id}
              href={withCourse(coursePage, course.id)}
              aria-current={selectedCourse === course.id ? "page" : undefined}
              style={{ "--course": course.color } as CSSProperties}
            >
              {course.code && <strong>{course.code}</strong>}
              <span>{course.name}</span>
            </a>
          ))}
          {!courses.loading && !courseList.length && (
            <span className="rail-empty">No courses yet</span>
          )}
        </nav>
        <a className="rail-manage" href="#/courses">
          Manage courses
          <ChevronRight size={14} aria-hidden="true" />
        </a>
        <div className="rail-footer">
          <i className={online ? "online-dot" : "offline-dot"} />
          <span>
            {health.error
              ? "Server unavailable"
              : health.data
                ? "Local workspace"
                : "Connecting…"}
          </span>
        </div>
      </aside>
      <div className="workspace">
        {capturing && page !== "record" && (
          <a className="recording-banner" href="#/record">
            <Mic size={17} />
            <strong>
              {recording.phase === "recording"
                ? "Recording in progress"
                : recording.phase === "paused"
                  ? "Recording paused"
                  : recording.phase === "blocked"
                    ? "Recording needs attention"
                    : "Saving recording"}
            </strong>
            <span>{time(recording.elapsed)}</span>
            <span>
              Open recorder
              <ChevronRight size={15} />
            </span>
          </a>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          key={page === "lecture" ? "lecture" : page}
        >
          {!knownRoute ? (
            <Empty
              icon={SearchX}
              title="Page not found"
              action={
                <a className="button primary" href="#/library">
                  <LibraryIcon size={16} aria-hidden="true" />
                  Back to library
                </a>
              }
            />
          ) : page === "courses" ? (
            <Courses
              courses={courseList}
              loading={courses.loading}
              error={courses.error}
              refresh={courses.refresh}
            />
          ) : page === "materials" ? (
            <MaterialsPage
              courses={courseList}
              initialCourse={params.get("course") || ""}
              onCourseChange={selectCourse("materials")}
            />
          ) : page === "search" ? (
            <Search courses={courseList} />
          ) : page === "record" ? (
            <Record
              courses={courseList}
              settings={settings.data}
              initialDraft={recordingDraft}
              initialCourse={params.get("course") || ""}
            />
          ) : page === "settings" ? (
            <Settings
              settings={settings.data}
              error={settings.error}
              refresh={settings.refresh}
              onSaved={settings.refresh}
            />
          ) : page === "jobs" ? (
            <Jobs />
          ) : page === "lecture" && id ? (
            <div className="reading-workspace">
              <section className="lecture-index" aria-label="Lecture index">
                {indexCourse === undefined ? (
                  <Loading label="Loading lectures" />
                ) : (
                  <Library
                    key={`index-${indexCourse || "all"}`}
                    layout="index"
                    selectedLectureId={id}
                    courses={courseList}
                    onNew={(mode, courseId) => setCreate({ mode, courseId })}
                    version={version}
                    initialCourse={indexCourse || ""}
                    apiKeyConfigured={Boolean(
                      settings.data?.api_key_configured,
                    )}
                  />
                )}
              </section>
              <div className="reader-column" key={id}>
                <Lecture
                  id={id}
                  courses={courseList}
                  settings={settings.data}
                  onChanged={changed}
                  onDirty={setDirty}
                  dirty={dirty}
                  seekTo={params.has("t") ? Number(params.get("t")) : null}
                  onCourseResolved={onCourseResolved}
                />
              </div>
            </div>
          ) : (
            <Library
              key={params.get("course") || "all"}
              courses={courseList}
              onNew={(mode, courseId) => setCreate({ mode, courseId })}
              onCourseChange={selectCourse("library")}
              version={version}
              initialCourse={params.get("course") || ""}
              apiKeyConfigured={Boolean(settings.data?.api_key_configured)}
            />
          )}
        </main>
      </div>
      {create && (
        <LectureForm
          courses={courseList}
          settings={settings.data}
          initialMode={create.mode}
          initialCourse={create.courseId}
          onClose={() => setCreate(null)}
          onRecord={(draft) => {
            setRecordingDraft(draft);
            setCreate(null);
            window.location.hash = "/record";
          }}
          onSaved={(lecture) => {
            setCreate(null);
            changed();
            window.location.hash = `/lecture/${lecture.id}`;
          }}
        />
      )}
    </div>
  );
}

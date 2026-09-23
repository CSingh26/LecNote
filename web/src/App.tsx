import { useEffect, useState } from "react";
import {
  Activity,
  AudioLines,
  BookOpen,
  ChevronRight,
  Library as LibraryIcon,
  Menu,
  Mic,
  Monitor,
  Search as SearchIcon,
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
import { LectureForm } from "./components/LectureForm";
import { IconButton } from "./components/ui";

const navigation = [
  { path: "library", label: "Library", icon: LibraryIcon },
  { path: "courses", label: "Courses", icon: BookOpen },
  { path: "search", label: "Search", icon: SearchIcon },
  { path: "record", label: "Record", icon: Mic },
  { path: "jobs", label: "Jobs", icon: Activity },
  { path: "settings", label: "Settings", icon: SettingsIcon },
];
export default function App() {
  const [route, setRoute] = useState(window.location.hash || "#/library");
  const [mobile, setMobile] = useState(false);
  const [create, setCreate] = useState<"upload" | "transcript" | null>(null);
  const [version, setVersion] = useState(0);
  const [recordingDraft, setRecordingDraft] = useState<RecordingDraft>();
  const [dirty, setDirty] = useState(false);
  const courses = useResource<Course[]>("/courses", 10000);
  const settings = useResource<SettingsData>("/settings");
  const health = useResource<{ status: string }>("/health", 15000);
  const recording = useRecorder();
  const [pathname, query = ""] = route.replace(/^#\/?/, "").split("?");
  const [page = "library", id] = pathname.split("/");
  const params = new URLSearchParams(query);
  const title =
    navigation.find((item) => item.path === page)?.label || "Lecture";
  const changed = () => {
    setVersion((v) => v + 1);
    courses.refresh();
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
      setMobile(false);
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
    if (!mobile) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobile]);
  const courseList = courses.data ?? [];
  return (
    <div className="app-shell">
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
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href="#/library">
          <span className="brand-icon">
            <AudioLines size={23} />
          </span>
          <span>
            LecNote<small>LECTURE WORKSPACE</small>
          </span>
        </a>
        <div className="sidebar-heading">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ path, label, icon: Icon }) => (
            <a
              href={`#/${path}`}
              key={path}
              aria-current={page === path ? "page" : undefined}
              className={page === path ? "selected" : ""}
            >
              <Icon size={19} />
              <span>{label}</span>
              {path === "record" && recording.phase === "recording" && (
                <i className="live-dot" />
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-courses">
          <div className="sidebar-heading">
            COURSES{" "}
            <a href="#/courses" aria-label="Manage courses">
              +
            </a>
          </div>
          {courseList.length ? (
            courseList.slice(0, 8).map((course) => (
              <a key={course.id} href={`#/library?course=${course.id}`}>
                <i style={{ backgroundColor: course.color }} />
                <span>{course.code || course.name}</span>
              </a>
            ))
          ) : (
            <span className="muted small">No courses yet</span>
          )}
        </div>
        <div className="sidebar-footer">
          <Monitor size={17} />
          <div>
            <strong>Local workspace</strong>
            <span>
              {health.error
                ? "Server unavailable"
                : health.data
                  ? "Connected to this computer"
                  : "Connecting…"}
            </span>
          </div>
          <i
            className={
              health.data && !health.error ? "online-dot" : "offline-dot"
            }
          />
        </div>
      </aside>
      <div className="workspace">
        <div className="topbar">
          <div className="breadcrumb">
            <span className="mobile-toggle">
              <IconButton
                label={mobile ? "Close navigation" : "Open navigation"}
                icon={mobile ? X : Menu}
                onClick={() => setMobile((v) => !v)}
              />
            </span>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <span className="local-label">
            <i
              className={
                health.data && !health.error ? "online-dot" : "offline-dot"
              }
            />
            {health.error ? "Offline" : "LOCAL"}
          </span>
        </div>
        {["recording", "stopping", "blocked"].includes(recording.phase) &&
          page !== "record" && (
            <a className="recording-banner" href="#/record">
              <Mic size={17} />
              <strong>
                {recording.phase === "recording"
                  ? "Recording in progress"
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
          key={page === "lecture" ? id : page}
        >
          {page === "courses" ? (
            <Courses
              courses={courseList}
              loading={courses.loading}
              error={courses.error}
              refresh={courses.refresh}
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
            <Lecture
              id={decodeURIComponent(id)}
              courses={courseList}
              settings={settings.data}
              onChanged={changed}
              onDirty={setDirty}
              dirty={dirty}
              seekTo={params.has("t") ? Number(params.get("t")) : null}
            />
          ) : (
            <Library
              key={params.get("course") || "all"}
              courses={courseList}
              onNew={setCreate}
              version={version}
              initialCourse={params.get("course") || ""}
            />
          )}
        </main>
      </div>
      {create && (
        <LectureForm
          courses={courseList}
          settings={settings.data}
          initialMode={create}
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

import { useState, type FormEvent } from "react";
import { BookOpen, Files, Pencil, Plus, Trash2 } from "lucide-react";
import type { Course } from "../types";
import { ClassResources } from "../components/ClassResources";
import { api, json, message } from "../lib/api";
import {
  Button,
  Confirm,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Loading,
  Modal,
  PageHeader,
} from "../components/ui";

const colors = [
  "#235b44",
  "#46767a",
  "#57629b",
  "#916482",
  "#b48b37",
  "#a45e57",
  "#68765c",
  "#687078",
];
export function Courses({
  courses,
  loading,
  error,
  refresh,
}: {
  courses: Course[];
  loading: boolean;
  error: string;
  refresh: () => void;
}) {
  const [edit, setEdit] = useState<Course | "new" | null>(null);
  const [remove, setRemove] = useState<Course | null>(null);
  const [resources, setResources] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  async function deleteCourse() {
    if (!remove) return;
    setBusy(true);
    setActionError("");
    try {
      await api(`/courses/${remove.id}`, json("DELETE"));
      setRemove(null);
      refresh();
    } catch (error) {
      setActionError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Organize"
        title="Courses"
        actions={
          <Button icon={Plus} variant="primary" onClick={() => setEdit("new")}>
            New course
          </Button>
        }
      />
      <ErrorNotice error={error} retry={refresh} />
      {loading ? (
        <Loading />
      ) : courses.length ? (
        <div className="course-list">
          {courses.map((course) => (
            <article className="course-row" key={course.id}>
              <div
                className="course-mark"
                style={{ borderColor: course.color, color: course.color }}
              >
                <BookOpen size={23} />
              </div>
              <div className="course-details">
                <div className="eyebrow">{course.code || "COURSE"}</div>
                <h2>
                  <a href={`#/library?course=${course.id}`}>{course.name}</a>
                </h2>
                <p>{course.context || "No course context added."}</p>
                <small>
                  {course.lecture_count}{" "}
                  {course.lecture_count === 1 ? "lecture" : "lectures"}
                </small>
              </div>
              <div className="actions">
                <IconButton
                  label={`Resources for ${course.name}`}
                  icon={Files}
                  onClick={() => setResources(course)}
                />
                <IconButton
                  label={`Edit ${course.name}`}
                  icon={Pencil}
                  onClick={() => setEdit(course)}
                />
                <IconButton
                  label={`Delete ${course.name}`}
                  icon={Trash2}
                  disabled={course.lecture_count > 0}
                  title={
                    course.lecture_count > 0
                      ? "Move or delete the course lectures first"
                      : `Delete ${course.name}`
                  }
                  onClick={() => {
                    setRemove(course);
                    setActionError("");
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      ) : !error ? (
        <Empty icon={BookOpen} title="Make room for a subject">
          Create a course to group lectures and keep shared terminology close.
        </Empty>
      ) : null}
      {edit && (
        <CourseForm
          course={edit === "new" ? undefined : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            refresh();
          }}
        />
      )}
      {resources && (
        <ClassResources
          key={resources.id}
          course={resources}
          onClose={() => setResources(null)}
        />
      )}
      {remove && (
        <Confirm
          title={`Delete ${remove.name}?`}
          busy={busy}
          error={actionError}
          onClose={() => setRemove(null)}
          onConfirm={deleteCourse}
        >
          This removes the empty course from your workspace.
        </Confirm>
      )}
    </>
  );
}
function CourseForm({
  course,
  onClose,
  onSaved,
}: {
  course?: Course;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(course?.name ?? "");
  const [code, setCode] = useState(course?.code ?? "");
  const [context, setContext] = useState(course?.context ?? "");
  const [vocabulary, setVocabulary] = useState(course?.vocabulary ?? "");
  const [color, setColor] = useState(course?.color ?? colors[0]);
  const [compression, setCompression] = useState(
    course?.optimize_recordings == null
      ? "inherit"
      : String(course.optimize_recordings),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        course ? `/courses/${course.id}` : "/courses",
        json(course ? "PATCH" : "POST", {
          name: name.trim(),
          code: code.trim(),
          color,
          context,
          vocabulary,
          optimize_recordings:
            compression === "inherit" ? null : compression === "true",
        }),
      );
      onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={course ? "Edit course" : "New course"}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          <Field label="Course name">
            <input
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Course code">
            <input
              maxLength={40}
              placeholder="e.g. PHY 101"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <fieldset className="swatches">
            <legend>Course color</legend>
            {colors.map((option, i) => (
              <button
                key={option}
                type="button"
                title={`Color ${i + 1}`}
                aria-label={`Color ${i + 1}`}
                aria-pressed={color === option}
                style={{ backgroundColor: option }}
                onClick={() => setColor(option)}
              />
            ))}
          </fieldset>
          <Field label="Course context">
            <textarea
              rows={3}
              placeholder="Topics, syllabus, and learning goals"
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </Field>
          <Field
            label="Vocabulary"
            hint="Names and subject-specific terms to improve local transcription."
          >
            <textarea
              rows={3}
              value={vocabulary}
              onChange={(e) => setVocabulary(e.target.value)}
            />
          </Field>
          <ErrorNotice error={error} />
          <Field label="Audio compression">
            <select
              value={compression}
              onChange={(event) => setCompression(event.target.value)}
            >
              <option value="inherit">Workspace setting</option>
              <option value="true">Compress after six hours</option>
              <option value="false">Keep original audio</option>
            </select>
          </Field>
        </div>
        <footer>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : course ? "Save course" : "Create course"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

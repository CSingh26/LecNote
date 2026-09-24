import { useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import type { Course, Resource } from "../types";
import { api, date, json, message, useResource } from "../lib/api";
import { Button, ErrorNotice, Field, IconButton, Loading, Modal } from "./ui";
import "./Preparation.css";

export const courseResourcesPath = (courseId: string) =>
  `/courses/${encodeURIComponent(courseId)}/resources`;

export const readableResource = (resource: Resource, courseId: string | null) =>
  resource.course_id === courseId && Boolean(resource.text?.trim());

export function ClassResources({
  course,
  onClose,
}: {
  course: Course;
  onClose: () => void;
}) {
  const path = courseResourcesPath(course.id);
  const [query, setQuery] = useState("");
  const resources = useResource<Resource[]>(
    `${path}?q=${encodeURIComponent(query)}`,
  );
  const input = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState<Resource | "new" | null>(null);
  const [selected, setSelected] = useState<Resource | null>(null);
  const [remove, setRemove] = useState<Resource | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const noteDirty =
    edit !== null &&
    (name !== (edit === "new" ? "" : edit.name) ||
      text !== (edit === "new" ? "" : edit.text));
  const filePath = (resource: Resource) =>
    `/api${path}/${encodeURIComponent(resource.id)}/file`;
  function close() {
    if (!noteDirty || window.confirm("Discard your unsaved resource note?"))
      onClose();
  }
  function back() {
    if (noteDirty && !window.confirm("Discard your unsaved resource note?"))
      return;
    setEdit(null);
    setSelected(null);
    setRemove(null);
    setError("");
  }
  function editNote(resource: Resource | "new") {
    setName(resource === "new" ? "" : resource.name);
    setText(resource === "new" ? "" : resource.text);
    setEdit(resource);
    setError("");
  }
  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        await api(path, { method: "POST", body });
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      resources.refresh();
    }
  }
  async function saveNote(event: FormEvent) {
    event.preventDefault();
    if (!edit || busy || !name.trim() || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(
        edit === "new"
          ? `${path}/note`
          : `${path}/${encodeURIComponent(edit.id)}`,
        json(edit === "new" ? "POST" : "PATCH", { name: name.trim(), text }),
      );
      setEdit(null);
      setSelected(null);
      resources.refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function deleteResource() {
    if (!remove || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`${path}/${encodeURIComponent(remove.id)}`, json("DELETE"));
      setRemove(null);
      resources.refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${course.name} resources`} wide busy={busy} onClose={close}>
      <div className="modal-body class-resources">
        {(edit || selected || remove) && (
          <Button icon={ArrowLeft} disabled={busy} onClick={back}>
            All resources
          </Button>
        )}
        <ErrorNotice error={error} />
        {edit ? (
          <form onSubmit={saveNote}>
            <fieldset disabled={busy} className="resource-note-fields">
              <h3>{edit === "new" ? "New note" : "Edit note"}</h3>
              <Field label="Resource name">
                <input
                  required
                  maxLength={200}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field label="Note text">
                <textarea
                  required
                  rows={10}
                  maxLength={100000}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </Field>
              <Button
                icon={Save}
                type="submit"
                variant="primary"
                disabled={!name.trim() || !text.trim()}
              >
                {busy ? "Saving..." : "Save note"}
              </Button>
            </fieldset>
          </form>
        ) : remove ? (
          <div className="resource-note-fields">
            <h3>Delete {remove.name}?</h3>
            <p>
              This resource will be removed from the course and future lecture
              preparation.
            </p>
            <div className="actions">
              <Button disabled={busy} onClick={back}>
                Cancel
              </Button>
              <Button
                icon={Trash2}
                variant="danger"
                disabled={busy}
                onClick={() => void deleteResource()}
              >
                {busy ? "Deleting..." : "Delete resource"}
              </Button>
            </div>
          </div>
        ) : selected ? (
          <div className="resource-note-fields">
            <h3>{selected.name}</h3>
            <ErrorNotice error={selected.error || ""} />
            <pre className="text-preview">
              {selected.text || "No readable text available."}
            </pre>
            {selected.kind !== "note" && (
              <a
                className="button"
                href={filePath(selected)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} />
                Open original
              </a>
            )}
            {selected.kind === "note" && (
              <Button icon={Pencil} onClick={() => editNote(selected)}>
                Edit note
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="resource-toolbar">
              <label className="resource-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search class resources"
                  placeholder="Search resources"
                  value={query}
                  disabled={busy}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="actions">
                <Button
                  icon={Upload}
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  {busy ? "Uploading..." : "Upload"}
                </Button>
                <Button
                  icon={Plus}
                  disabled={busy}
                  onClick={() => editNote("new")}
                >
                  New note
                </Button>
              </div>
              <input
                ref={input}
                className="sr-only"
                tabIndex={-1}
                type="file"
                multiple
                disabled={busy}
                aria-label="Upload class resources"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md"
                onChange={(event) => void upload(event.target.files)}
              />
            </div>
            <ErrorNotice error={resources.error} retry={resources.refresh} />
            {resources.loading ? (
              <Loading label="Loading class resources" />
            ) : (
              <ul className="class-resource-list">
                {(resources.data || [])
                  .filter((resource) => resource.course_id === course.id)
                  .map((resource) => (
                    <li key={resource.id} className="class-resource-row">
                      <FileText size={20} aria-hidden="true" />
                      <div className="class-resource-info">
                        <button
                          className="plain"
                          onClick={() => setSelected(resource)}
                          disabled={busy}
                        >
                          {resource.name}
                        </button>
                        <small>
                          {resource.kind === "note" ? "Note" : resource.kind} ·{" "}
                          {date(resource.updated_at)} · Revision{" "}
                          {resource.revision}
                        </small>
                        {resource.error ? (
                          <span className="attachment-error">
                            {resource.error}
                          </span>
                        ) : (
                          !resource.text?.trim() && (
                            <span className="muted small">
                              No readable text
                            </span>
                          )
                        )}
                      </div>
                      <div className="actions">
                        {resource.kind === "note" ? (
                          <IconButton
                            icon={Pencil}
                            label={`Edit ${resource.name}`}
                            disabled={busy}
                            onClick={() => editNote(resource)}
                          />
                        ) : (
                          <a
                            className="icon-button"
                            href={filePath(resource)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${resource.name}`}
                            title={`Open ${resource.name}`}
                          >
                            <ExternalLink size={18} />
                          </a>
                        )}
                        <IconButton
                          icon={Trash2}
                          label={`Delete ${resource.name}`}
                          disabled={busy}
                          onClick={() => {
                            setRemove(resource);
                            setError("");
                          }}
                        />
                      </div>
                    </li>
                  ))}
              </ul>
            )}
            {!resources.loading &&
              !resources.error &&
              !resources.data?.some(
                (resource) => resource.course_id === course.id,
              ) && (
                <p className="muted">
                  {query ? "No matching resources." : "No class resources yet."}
                </p>
              )}
          </>
        )}
      </div>
    </Modal>
  );
}

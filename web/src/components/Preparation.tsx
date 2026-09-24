import { useEffect, useRef, useState, type FormEvent } from "react";
import { RotateCcw, Save } from "lucide-react";
import type { Lecture, Resource } from "../types";
import { api, json, lecturePath, message, useResource } from "../lib/api";
import { Button, ErrorNotice, Field, Loading } from "./ui";
import { courseResourcesPath, readableResource } from "./ClassResources";
import "./Preparation.css";

function snapshot(lecture: Lecture) {
  return {
    context: lecture.context || "",
    selected_resource_ids: lecture.selected_resource_ids || [],
    course_id: lecture.course_id,
    preparation_ready: lecture.preparation_ready === true,
  };
}
const sameIds = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id) => right.includes(id));

export function Preparation({
  lecture,
  disabled = false,
  onSaved,
  onDirty,
  onReady,
  onBusy,
}: {
  lecture: Lecture;
  disabled?: boolean;
  onSaved: (lecture: Lecture) => void;
  onDirty: (dirty: boolean) => void;
  onReady: (ready: boolean) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [saved, setSaved] = useState(() => snapshot(lecture));
  const [context, setContext] = useState(saved.context);
  const [ids, setIds] = useState(saved.selected_resource_ids);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const incoming = JSON.stringify(snapshot(lecture));
  const lastIncoming = useRef(incoming);
  const resources = useResource<Resource[]>(
    lecture.course_id ? courseResourcesPath(lecture.course_id) : null,
  );
  const sameCourse = saved.course_id === lecture.course_id;
  const localEdits =
    context !== saved.context || !sameIds(ids, saved.selected_resource_ids);
  const dirty = localEdits || !sameCourse;
  const readable = (resources.data || []).filter((resource) =>
    readableResource(resource, lecture.course_id),
  );
  const validIds = ids.filter((id) =>
    readable.some((resource) => resource.id === id),
  );
  const invalidSelection = !sameCourse || validIds.length !== ids.length;
  const checkingSelection =
    ids.length > 0 && (resources.loading || Boolean(resources.error));
  const ready =
    saved.preparation_ready &&
    !dirty &&
    !saving &&
    !invalidSelection &&
    !checkingSelection;

  useEffect(() => {
    if (lastIncoming.current === incoming) return;
    lastIncoming.current = incoming;
    const next = JSON.parse(incoming) as ReturnType<typeof snapshot>;
    // Polling may update job state while a recording note is being edited.
    setSaved(next);
    if (!localEdits) {
      setContext(next.context);
      setIds(next.selected_resource_ids);
    } else if (next.course_id !== saved.course_id) {
      setIds([]);
    }
  }, [incoming, localEdits, saved]);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    onReady(ready);
  }, [ready, onReady]);
  useEffect(() => {
    onBusy?.(saving);
  }, [saving, onBusy]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || saving || checkingSelection || invalidSelection) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<Lecture>(
        `${lecturePath(lecture.id)}/preparation`,
        json("PUT", {
          context,
          selected_resource_ids: validIds,
        }),
      );
      const next = snapshot(result);
      setSaved(next);
      setContext(next.context);
      setIds(next.selected_resource_ids);
      onSaved(result);
    } catch (error) {
      setError(message(error));
    } finally {
      setSaving(false);
    }
  }
  function discard() {
    const next = saved;
    setSaved(next);
    setContext(next.context);
    setIds(next.selected_resource_ids);
    setError("");
  }
  const visibleResources = (resources.data || []).filter(
    (resource) =>
      resource.course_id === lecture.course_id &&
      `${resource.name} ${resource.text}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <section
      className="lecture-preparation"
      aria-labelledby="preparation-title"
    >
      <form onSubmit={save}>
        <fieldset disabled={disabled || saving}>
          <div className="resource-toolbar">
            <h2 id="preparation-title">Preparation</h2>
            <span className="muted small" role="status">
              {dirty
                ? "Unsaved preparation"
                : ready
                  ? "Preparation saved"
                  : "Preparation required"}
            </span>
          </div>
          <Field label="Recording note">
            <textarea
              rows={3}
              maxLength={100000}
              value={context}
              onChange={(event) => setContext(event.target.value)}
            />
          </Field>
          {lecture.course_id && (
            <div className="preparation-resources">
              <div className="resource-toolbar">
                <h3>Class resources</h3>
                <Button icon={RotateCcw} onClick={resources.refresh}>
                  Refresh resources
                </Button>
              </div>
              <Field label="Find class resources">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </Field>
              <ErrorNotice error={resources.error} retry={resources.refresh} />
              {resources.loading ? (
                <Loading label="Loading preparation resources" />
              ) : (
                <div className="preparation-options">
                  {visibleResources.map((resource) => (
                    <label className="preparation-option" key={resource.id}>
                      <input
                        type="checkbox"
                        checked={sameCourse && ids.includes(resource.id)}
                        disabled={
                          !readableResource(resource, lecture.course_id) ||
                          Boolean(resources.error) ||
                          (ids.length >= 50 && !ids.includes(resource.id))
                        }
                        onChange={(event) =>
                          setIds((current) =>
                            event.target.checked
                              ? [...current, resource.id]
                              : current.filter((id) => id !== resource.id),
                          )
                        }
                      />
                      <span>
                        {resource.name}
                        <small>
                          {resource.error ||
                            (!resource.text?.trim()
                              ? "No readable text"
                              : `Revision ${resource.revision}`)}
                        </small>
                      </span>
                    </label>
                  ))}
                  {!visibleResources.length && !resources.error && (
                    <p className="muted small">
                      {query
                        ? "No matching resources."
                        : "No class resources yet."}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {invalidSelection && !checkingSelection && (
            <div className="notice warning" role="alert">
              <span>
                Some selected resources are no longer available for this course.
              </span>
              <Button onClick={() => setIds(validIds)}>
                Remove unavailable selections
              </Button>
            </div>
          )}
          <ErrorNotice error={error} />
          <div className="resource-toolbar preparation-actions">
            <span className="muted small">
              {!ready && !dirty
                ? "Save a recording note or class resource selection before generating notes."
                : `${ids.length} class resources selected`}
            </span>
            <div className="actions">
              {dirty && (
                <Button icon={RotateCcw} onClick={discard}>
                  Discard changes
                </Button>
              )}
              <Button
                icon={Save}
                type="submit"
                variant="primary"
                disabled={
                  checkingSelection ||
                  invalidSelection ||
                  (!dirty && saved.preparation_ready)
                }
              >
                {saving ? "Saving..." : "Save preparation"}
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

import { useRef, useState } from "react";
import {
  ExternalLink,
  File,
  FileText,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import type { Attachment, Lecture } from "../types";
import { api, date, json, lecturePath, message } from "../lib/api";
import { Button, Confirm, Empty, ErrorNotice, IconButton, Modal } from "./ui";

const imageKind = (kind: string) =>
  ["png", "jpg", "jpeg", "webp"].includes(kind);

export function Materials({
  lecture,
  onSaved,
}: {
  lecture: Lecture;
  onSaved: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Attachment | null>(null);
  const [remove, setRemove] = useState<Attachment | null>(null);
  const path = (attachment: Attachment) =>
    `/api${lecturePath(lecture.id)}/attachments/${encodeURIComponent(attachment.id)}`;
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        await api(`${lecturePath(lecture.id)}/attachments`, {
          method: "POST",
          body: form,
        });
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      onSaved();
    }
  }
  async function deleteAttachment() {
    if (!remove) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `${lecturePath(lecture.id)}/attachments/${remove.id}`,
        json("DELETE"),
      );
      setRemove(null);
      onSaved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="materials-view">
      <div className="split">
        <div>
          <h2>Source materials</h2>
          <p className="muted">Any file type, up to 30 MiB each.</p>
        </div>
        <Button
          icon={Upload}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "Uploading…" : "Add materials"}
        </Button>
        <input
          ref={input}
          className="sr-only"
          tabIndex={-1}
          aria-label="Upload source materials"
          type="file"
          multiple
          disabled={busy}
          onChange={(e) => void upload(e.target.files)}
        />
      </div>
      <ErrorNotice error={error} />
      {lecture.attachments?.length ? (
        <div className="attachment-grid">
          {lecture.attachments.map((attachment) => (
            <article className="attachment" key={attachment.id}>
              <button
                className="attachment-preview"
                onClick={() => setSelected(attachment)}
                aria-label={`View ${attachment.name}`}
              >
                {imageKind(attachment.kind) ? (
                  <img
                    src={path(attachment)}
                    alt={attachment.name}
                    loading="lazy"
                  />
                ) : (
                  <>
                    {["txt", "md", "pdf"].includes(attachment.kind) ? (
                      <FileText size={36} />
                    ) : (
                      <File size={36} />
                    )}
                    <span>{attachment.kind.toUpperCase() || "FILE"}</span>
                  </>
                )}
              </button>
              <div className="attachment-info">
                <button
                  className="plain attachment-title"
                  onClick={() => setSelected(attachment)}
                >
                  {attachment.name}
                </button>
                <small>{date(attachment.created_at)}</small>
                <div className="actions">
                  <a
                    className="icon-button"
                    href={path(attachment)}
                    title={`Open ${attachment.name}`}
                    aria-label={`Open ${attachment.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={17} />
                  </a>
                  <IconButton
                    label={`Delete ${attachment.name}`}
                    icon={Trash2}
                    onClick={() => {
                      setRemove(attachment);
                      setError("");
                    }}
                  />
                </div>
                {attachment.error && (
                  <p className="attachment-error">{attachment.error}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty icon={Paperclip} title="No source materials yet">
          Add files for this lecture. Originals are kept for download.
        </Empty>
      )}
      {selected && (
        <Modal title={selected.name} wide onClose={() => setSelected(null)}>
          <div className="modal-body preview-body">
            {imageKind(selected.kind) ? (
              <img src={path(selected)} alt={selected.name} />
            ) : selected.kind === "pdf" ? (
              <iframe sandbox="" title={selected.name} src={path(selected)} />
            ) : (
              <pre className="text-preview">
                {selected.text ||
                  "No readable text. The original is available for download."}
              </pre>
            )}
            <ErrorNotice error={selected.error || ""} />
            <a
              className="button"
              href={path(selected)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              Open source
            </a>
            {selected.text && (
              <details>
                <summary>Extracted text</summary>
                <pre className="text-preview">{selected.text}</pre>
              </details>
            )}
          </div>
        </Modal>
      )}
      {remove && (
        <Confirm
          title="Delete attachment?"
          busy={busy}
          error={error}
          onClose={() => setRemove(null)}
          onConfirm={deleteAttachment}
        >
          {remove.name} will be removed. Regenerate notes to reflect updated
          source materials.
        </Confirm>
      )}
    </div>
  );
}

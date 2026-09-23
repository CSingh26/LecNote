import { useRef, useState } from "react";
import {
  ExternalLink,
  FileText,
  Image,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import type { Attachment, Lecture } from "../types";
import { api, date, json, lecturePath, message } from "../lib/api";
import { Button, Confirm, Empty, ErrorNotice, IconButton, Modal } from "./ui";

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
          <p className="muted">
            Slides, readings, and whiteboard images for this lecture.
          </p>
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
          accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp"
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
                {/\.(png|jpe?g|webp)$/i.test(attachment.name) ? (
                  <img
                    src={path(attachment)}
                    alt={attachment.name}
                    loading="lazy"
                  />
                ) : (
                  <>
                    <FileText size={36} />
                    <span>
                      {attachment.name.split(".").pop()?.toUpperCase()}
                    </span>
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
        <Empty icon={Paperclip} title="Bring the context along">
          Attach a PDF, text document, or image. Text is extracted locally for
          note generation.
        </Empty>
      )}
      {selected && (
        <Modal title={selected.name} wide onClose={() => setSelected(null)}>
          <div className="modal-body preview-body">
            {/\.(png|jpe?g|webp)$/i.test(selected.name) ? (
              <img src={path(selected)} alt={selected.name} />
            ) : /\.pdf$/i.test(selected.name) ? (
              <iframe sandbox="" title={selected.name} src={path(selected)} />
            ) : (
              <pre className="text-preview">
                {selected.text ||
                  "No extracted text available. Open the source file to view it."}
              </pre>
            )}
            <ErrorNotice error={selected.error || ""} />
            <a
              className="button"
              href={path(selected)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Image size={16} />
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

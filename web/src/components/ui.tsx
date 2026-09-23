import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowRight,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Course, Job } from "../types";

export function Button({
  children,
  icon: Icon,
  variant = "",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  variant?: string;
}) {
  return (
    <button
      type="button"
      className={`button ${variant} ${className}`}
      {...props}
    >
      {Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  icon: Icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: LucideIcon;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={18} />
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label className="field">
        <span>{label}</span>
        {children}
      </label>
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <span>{error}</span>
      {retry && <Button onClick={retry}>Retry</Button>}
    </div>
  );
}
export function Loading({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={20} className="spin" />
      {label}
    </div>
  );
}
export function Empty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={30} strokeWidth={1.4} />
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action && <div className="actions">{action}</div>}
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      <i />
      {status.replaceAll("_", " ")}
    </span>
  );
}
export function CourseSelect({
  courses,
  value,
  onChange,
  all = false,
}: {
  courses: Course[];
  value: string;
  onChange: (value: string) => void;
  all?: boolean;
}) {
  return (
    <select
      aria-label={all ? "Filter by course" : "Course"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{all ? "All courses" : "No course"}</option>
      {courses.map((course) => (
        <option key={course.id} value={course.id}>
          {course.code ? `${course.code} · ` : ""}
          {course.name}
        </option>
      ))}
    </select>
  );
}
export function JobProgress({ job }: { job: Job }) {
  return (
    <div className="job-progress">
      <div className="split">
        <span>{job.message || job.stage || job.status}</span>
        <span>{Math.round(job.progress || 0)}%</span>
      </div>
      <progress
        value={job.progress || 0}
        max="100"
        aria-label="Processing progress"
      />
      {job.error && <ErrorNotice error={job.error} />}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  const blocked = useRef(busy);
  blocked.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
        ) ?? [],
      ).filter((el) => !el.hidden);
    (focusable()[0] || ref.current)?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !blocked.current) {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const list = focusable();
        const first = list[0];
        const last = list.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <IconButton
            label="Close dialog"
            icon={X}
            disabled={busy}
            onClick={onClose}
          />
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function Confirm({
  title,
  children,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className="modal-body">
        <p>{children}</p>
        <ErrorNotice error={error} />
      </div>
      <footer>
        <Button onClick={onClose} disabled={busy}>
          Keep it
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </footer>
    </Modal>
  );
}
export function LectureLink({
  id,
  children,
  timestamp,
}: {
  id: string;
  children: ReactNode;
  timestamp?: number | null;
}) {
  return (
    <a
      className="text-link"
      href={`#/lecture/${encodeURIComponent(id)}${timestamp != null ? `?t=${timestamp}` : ""}`}
    >
      {children}
      <ArrowRight size={14} />
    </a>
  );
}

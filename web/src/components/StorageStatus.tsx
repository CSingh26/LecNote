import { HardDrive } from "lucide-react";
import type { Lecture } from "../types";
import "./StorageStatus.css";

export type StorageLecture = Lecture & {
  finalized_at?: string | null;
  compression?: {
    status?: string;
    original_bytes?: number | null;
    compressed_bytes?: number | null;
    saved_bytes?: number | null;
    error?: string | null;
    next_attempt_at?: string | null;
    eligible_at?: string | null;
    attempts?: number;
    completed_at?: string | null;
    cleanup_pending?: boolean;
  } | null;
};

export function storageSize(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const unit = bytes >= 1024 ** 3 ? "GiB" : bytes >= 1024 ** 2 ? "MiB" : "KiB";
  const divisor =
    unit === "GiB" ? 1024 ** 3 : unit === "MiB" ? 1024 ** 2 : 1024;
  return `${Number((bytes / divisor).toFixed(1))} ${unit}`;
}

export function StorageStatus({ lecture }: { lecture: StorageLecture }) {
  const compression = lecture.compression;
  if (!compression?.status || lecture.status === "recording") return null;
  const {
    status,
    original_bytes,
    compressed_bytes,
    saved_bytes,
    error,
    next_attempt_at,
  } = compression;
  const saved =
    saved_bytes ??
    (original_bytes != null && compressed_bytes != null
      ? original_bytes - compressed_bytes
      : null);
  const label: Record<string, string> = {
    pending: "Compression pending",
    scheduled: "Compression scheduled",
    queued: "Compression queued",
    running: "Compressing recording",
    compressing: "Compressing recording",
    completed: "Recording compressed",
    compressed: "Recording compressed",
    succeeded: "Recording compressed",
    failed: "Compression failed",
    skipped: "Compression skipped",
    disabled: "Compression off",
    not_smaller: "Original retained: already compact",
    video: "Video retained",
  };
  const retryAt = next_attempt_at ? new Date(next_attempt_at) : null;
  const finalizedAt = lecture.finalized_at
    ? new Date(lecture.finalized_at)
    : null;
  const eligibleAt = compression.eligible_at
    ? new Date(compression.eligible_at)
    : null;
  return (
    <div className="storage-status" role="status">
      <HardDrive size={15} aria-hidden="true" />
      <span>
        {label[status] || status.replaceAll("_", " ")}
        {saved != null && Number.isFinite(saved) && saved > 0 && (
          <> · {storageSize(saved)} saved</>
        )}
        {compressed_bytes != null &&
          Number.isFinite(compressed_bytes) &&
          compressed_bytes >= 0 && <> · {storageSize(compressed_bytes)}</>}
        {error && <> · {error}</>}
        {retryAt && Number.isFinite(retryAt.getTime()) && (
          <>
            {" "}
            · Retry{" "}
            <time dateTime={next_attempt_at!}>{retryAt.toLocaleString()}</time>
          </>
        )}
        {!retryAt &&
        status === "pending" &&
        eligibleAt &&
        Number.isFinite(eligibleAt.getTime()) ? (
          <>
            {" "}
            · Eligible{" "}
            <time dateTime={compression.eligible_at!}>
              {eligibleAt.toLocaleString()}
            </time>
          </>
        ) : !retryAt &&
          status === "pending" &&
          finalizedAt &&
          Number.isFinite(finalizedAt.getTime()) ? (
          <>
            {" "}
            · Finalized{" "}
            <time dateTime={lecture.finalized_at!}>
              {finalizedAt.toLocaleString()}
            </time>
          </>
        ) : null}
      </span>
    </div>
  );
}

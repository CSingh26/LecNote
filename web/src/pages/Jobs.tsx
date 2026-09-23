import { useState } from "react";
import { Activity, RotateCcw, Square } from "lucide-react";
import type { Job } from "../types";
import {
  activeStatus,
  api,
  date,
  json,
  lecturePath,
  message,
  useResource,
} from "../lib/api";
import {
  Button,
  Empty,
  ErrorNotice,
  JobProgress,
  LectureLink,
  Loading,
  PageHeader,
  Status,
} from "../components/ui";

export function Jobs() {
  const jobs = useResource<Job[]>("/jobs", 2500);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function act(job: Job, action: string) {
    setBusy(job.id);
    setError("");
    try {
      await api(
        `${lecturePath(job.lecture_id)}/${action}`,
        json("POST", action === "process" ? { force: false } : undefined),
      );
      jobs.refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <PageHeader eyebrow="Processing" title="Jobs">
        Transcription and note generation on your local workspace.
      </PageHeader>
      <ErrorNotice error={error || jobs.error} retry={jobs.refresh} />
      {jobs.loading ? (
        <Loading />
      ) : jobs.data?.length ? (
        <div className="job-list">
          {jobs.data.map((job) => (
            <article key={job.id}>
              <div className="split">
                <div>
                  <LectureLink id={job.lecture_id}>Open lecture</LectureLink>
                  <small>
                    {date(job.created_at)} · {job.stage || "Waiting"}
                  </small>
                </div>
                <Status status={job.status} />
              </div>
              <JobProgress job={job} />
              <div className="actions">
                {activeStatus(job.status) ? (
                  <Button
                    icon={Square}
                    disabled={Boolean(busy)}
                    onClick={() => act(job, "cancel")}
                  >
                    {busy === job.id ? "Cancelling…" : "Cancel job"}
                  </Button>
                ) : ["failed", "cancelled", "interrupted"].includes(
                    job.status,
                  ) ? (
                  <Button
                    icon={RotateCcw}
                    disabled={Boolean(busy)}
                    onClick={() => act(job, "process")}
                  >
                    {busy === job.id ? "Queuing…" : "Retry"}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : !jobs.error ? (
        <Empty icon={Activity} title="All quiet here">
          Processing jobs will appear when you generate lecture notes.
        </Empty>
      ) : null}
    </>
  );
}

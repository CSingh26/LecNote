import { useCallback, useEffect, useRef, useState } from "react";

export const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new Error(
      "Cannot reach the local LecNote server. Check that it is running, then retry.",
    );
  }
  if (!response.ok) {
    let detail: unknown;
    try {
      detail = (await response.json()).detail;
    } catch {
      /* The proxy can return plain text. */
    }
    throw new Error(
      typeof detail === "string"
        ? detail
        : `Request failed (${response.status}). Please try again.`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const lecturePath = (id: string) =>
  `/lectures/${encodeURIComponent(id)}`;

export function useResource<T>(path: string | null, poll = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  const [version, setVersion] = useState(0);
  const latest = useRef(path);
  latest.current = path;
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    setData(undefined);
    setError("");
    setLoading(Boolean(path));
  }, [path]);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await api<T>(path, { signal: controller.signal });
        if (!controller.signal.aborted && latest.current === path) {
          setData(result);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(message(error));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (poll) timer = setTimeout(load, poll);
        }
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, poll, version]);
  return { data, error, loading, refresh };
}

export function time(seconds = 0) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(value / 3600);
  return `${h ? `${h}:` : ""}${String(Math.floor(value / 60) % 60).padStart(h ? 2 : 1, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function date(value: string) {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
}
export const activeStatus = (status: string) =>
  ["queued", "running", "transcribing", "generating", "recording"].includes(
    status,
  );
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function downloadExport(
  id: string,
  format: string,
  title: string,
) {
  const response = await fetch(`/api${lecturePath(id)}/export/${format}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Export failed (${response.status}).`);
  }
  downloadBlob(
    await response.blob(),
    `${title.replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 100) || "lecture"}.${format}`,
  );
}

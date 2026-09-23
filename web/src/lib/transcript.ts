import type { Transcript, Segment } from "../types";

export function parseTimestamp(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(normalized))
    throw new Error(`Invalid timestamp: ${value}`);
  const parts = normalized.split(":").map(Number);
  if (
    parts.some(
      (part, index) => !Number.isFinite(part) || (index > 0 && part >= 60),
    )
  )
    throw new Error(`Invalid timestamp: ${value}`);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function validate(input: unknown, language: string): Transcript {
  const data = input as Partial<Transcript>;
  if (!data || !Array.isArray(data.segments) || !data.segments.length)
    throw new Error("A transcript needs at least one segment.");
  let previous = -1;
  const segments = data.segments.map((segment, index): Segment => {
    if (!segment || typeof segment.text !== "string" || !segment.text.trim())
      throw new Error(`Segment ${index + 1} has no text.`);
    if (
      typeof segment.start !== "number" ||
      typeof segment.end !== "number" ||
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.start < 0 ||
      segment.end <= segment.start
    )
      throw new Error(
        `Segment ${index + 1}: end must be after start, with nonnegative finite times.`,
      );
    if (segment.start < previous)
      throw new Error("Transcript timestamps must be in chronological order.");
    previous = segment.start;
    return {
      id: index,
      start: segment.start,
      end: segment.end,
      text: segment.text.trim(),
      speaker:
        typeof segment.speaker === "string"
          ? segment.speaker.trim() || null
          : null,
    };
  });
  return {
    language: typeof data.language === "string" ? data.language : language,
    duration: Math.max(...segments.map((s) => s.end)),
    segments,
  };
}

export function parseTranscript(source: string, language = ""): Transcript {
  const text = source.trim().replace(/\r\n?/g, "\n");
  if (!text)
    throw new Error("Add transcript text or choose a transcript file.");
  if (/^[{[]/.test(text) && !/^\[\d/.test(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        "Invalid JSON. Supply a transcript object with a segments array.",
      );
    }
    return validate(
      Array.isArray(parsed) ? { segments: parsed } : parsed,
      language,
    );
  }
  const stamp = "(\\d+(?::\\d{1,2}){1,2}(?:[.,]\\d+)?)";
  const range = new RegExp(`^${stamp}\\s*-->\\s*${stamp}(?:\\s.*)?$`);
  const prefix = new RegExp(`^\\[?${stamp}\\]?\\s*(?:[-–]\\s*)?(.*)$`);
  const drafts: { start: number; end?: number; text: string }[] = [];
  let timed = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^WEBVTT(?:\s|$)/.test(trimmed) || /^\d+$/.test(trimmed))
      continue;
    const bounds = trimmed.match(range);
    const start = trimmed.match(prefix);
    if (bounds) {
      drafts.push({
        start: parseTimestamp(bounds[1]),
        end: parseTimestamp(bounds[2]),
        text: "",
      });
      timed = true;
    } else if (start) {
      drafts.push({ start: parseTimestamp(start[1]), text: start[2] });
      timed = true;
    } else if (drafts.length) drafts[drafts.length - 1].text += ` ${trimmed}`;
  }
  if (!timed) {
    let cursor = 0;
    for (const paragraph of text.split(/\n\s*\n/).filter(Boolean)) {
      const duration = Math.max(3, paragraph.split(/\s+/).length / 2.5);
      drafts.push({
        start: cursor,
        end: cursor + duration,
        text: paragraph.replace(/\n/g, " "),
      });
      cursor += duration;
    }
  }
  if (
    drafts.some(
      (draft, index) => index > 0 && draft.start < drafts[index - 1].start,
    )
  )
    throw new Error("Transcript timestamps must be in chronological order.");
  return validate(
    {
      language,
      segments: drafts.map((draft, index) => {
        const speaker = draft.text.trim().match(/^([^:\n]{1,50}):\s+(.+)$/);
        return {
          ...draft,
          id: index,
          end:
            draft.end ??
            drafts[index + 1]?.start ??
            draft.start + Math.max(3, draft.text.split(/\s+/).length / 2.5),
          text: speaker ? speaker[2] : draft.text.trim(),
          speaker: speaker?.[1] ?? null,
        };
      }),
    },
    language,
  );
}

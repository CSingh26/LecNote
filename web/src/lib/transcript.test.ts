import { describe, expect, it } from "vitest";
import { parseTranscript, parseTimestamp } from "./transcript";

describe("transcript import", () => {
  it("parses fractional timestamps and hours coherently", () => {
    expect(parseTimestamp("01:02:03.5")).toBe(3723.5);
    expect(parseTimestamp("02:30,250")).toBe(150.25);
    expect(() => parseTimestamp("1:75")).toThrow();
  });
  it("uses the next start for implicit ends and preserves speaker labels", () => {
    const result = parseTranscript(
      "[00:00] Professor: First idea\ncontinued\n[00:15.5] Student: A question",
      "en",
    );
    expect(result.segments[0]).toMatchObject({
      start: 0,
      end: 15.5,
      speaker: "Professor",
      text: "First idea continued",
    });
    expect(result.segments[1]).toMatchObject({
      start: 15.5,
      speaker: "Student",
      text: "A question",
    });
    expect(result.duration).toBeGreaterThan(15.5);
  });
  it("accepts SRT ranges and VTT headers", () => {
    const result = parseTranscript(
      "WEBVTT\n\n00:01.000 --> 00:04.200\nFirst line\n\n00:05.000 --> 00:07.000\nSecond line",
    );
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({
      start: 1,
      end: 4.2,
      text: "First line",
    });
  });
  it("validates JSON instead of silently accepting invalid timing", () => {
    expect(() =>
      parseTranscript('{"segments":[{"start":4,"end":2,"text":"wrong"}]}'),
    ).toThrow(/end/i);
    expect(() => parseTranscript('{"segments":[]}')).toThrow();
    const result = parseTranscript(
      JSON.stringify({
        language: "fr",
        segments: [{ start: 2, end: 4, text: "bonjour", speaker: "A" }],
      }),
    );
    expect(result).toMatchObject({
      language: "fr",
      duration: 4,
      segments: [{ id: 0, speaker: "A" }],
    });
  });
  it("rejects out-of-order timestamps and empty input", () => {
    expect(() => parseTranscript("[00:20] late\n[00:10] early")).toThrow(
      /order/i,
    );
    expect(() => parseTranscript("  ")).toThrow();
  });
  it("accepts untimed paragraphs with estimated, increasing boundaries", () => {
    const result = parseTranscript("First paragraph.\n\nSecond paragraph.");
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1].start).toBe(result.segments[0].end);
  });
});

"""Validated storage and Structured Outputs contracts for lecture processing."""

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_TRANSCRIPT_CHARACTERS = 2_000_000
MAX_SEGMENT_CHARACTERS = 16_000
MAX_CONTEXT_CHARACTERS = 24_000
MAX_REQUEST_CHARACTERS = 120_000
MAX_CHUNK_CHARACTERS = 24_000
MAX_CHUNKS = 512

ShortText = Annotated[str, Field(max_length=500)]
Text = Annotated[str, Field(max_length=4000)]
Seconds = Annotated[float, Field(ge=0, le=172_800, allow_inf_nan=False)]
Number = Annotated[float, Field(ge=-1e15, le=1e15, allow_inf_nan=False, strict=True)]


class PipelineCancelled(RuntimeError):
    """Cooperative cancellation, including cancellation from a progress callback."""


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Segment(Schema):
    id: Annotated[int, Field(ge=0)]
    start: Seconds
    end: Seconds
    text: Annotated[str, Field(max_length=MAX_SEGMENT_CHARACTERS)]
    speaker: ShortText | None = None

    @model_validator(mode="after")
    def validate_interval(self):
        if self.end < self.start:
            raise ValueError("Segment end must not precede start")
        return self


class Transcript(Schema):
    language: Annotated[str, Field(max_length=80)]
    duration: Seconds
    segments: Annotated[list[Segment], Field(max_length=30_000)]

    @model_validator(mode="after")
    def validate_segments(self):
        ids = set()
        previous = -1.0
        total = 0
        for segment in self.segments:
            if segment.id in ids or segment.start < previous:
                raise ValueError("Transcript segments need unique IDs and chronological start times")
            if segment.end > self.duration + 0.01:
                raise ValueError("Segment timestamp exceeds transcript duration")
            ids.add(segment.id)
            previous = segment.start
            total += len(segment.text)
        if total > MAX_TRANSCRIPT_CHARACTERS:
            raise ValueError("Transcript is too large; split the lecture before processing")
        return self


class Definition(Schema):
    term: ShortText
    definition: Text


class Question(Schema):
    question: Text
    answer: Text


class Formula(Schema):
    latex: Annotated[str, Field(max_length=1000)]
    explanation: Text


class Point(Schema):
    text: Text
    timestamp: Seconds


def validate_mermaid(source: str) -> str:
    """Allow declarative diagrams; reject directives, links, markup and callbacks."""
    if not source.strip() or len(source) > 8000:
        raise ValueError("Mermaid diagram is empty or too large")
    if re.search(
        r"%%\{|^\s*---|\b(click|href|callback|call|style|classDef|linkStyle)\b|"
        r"javascript\s*:|data\s*:|https?\s*:|[<>](?![-=.])|@\{|[&]#",
        source,
        re.I | re.M,
    ):
        # Arrowheads are ordinary Mermaid syntax; markup is not.
        cleaned = re.sub(r"(?:<[-=.]+>|[-=.]+>|<[-=.]+)", "", source)
        if re.search(
            r"%%\{|^\s*---|\b(click|href|callback|call|style|classDef|linkStyle)\b|"
            r"javascript\s*:|data\s*:|https?\s*:|[<>]|@\{|[&]#",
            cleaned,
            re.I | re.M,
        ):
            raise ValueError("Mermaid contains unsafe directives, markup, links or callbacks")
    if not re.match(
        r"\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|erDiagram|mindmap|timeline)\b",
        source,
    ):
        raise ValueError("Unsupported Mermaid diagram type")
    return source


class Visual(Schema):
    kind: Literal["mermaid", "plot"]
    title: ShortText
    mermaid: Annotated[str, Field(max_length=8000)] | None
    x: Annotated[list[Number], Field(max_length=500)]
    y: Annotated[list[Number], Field(max_length=500)]
    x_label: ShortText
    y_label: ShortText
    image: Annotated[str, Field(max_length=1000)] | None

    @model_validator(mode="after")
    def validate_visual(self):
        if self.kind == "plot":
            if not self.x or len(self.x) != len(self.y):
                raise ValueError("Plot x and y must be nonempty numeric arrays of equal length")
            if self.mermaid is not None:
                raise ValueError("Plot must not contain Mermaid")
        else:
            validate_mermaid(self.mermaid or "")
            if self.x or self.y:
                raise ValueError("Mermaid must not contain plot arrays")
        return self


class ChunkNote(Schema):
    index: Annotated[int, Field(ge=0)]
    start: Seconds
    end: Seconds
    title: ShortText
    summary: Text
    key_points: Annotated[list[Point], Field(max_length=30)]
    definitions: Annotated[list[Definition], Field(max_length=30)]
    formulas: Annotated[list[Formula], Field(max_length=20)]
    examples: Annotated[list[Text], Field(max_length=20)]
    emphasized_points: Annotated[list[Text], Field(max_length=20)]
    practice: Annotated[list[Question], Field(max_length=10)]
    visual: Visual | None

    @model_validator(mode="after")
    def validate_timestamps(self):
        if self.end < self.start:
            raise ValueError("Chunk end must not precede start")
        if any(not self.start <= point.timestamp <= self.end for point in self.key_points):
            raise ValueError("Citation timestamp is outside the source chunk")
        return self


class LectureOverview(Schema):
    title: ShortText
    overview: Annotated[str, Field(max_length=12_000)]
    takeaways: Annotated[list[Text], Field(max_length=30)]
    glossary: Annotated[list[Definition], Field(max_length=100)]
    review_questions: Annotated[list[Question], Field(max_length=40)]


class Usage(Schema):
    input_tokens: Annotated[int, Field(ge=0)] = 0
    output_tokens: Annotated[int, Field(ge=0)] = 0


class Notes(LectureOverview):
    chunks: Annotated[list[ChunkNote], Field(max_length=MAX_CHUNKS)]
    usage: Usage
    model: ShortText

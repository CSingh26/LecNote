from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .schemas import Transcript


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)


class TranscriptInput(Transcript):
    @model_validator(mode="after")
    def nonempty(self):
        if self.duration <= 0 or not self.segments:
            raise ValueError("Provide a nonempty transcript with a positive duration")
        if any(not segment.text.strip() or segment.end <= segment.start for segment in self.segments):
            raise ValueError("Segments must contain text and have a positive duration")
        return self


class CourseInput(Input):
    name: str = Field(min_length=1, max_length=160)
    code: str = Field(default="", max_length=40)
    color: str = Field(default="#26715b", pattern=r"^#[0-9a-fA-F]{6}$")
    context: str = Field(default="", max_length=100000)
    vocabulary: str = Field(default="", max_length=10000)
    optimize_recordings: bool | None = None


class CoursePatch(Input):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    code: str | None = Field(default=None, max_length=40)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    context: str | None = Field(default=None, max_length=100000)
    vocabulary: str | None = Field(default=None, max_length=10000)
    optimize_recordings: bool | None = None


class LecturePatch(Input):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    course_id: str | None = None
    context: str | None = Field(default=None, max_length=100000)
    user_notes: str | None = Field(default=None, max_length=500000)


class ImportInput(Input):
    title: str = Field(min_length=1, max_length=200)
    course_id: str | None = None
    context: str = Field(default="", max_length=100000)
    transcript: TranscriptInput


class ProcessInput(Input):
    force: bool = False
    diarize: bool | None = None
    transcribe_only: bool = False


class NoteInput(Input):
    user_notes: str = Field(max_length=500000)


class LiveInput(Input):
    title: str = Field(min_length=1, max_length=200)
    course_id: str | None = None
    language: str = Field(default="", max_length=20)
    context: str = Field(default="", max_length=100000)


class SettingsInput(Input):
    model: str | None = Field(default=None, min_length=1, max_length=100)
    whisper_model: str | None = Field(default=None, min_length=1, max_length=100)
    chunk_minutes: float | None = Field(default=None, ge=1, le=30)
    parallel_requests: int | None = Field(default=None, ge=1, le=4)
    language: str | None = Field(default=None, max_length=20)
    diarization: bool | None = None
    optimize_recordings: bool | None = None
    api_key: str | None = Field(default=None, max_length=500)
    hf_token: str | None = Field(default=None, max_length=500)
    input_price_per_million: float | None = Field(default=None, ge=0, le=10000)
    output_price_per_million: float | None = Field(default=None, ge=0, le=10000)

    @field_validator("whisper_model")
    @classmethod
    def whisper_choice(cls, value):
        if value is not None and value not in {
            "tiny",
            "tiny.en",
            "base",
            "base.en",
            "small",
            "small.en",
            "medium",
            "medium.en",
            "large-v1",
            "large-v2",
            "large-v3",
            "large-v3-turbo",
            "turbo",
            "distil-small.en",
            "distil-medium.en",
            "distil-large-v2",
            "distil-large-v3",
        }:
            raise ValueError("Choose a supported Whisper model size")
        return value

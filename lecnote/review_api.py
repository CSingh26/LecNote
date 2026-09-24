from fastapi import HTTPException
from pydantic import Field

from .requests import Input
from .schemas import RelevanceCategory, Transcript


class RelevanceOverrides(Input):
    overrides: dict[str, RelevanceCategory] = Field(max_length=30000)


def install_review(app, repo, manager, editable, public_lecture):
    @app.put("/api/lectures/{lecture_id}/relevance")
    def put_relevance(lecture_id: str, body: RelevanceOverrides):
        from .relevance import normalize_overrides

        with manager.lock:
            lecture = editable(lecture_id)
            transcript = public_lecture(lecture).get("transcript")
            if not transcript:
                raise HTTPException(422, "Transcribe this lecture first")
            try:
                overrides = normalize_overrides(
                    {"relevance_overrides": body.overrides},
                    Transcript.model_validate(transcript),
                )
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            analysis = lecture.get("relevance")
            removed = set(lecture.get("relevance_overrides", {})) - set(body.overrides)
            if removed:
                analysis = None
            elif analysis:
                for segment in analysis["segments"]:
                    if segment["segment_id"] in overrides:
                        segment.update(
                            category=overrides[segment["segment_id"]],
                            confidence=1,
                            source="manual",
                            reason="Manual relevance override",
                        )
                analysis["logistics"] = [
                    s for s in analysis["segments"] if s["category"] == "class_logistics"
                ]
            return public_lecture(
                repo.update(
                    "lectures",
                    lecture_id,
                    {
                        "relevance_overrides": {str(k): v for k, v in overrides.items()},
                        "transcript": transcript,
                        "relevance": analysis,
                        "notes_stale": bool(lecture.get("notes")),
                    },
                )
            )

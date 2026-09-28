import shutil

from fastapi import HTTPException
from pydantic import Field
from starlette.concurrency import run_in_threadpool

from .requests import Input


class MergeInput(Input):
    lecture_ids: list[str] = Field(min_length=2, max_length=20)
    title: str = Field(min_length=1, max_length=200)
    generate_notes: bool = False


def install_media(app, repo, settings, manager, public_lecture):
    @app.post("/api/lectures/merge", status_code=201)
    async def merge_recordings(body: MergeInput):
        from .media import MediaBusy, MediaError, MediaService

        def merge():
            with manager.lock:
                if body.generate_notes and not settings.api_key:
                    raise HTTPException(422, "Add an OpenAI API key before generating notes")
                try:
                    lecture = MediaService(repo, settings).merge(
                        body.lecture_ids,
                        title=body.title,
                        cancelled=manager.stopped.is_set,
                        require_preparation=body.generate_notes,
                    )
                except MediaBusy as exc:
                    raise HTTPException(409, str(exc)) from exc
                except MediaError as exc:
                    raise HTTPException(422, str(exc)) from exc
                if body.generate_notes or not lecture.get("transcript"):
                    try:
                        manager.enqueue(lecture["id"], transcribe_only=not body.generate_notes)
                    except Exception as exc:
                        for job in repo.list("jobs"):
                            if job.get("lecture_id") == lecture["id"]:
                                repo.delete("jobs", job["id"])
                        repo.delete("lectures", lecture["id"])
                        shutil.rmtree(settings.data_dir / "lectures" / lecture["id"])
                        raise HTTPException(503, "Merged recording could not be queued; retry the merge") from exc
                    lecture = repo.get("lectures", lecture["id"])
                return public_lecture(lecture)

        return await run_in_threadpool(merge)

from fastapi import HTTPException
from pydantic import Field
from starlette.concurrency import run_in_threadpool

from .requests import Input


class MergeInput(Input):
    lecture_ids: list[str] = Field(min_length=2, max_length=20)
    title: str = Field(min_length=1, max_length=200)


def install_media(app, repo, settings, manager, public_lecture):
    @app.post("/api/lectures/merge", status_code=201)
    async def merge_recordings(body: MergeInput):
        from .media import MediaBusy, MediaError, MediaService

        def merge():
            with manager.lock:
                try:
                    lecture = MediaService(repo, settings).merge(
                        body.lecture_ids,
                        title=body.title,
                        cancelled=manager.stopped.is_set,
                    )
                except MediaBusy as exc:
                    raise HTTPException(409, str(exc)) from exc
                except MediaError as exc:
                    raise HTTPException(422, str(exc)) from exc
                if not lecture.get("transcript"):
                    manager.enqueue(lecture["id"], transcribe_only=True)
                    lecture = repo.get("lectures", lecture["id"])
                return public_lecture(lecture)

        return await run_in_threadpool(merge)

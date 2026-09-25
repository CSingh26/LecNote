from pathlib import Path
from uuid import uuid4

from anyio import CancelScope
from fastapi import File, HTTPException, UploadFile
from pydantic import Field
from starlette.concurrency import run_in_threadpool

from .file_responses import original_file_response
from .requests import Input


class ResourceNote(Input):
    name: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=100000)


class ResourcePatch(Input):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    text: str | None = Field(default=None, min_length=1, max_length=100000)


class Preparation(Input):
    context: str = Field(default="", max_length=100000)
    selected_resource_ids: list[str] = Field(default_factory=list, max_length=50)


def selected_resources(repo, lecture):
    result = []
    for identifier in dict.fromkeys(lecture.get("selected_resource_ids", [])):
        item = repo.get("resources", identifier)
        if not item or item["course_id"] != lecture.get("course_id"):
            raise ValueError("Select materials from this lecture's class")
        if not item.get("text", "").strip():
            raise ValueError(
                "Selected material has no readable text; add a recording note or another material"
            )
        result.append(item)
    return result


def preparation_ready(repo, lecture):
    try:
        resources = selected_resources(repo, lecture)
    except ValueError:
        return False
    return bool(lecture.get("context", "").strip() or resources)


def generation_inputs(repo, lecture):
    resources = selected_resources(repo, lecture)
    if not lecture.get("context", "").strip() and not resources:
        raise ValueError("Add a recording note or select class materials before generating notes")
    return {
        **lecture,
        "attachments": [*lecture.get("attachments", []), *resources],
        "resource_provenance": [{key: item[key] for key in ("id", "name", "revision")} for item in resources],
    }


def install_resources(app, repo, settings, manager, check_course, editable, public_lecture, save_upload):
    def public(item):
        return {key: value for key, value in item.items() if key != "path"}

    def get_resource(course_id, resource_id):
        check_course(course_id)
        item = repo.get("resources", resource_id)
        if not item or item["course_id"] != course_id:
            raise HTTPException(404, "Class material not found")
        return item

    def affected(resource_id):
        lectures = [
            item for item in repo.list("lectures") if resource_id in item.get("selected_resource_ids", [])
        ]
        for item in lectures:
            editable(item["id"])
        return lectures

    def invalidate(lectures, removed=None):
        for item in lectures:
            changes = {"notes_stale": bool(item.get("notes")), "relevance": None}
            if removed:
                changes["selected_resource_ids"] = [i for i in item["selected_resource_ids"] if i != removed]
            repo.update("lectures", item["id"], changes)

    @app.get("/api/courses/{course_id}/resources")
    def list_resources(course_id: str, q: str = ""):
        check_course(course_id)
        return [
            public(item)
            for item in repo.list("resources")
            if item["course_id"] == course_id
            and q.casefold() in (item["name"] + "\n" + item.get("text", "")).casefold()
        ]

    @app.post("/api/courses/{course_id}/resources/note", status_code=201)
    def create_note(course_id: str, body: ResourceNote):
        with manager.lock:
            check_course(course_id)
            return public(
                repo.create(
                    "resources",
                    {
                        **body.model_dump(),
                        "course_id": course_id,
                        "kind": "note",
                        "revision": 1,
                        "error": None,
                        "url": None,
                    },
                )
            )

    @app.post("/api/courses/{course_id}/resources", status_code=201)
    async def upload_resource(course_id: str, file: UploadFile = File()):
        from .enrichment import extract_context

        check_course(course_id)
        name = Path((file.filename or "material").replace("\\", "/")).name
        suffix = Path(name).suffix.lower()
        identifier = str(uuid4())
        folder = settings.data_dir / "resources" / identifier
        folder.mkdir(parents=True)
        path = folder / ("source" + suffix)
        try:
            await save_upload(file, path, 30 * 1024**2)
            error, text = None, ""
            try:
                text = await run_in_threadpool(extract_context, path)
                if len(text) >= 100000:
                    text = text[:100000]
                    error = "Only the first 100,000 characters were extracted"
            except (RuntimeError, ValueError, OSError):
                error = "Text extraction failed. The original file is preserved."

            def finalize_resource():
                with manager.lock:
                    check_course(course_id)
                    return public(
                        repo.create(
                            "resources",
                            {
                                "id": identifier,
                                "course_id": course_id,
                                "name": name[:200],
                                "kind": suffix[1:],
                                "text": text,
                                "error": error,
                                "revision": 1,
                                "path": str(path),
                                "url": f"/api/courses/{course_id}/resources/{identifier}/file",
                            },
                        )
                    )

            with CancelScope(shield=True):
                return await run_in_threadpool(finalize_resource)
        except BaseException:
            path.unlink(missing_ok=True)
            folder.rmdir()
            raise

    @app.get("/api/courses/{course_id}/resources/{resource_id}/file")
    def resource_file(course_id: str, resource_id: str):
        item = get_resource(course_id, resource_id)
        if not item.get("path") or not Path(item["path"]).is_file():
            raise HTTPException(404, "This material has no original file")
        return original_file_response(item)

    @app.patch("/api/courses/{course_id}/resources/{resource_id}")
    def patch_resource(course_id: str, resource_id: str, body: ResourcePatch):
        with manager.lock:
            item = get_resource(course_id, resource_id)
            values = body.model_dump(exclude_unset=True, exclude_none=True)
            if "text" in values and (item["kind"] != "note" or item.get("path")):
                raise HTTPException(422, "Only typed class notes can be edited")
            related = affected(resource_id)
            values["revision"] = item["revision"] + 1
            updated = repo.update("resources", resource_id, values)
            invalidate(related)
            return public(updated)

    @app.delete("/api/courses/{course_id}/resources/{resource_id}", status_code=204)
    def delete_resource(course_id: str, resource_id: str):
        with manager.lock:
            item = get_resource(course_id, resource_id)
            related = affected(resource_id)
            invalidate(related, resource_id)
            repo.delete("resources", resource_id)
            if item.get("path"):
                Path(item["path"]).unlink(missing_ok=True)

    @app.put("/api/lectures/{lecture_id}/preparation")
    def prepare(lecture_id: str, body: Preparation):
        with manager.lock:
            lecture = editable(lecture_id)
            values = body.model_dump()
            values["selected_resource_ids"] = list(dict.fromkeys(values["selected_resource_ids"]))
            try:
                selected_resources(repo, {**lecture, **values})
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            if any(lecture.get(key) != value for key, value in values.items()):
                values.update(notes_stale=bool(lecture.get("notes")), relevance=None)
            return public_lecture(repo.update("lectures", lecture_id, values))

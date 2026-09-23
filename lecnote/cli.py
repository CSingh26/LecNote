import argparse
import asyncio
import json
import sys
from pathlib import Path

from .config import Settings


async def process(args, settings):
    import httpx

    from .api import create_app

    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://localhost"
        ) as client:
            if args.resume:
                lecture_id = args.resume
                response = await client.post(
                    f"/api/lectures/{lecture_id}/process",
                    json={
                        "force": args.force,
                        "diarize": args.speakers,
                        "transcribe_only": args.transcribe_only,
                    },
                )
            else:
                if not args.file or not args.file.is_file():
                    raise ValueError("Provide an existing recording or --resume LECTURE_ID")
                title = args.title or args.file.stem
                if args.file.suffix.lower() == ".json":
                    transcript = json.loads(args.file.read_text())
                    response = await client.post(
                        "/api/lectures/import",
                        json={
                            "title": title,
                            "course_id": args.course,
                            "context": args.context,
                            "transcript": transcript,
                        },
                    )
                else:
                    with args.file.open("rb") as recording:
                        response = await client.post(
                            "/api/lectures",
                            files={"file": (args.file.name, recording)},
                            data={
                                "title": title,
                                "course_id": args.course or "",
                                "context": args.context,
                                "process": "false",
                            },
                        )
                response.raise_for_status()
                lecture_id = response.json()["id"]
                print(f"Lecture: {lecture_id}", flush=True)
                if args.no_process:
                    return
                response = await client.post(
                    f"/api/lectures/{lecture_id}/process",
                    json={
                        "force": args.force,
                        "diarize": args.speakers,
                        "transcribe_only": args.transcribe_only,
                    },
                )
            response.raise_for_status()
            previous = None
            try:
                while True:
                    result = await client.get(f"/api/lectures/{lecture_id}")
                    result.raise_for_status()
                    lecture = result.json()
                    job = lecture["job"]
                    state = (job["stage"], round(job["progress"]), job["message"])
                    if state != previous:
                        print(f"{state[1]:3d}% {state[2]}", flush=True)
                        previous = state
                    if job["status"] == "completed":
                        from .exports import export_notes

                        folder = settings.lecture_dir(lecture_id) / "exports"
                        for kind in ("md", "html", "pdf", "json") if lecture.get("notes") else ("json",):
                            print(export_notes(lecture, kind, folder))
                        return
                    if job["status"] in {"failed", "cancelled", "interrupted"}:
                        raise RuntimeError(job.get("error") or job["message"])
                    await asyncio.sleep(0.3)
            except asyncio.CancelledError:
                await client.post(f"/api/lectures/{lecture_id}/cancel")
                raise


def main(argv=None):
    parser = argparse.ArgumentParser(description="LecNote: local lecture transcription and study notes")
    parser.add_argument("--data-dir", type=Path, help="Local library directory")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="Open the local Web UI server")
    serve.add_argument("--host", choices=["127.0.0.1", "localhost", "::1"], default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    commands.add_parser("check", help="Show local setup status without making API calls")
    download = commands.add_parser("download-model", help="Download Whisper weights for local transcription")
    download.add_argument("--model", default=None)
    run = commands.add_parser("process", help="Import and process a recording or transcript JSON")
    run.add_argument("file", type=Path, nargs="?")
    run.add_argument("--title")
    run.add_argument("--course", help="Course identifier")
    run.add_argument("--context", default="")
    run.add_argument("--resume", help="Resume an existing lecture by identifier")
    run.add_argument("--force", action="store_true", help="Regenerate notes")
    run.add_argument("--speakers", action="store_true", help="Run local speaker detection")
    run.add_argument("--no-process", action="store_true", help="Import without generating notes")
    run.add_argument("--transcribe-only", action="store_true", help="Transcribe locally without using OpenAI")
    args = parser.parse_args(argv)
    settings = Settings.load(args.data_dir)
    try:
        if args.command == "serve":
            import uvicorn

            from .api import create_app

            uvicorn.run(create_app(settings), host=args.host, port=args.port)
        elif args.command == "check":
            state = settings.public()
            print(f"Library: {settings.data_dir}")
            print(f"Whisper: {settings.whisper_model} (local), installed: {state['capabilities']['whisper']}")
            print(f"OpenAI: {settings.model}, key configured: {state['api_key_configured']}")
            print(f"Local OCR: {state['capabilities']['ocr']}")
            print(f"Speaker detection installed: {state['capabilities']['diarization']}")
        elif args.command == "download-model":
            from faster_whisper import download_model

            print(download_model(args.model or settings.whisper_model))
        else:
            asyncio.run(process(args, settings))
    except KeyboardInterrupt:
        print("Stopped. Completed stages remain saved.", file=sys.stderr)
        raise SystemExit(130) from None
    except Exception as exc:
        message = str(exc)
        for secret in (settings.api_key, settings.hf_token):
            if secret:
                message = message.replace(secret, "[redacted]")
        print(message, file=sys.stderr)
        raise SystemExit(1) from None

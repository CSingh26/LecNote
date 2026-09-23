import copy
import json
import threading
import time
from collections import Counter
from types import SimpleNamespace

import pytest
from test_notes import chunk_data, install_provider, overview_data, response


@pytest.fixture(autouse=True)
def block_real_inference(monkeypatch):
    from lecnote import notes, pipeline

    def blocked(*args, **kwargs):
        pytest.fail("An inference boundary was not stubbed; network and model downloads are forbidden")

    monkeypatch.setattr(notes, "OpenAI", blocked)
    monkeypatch.setattr(pipeline, "transcribe", blocked)


def make_settings(tmp_path, **changes):
    values = dict(
        data_dir=tmp_path,
        api_key="test-only-key",
        model="gpt-4.1-mini",
        whisper_model="base",
        chunk_minutes=8,
        parallel_requests=1,
        language="",
        diarization=False,
        hf_token="",
        input_price_per_million=0,
        output_price_per_million=0,
        lecture_dir=lambda ident: tmp_path / "lectures" / ident,
    )
    return SimpleNamespace(**(values | changes))


def make_lecture(count=3):
    return {
        "id": "test-lecture",
        "title": "Motion",
        "context": "Lecture context",
        "course_context": "Physics",
        "vocabulary": "velocity",
        "attachments": [{"text": "Slide context"}],
        "diarize": False,
        "transcript": {
            "language": "en",
            "duration": count * 480,
            "segments": [
                {"id": i, "start": i * 480, "end": (i + 1) * 480, "text": f"Velocity {i}", "speaker": None}
                for i in range(count)
            ],
        },
    }


def provider(monkeypatch, fail_index=None, on_chunk=None):
    calls = Counter()

    def parse(**kwargs):
        payload = json.loads(kwargs["input"])
        if "chunk" in payload:
            chunk = payload["chunk"]
            index = chunk["index"]
            calls[index] += 1
            if index == fail_index:
                raise RuntimeError("provider unavailable")
            if on_chunk:
                on_chunk(index)
            data = chunk_data(index, chunk["start"], chunk["end"])
        else:
            calls["overview"] += 1
            data = overview_data()
        return response(data, kwargs["text_format"])

    install_provider(monkeypatch, parse)
    return calls


def run(lecture, settings, cancelled=lambda: False):
    from lecnote.pipeline import run_pipeline

    return run_pipeline(lecture, settings, lambda *args: None, cancelled)


def test_chunks_preserve_whole_segments_and_gaps():
    from lecnote.pipeline import chunk_transcript

    transcript = make_lecture()["transcript"]
    transcript["segments"] = [
        {"id": i, "start": start, "end": end, "text": str(i), "speaker": None}
        for i, (start, end) in enumerate([(0, 470), (470, 490), (490, 960), (2000, 2010)])
    ]
    transcript["duration"] = 2010
    chunks = chunk_transcript(transcript)
    assert [[s["id"] for s in c["segments"]] for c in chunks] == [[0, 1], [2], [3]]
    assert [(c["start"], c["end"]) for c in chunks] == [(0, 490), (490, 960), (2000, 2010)]


def test_complete_run_is_cached_and_tracks_usage_without_invented_prices(tmp_path, monkeypatch):
    calls = provider(monkeypatch)
    lecture, settings = make_lecture(), make_settings(tmp_path)
    first = run(lecture, settings)
    assert first["notes"]["usage"] == {"input_tokens": 400, "output_tokens": 160}
    assert len(first["notes"]["chunks"]) == 3
    assert "cost" not in first["notes"]
    assert (settings.lecture_dir(lecture["id"]) / "transcript.json").is_file()
    settings.api_key = ""
    assert run(lecture, settings) == first
    assert calls == {0: 1, 1: 1, 2: 1, "overview": 1}
    for path in settings.lecture_dir(lecture["id"]).rglob("*.json"):
        json.loads(path.read_text())


def test_resume_retains_completed_chunks_after_failure(tmp_path, monkeypatch):
    calls = provider(monkeypatch, fail_index=1)
    lecture, settings = make_lecture(), make_settings(tmp_path)
    with pytest.raises(RuntimeError, match="provider unavailable"):
        run(lecture, settings)
    assert calls[0] == 1
    resumed = provider(monkeypatch)
    result = run(lecture, settings)
    assert resumed == {1: 1, 2: 1, "overview": 1}
    assert result["notes"]["usage"]["input_tokens"] == 400


@pytest.mark.parametrize(
    "change",
    [
        "context",
        "course_context",
        "vocabulary",
        "attachments",
        "transcript",
        "model",
        "chunk_minutes",
        "prompt",
    ],
)
def test_content_model_prompt_and_settings_invalidate_cache(tmp_path, monkeypatch, change):
    from lecnote import notes

    calls = provider(monkeypatch)
    lecture, settings = make_lecture(1), make_settings(tmp_path)
    run(lecture, settings)
    if change == "transcript":
        lecture["transcript"]["segments"][0]["text"] = "Acceleration"
    elif change == "attachments":
        lecture["attachments"][0]["text"] = "New slide"
    elif change in ("model", "chunk_minutes"):
        setattr(settings, change, "different-model" if change == "model" else 7)
    elif change == "prompt":
        monkeypatch.setattr(notes, "PROMPT_VERSION", "changed")
    else:
        lecture[change] = "Changed context"
    run(lecture, settings)
    assert calls[0] == 2
    assert calls["overview"] == 2


def test_cancelled_paid_request_is_saved_then_reused(tmp_path, monkeypatch):
    from lecnote.pipeline import PipelineCancelled

    stop = threading.Event()
    provider(monkeypatch, on_chunk=lambda i: stop.set())
    lecture, settings = make_lecture(2), make_settings(tmp_path)
    with pytest.raises(PipelineCancelled):
        run(lecture, settings, stop.is_set)
    calls = provider(monkeypatch)
    run(lecture, settings)
    assert calls == {1: 1, "overview": 1}


def test_cancelled_before_start_makes_no_requests(tmp_path, monkeypatch):
    from lecnote.pipeline import PipelineCancelled

    calls = provider(monkeypatch)
    with pytest.raises(PipelineCancelled):
        run(make_lecture(), make_settings(tmp_path), lambda: True)
    assert calls == {}


def test_at_most_four_parallel_requests_and_stable_chunk_order(tmp_path, monkeypatch):
    lock = threading.Lock()
    active = peak = 0

    def during_request(index):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.03 * (4 - index % 4))
        with lock:
            active -= 1

    provider(monkeypatch, on_chunk=during_request)
    result = run(make_lecture(8), make_settings(tmp_path, parallel_requests=12))
    assert 1 < peak <= 4
    assert [c["index"] for c in result["notes"]["chunks"]] == list(range(8))


def test_transcription_cache_keys_source_bytes_and_model(tmp_path, monkeypatch):
    from lecnote import pipeline

    lecture, settings = make_lecture(1), make_settings(tmp_path)
    transcript = lecture.pop("transcript")
    media = tmp_path / "audio.wav"
    media.write_bytes(b"first content")
    lecture["media_path"] = str(media)
    calls = []

    def transcribe(*args, **kwargs):
        calls.append(1)
        return copy.deepcopy(transcript)

    monkeypatch.setattr(pipeline, "transcribe", transcribe)
    provider(monkeypatch)
    run(lecture, settings)
    run(lecture, settings)
    assert len(calls) == 1
    media.write_bytes(b"other content")
    run(lecture, settings)
    settings.whisper_model = "small"
    run(lecture, settings)
    assert len(calls) == 3


def test_empty_or_oversized_transcript_fails_before_provider(tmp_path, monkeypatch):
    calls = provider(monkeypatch)
    with pytest.raises(ValueError, match="speech|empty|segment"):
        run(make_lecture(0), make_settings(tmp_path))
    lecture = make_lecture(1)
    lecture["transcript"]["segments"][0]["text"] = "x" * 100_000
    with pytest.raises(ValueError, match="long|limit|large"):
        run(lecture, make_settings(tmp_path))
    assert calls == {}


def test_force_regenerates_notes_but_honors_corrected_transcript(tmp_path, monkeypatch):
    from lecnote import pipeline

    calls = provider(monkeypatch)
    lecture, settings = make_lecture(1), make_settings(tmp_path)
    run(lecture, settings)
    lecture["force"] = True
    monkeypatch.setattr(
        pipeline, "transcribe", lambda *args, **kwargs: pytest.fail("corrected transcript is authoritative")
    )
    result = run(lecture, settings)
    assert calls == {0: 2, "overview": 2}
    assert result["transcript"] == lecture["transcript"]


def test_language_override_and_raw_transcript_survive_notes_failure(tmp_path, monkeypatch):
    from lecnote import pipeline

    lecture, settings = make_lecture(1), make_settings(tmp_path, language="fr")
    expected = lecture.pop("transcript")
    media = tmp_path / "recording.wav"
    media.write_bytes(b"recording")
    lecture.update(media_path=str(media), language="en")

    def transcribe(path, local_settings, **kwargs):
        assert local_settings.language == "en"
        return expected

    monkeypatch.setattr(pipeline, "transcribe", transcribe)
    provider(monkeypatch, fail_index=0)
    with pytest.raises(RuntimeError):
        run(lecture, settings)
    assert json.loads((settings.lecture_dir(lecture["id"]) / "transcript.json").read_text()) == expected


def test_forced_run_failure_resumes_new_chunks_without_reusing_stale_chunks(tmp_path, monkeypatch):
    lecture, settings = make_lecture(3), make_settings(tmp_path)
    provider(monkeypatch)
    run(lecture, settings)
    lecture["force"] = True
    provider(monkeypatch, fail_index=1)
    with pytest.raises(RuntimeError):
        run(lecture, settings)
    lecture["force"] = False
    calls = provider(monkeypatch)
    run(lecture, settings)
    assert calls == {1: 1, 2: 1, "overview": 1}


def test_incomplete_or_corrupted_chunk_cache_is_regenerated(tmp_path, monkeypatch):
    lecture, settings = make_lecture(2), make_settings(tmp_path)
    provider(monkeypatch)
    run(lecture, settings)
    path = next(settings.lecture_dir(lecture["id"]).rglob("chunk-0000.json"))
    path.write_text('{"complete":true,"data":')
    calls = provider(monkeypatch)
    run(lecture, settings)
    assert calls == {0: 1}


def test_running_requests_are_cached_when_parallel_peer_fails(tmp_path, monkeypatch):
    lecture, settings = make_lecture(5), make_settings(tmp_path, parallel_requests=4)
    barrier = threading.Barrier(4, timeout=3)

    def parse(**kwargs):
        chunk = json.loads(kwargs["input"])["chunk"]
        barrier.wait()
        if chunk["index"] == 0:
            raise RuntimeError("failed peer")
        time.sleep(0.04)
        return response(chunk_data(chunk["index"], chunk["start"], chunk["end"]), kwargs["text_format"])

    install_provider(monkeypatch, parse)
    with pytest.raises(RuntimeError, match="failed peer"):
        run(lecture, settings)
    calls = provider(monkeypatch)
    run(lecture, settings)
    assert calls == {0: 1, 4: 1, "overview": 1}


def test_atomic_write_failure_preserves_previous_complete_cache(tmp_path, monkeypatch):
    from lecnote import pipeline

    path = tmp_path / "cache.json"
    pipeline.atomic_json(path, {"old": "complete"})

    def fail(*args):
        raise OSError("disk failure")

    monkeypatch.setattr(pipeline.os, "replace", fail)
    with pytest.raises(OSError, match="disk failure"):
        pipeline.atomic_json(path, {"new": "incomplete"})
    assert json.loads(path.read_text()) == {"old": "complete"}
    assert list(tmp_path.iterdir()) == [path]


def test_optional_visual_render_failure_preserves_completed_notes(tmp_path, monkeypatch):
    from lecnote import exports

    def parse(**kwargs):
        payload = json.loads(kwargs["input"])
        data = overview_data()
        if "chunk" in payload:
            chunk = payload["chunk"]
            data = chunk_data(chunk["index"], chunk["start"], chunk["end"])
            data["visual"] = {
                "kind": "plot",
                "title": "Position",
                "mermaid": None,
                "x": [0, 1],
                "y": [0, 2],
                "x_label": "Time",
                "y_label": "Position",
                "image": None,
            }
        return response(data, kwargs["text_format"])

    def render_failure(*args):
        raise RuntimeError("unavailable font renderer")

    install_provider(monkeypatch, parse)
    monkeypatch.setattr(exports, "visual_png", render_failure)
    settings = make_settings(tmp_path)
    result = run(make_lecture(1), settings)
    assert result["notes"]["chunks"][0]["summary"] == "Velocity describes change in position."
    assert result["notes"]["chunks"][0]["visual"]["image"] is None
    assert json.loads((settings.lecture_dir("test-lecture") / "notes.json").read_text()) == result["notes"]


@pytest.mark.parametrize("content", ["[]", "null", '{"complete":false}', '{"complete":true,"data":'])
def test_non_object_and_incomplete_cache_records_are_ignored(tmp_path, monkeypatch, content):
    lecture, settings = make_lecture(1), make_settings(tmp_path)
    provider(monkeypatch)
    run(lecture, settings)
    path = next(settings.lecture_dir(lecture["id"]).rglob("chunk-0000.json"))
    path.write_text(content)
    calls = provider(monkeypatch)
    run(lecture, settings)
    assert calls == {0: 1}


def test_pipeline_works_with_shared_settings_boundary(tmp_path, monkeypatch):
    from lecnote.config import Settings
    from lecnote.pipeline import run_pipeline

    provider(monkeypatch)
    settings = Settings(data_dir=tmp_path, api_key="test-only", parallel_requests=1)
    progress = []
    result = run_pipeline(make_lecture(1), settings, lambda *args: progress.append(args), lambda: False)
    assert result["notes"]["overview"] == "Position and velocity are related."
    assert (settings.lecture_dir("test-lecture") / "notes.json").is_file()
    assert progress[-1][1] == 100
    assert [item[1] for item in progress] == sorted(item[1] for item in progress)


def test_transcribe_only_saves_raw_transcript_without_notes_or_credentials(tmp_path, monkeypatch):
    from lecnote import notes, pipeline

    lecture, settings = make_lecture(1), make_settings(tmp_path)
    expected = lecture.pop("transcript")
    media = tmp_path / "recording.wav"
    media.write_bytes(b"recording")
    lecture.update(media_path=str(media), transcribe_only=True, context="x" * 30_000)
    settings.api_key = ""
    monkeypatch.setattr(pipeline, "transcribe", lambda *args, **kwargs: expected)
    monkeypatch.setattr(
        notes,
        "NoteGenerator",
        lambda *args, **kwargs: pytest.fail("local-only must not construct notes service"),
    )
    progress = []
    result = pipeline.run_pipeline(lecture, settings, lambda *args: progress.append(args), lambda: False)
    assert result == {"transcript": expected, "notes": None}
    assert json.loads((settings.lecture_dir(lecture["id"]) / "transcript.json").read_text()) == expected
    assert progress[-1][0:2] == ("ready", 100)


def test_oversized_attachments_finish_with_bounded_chunk_specific_context(tmp_path, monkeypatch):
    lecture, settings = make_lecture(2), make_settings(tmp_path)
    lecture["transcript"]["segments"][0]["text"] = "Inventory LIFO reserve valuation"
    lecture["transcript"]["segments"][1]["text"] = "Depreciation asset useful life"
    lecture["attachments"] = [
        {"name": "Inventory.pdf", "text": "Inventory LIFO reserve valuation. " * 2500},
        {"name": "Assets.pdf", "text": "Depreciation asset useful life. " * 2500},
    ]
    captured = {}

    def parse(**kwargs):
        payload = json.loads(kwargs["input"])
        assert len(payload["context"]) <= 24_000
        assert len(kwargs["input"]) <= 120_000
        if "chunk" in payload:
            chunk = payload["chunk"]
            captured[chunk["index"]] = payload["context"]
            data = chunk_data(chunk["index"], chunk["start"], chunk["end"])
        else:
            captured["overview"] = payload["context"]
            data = overview_data()
        return response(data, kwargs["text_format"])

    install_provider(monkeypatch, parse)
    result = run(lecture, settings)
    assert len(result["notes"]["chunks"]) == 2
    assert len(captured) == 3
    assert captured[0] != captured[1]
    assert "Inventory LIFO reserve valuation" in captured[0]
    assert "Depreciation asset useful life" in captured[1]
    captured.clear()
    assert run(lecture, settings) == result
    assert captured == {}
    lecture["attachments"][0]["text"] += "\nA new unrelated footnote."
    run(lecture, settings)
    assert len(captured) == 3
    captured.clear()
    lecture["attachments"][0]["name"] = "Renamed inventory slides.pdf"
    run(lecture, settings)
    assert len(captured) == 3
    assert "Renamed inventory slides.pdf" in captured[0]

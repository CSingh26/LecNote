import copy
import json

import pytest
from test_notes import chunk_data, install_provider, overview_data, response
from test_pipeline import make_lecture, make_settings, run


@pytest.fixture(autouse=True)
def no_real_inference(monkeypatch):
    from lecnote import notes, pipeline

    def blocked(*args, **kwargs):
        pytest.fail("All inference must be mocked")

    monkeypatch.setattr(notes, "OpenAI", blocked)
    monkeypatch.setattr(pipeline, "transcribe", blocked)


def relevance_provider(monkeypatch, categories=None, hook=None):
    calls = []
    categories = categories or {}

    def parse(**kwargs):
        payload = json.loads(kwargs["input"])
        schema = kwargs["text_format"].__name__
        calls.append((schema, payload))
        assert len(kwargs["input"]) <= 120_000
        assert len(payload.get("context", "")) <= 24_000
        if hook:
            hook(schema, payload)
        if schema == "TopicMap":
            data = {"summary": "Physics: motion and velocity", "topics": ["Velocity"]}
        elif schema == "ClassificationBatch":
            data = {
                "segments": [
                    {
                        "segment_id": s["id"],
                        "category": categories.get(s["id"], "course_material"),
                        "reason": "Based on the full topic map",
                        "confidence": 0.95,
                    }
                    for s in payload["segments"]
                ]
            }
        elif schema == "CompactSummary":
            data = {"summary": "Velocity", "facts": ["Velocity is a rate."]}
        elif schema == "ChunkNote":
            chunk = payload["chunk"]
            data = chunk_data(chunk["index"], chunk["start"], chunk["end"])
        else:
            data = overview_data()
        return response(data, kwargs["text_format"])

    install_provider(monkeypatch, parse)
    return calls


def test_filtering_keeps_uncertainty_logistics_and_full_transcript(tmp_path, monkeypatch):
    lecture = make_lecture(4)
    original = copy.deepcopy(lecture["transcript"])
    calls = relevance_provider(
        monkeypatch,
        {
            0: "course_material",
            1: "class_logistics",
            2: "off_topic",
            3: "needs_review",
        },
    )
    result = run(lecture, make_settings(tmp_path))
    assert result["transcript"] == original
    assert "relevance" in result
    assert [s["category"] for s in result["relevance"]["segments"]] == [
        "course_material",
        "class_logistics",
        "off_topic",
        "needs_review",
    ]
    assert [s["segment_id"] for s in result["relevance"]["logistics"]] == [1]
    supplied = [s for name, p in calls if name == "ChunkNote" for s in p["chunk"]["segments"]]
    assert [s["id"] for s in supplied] == [0, 3]
    assert supplied[-1]["relevance"] == "needs_review"
    assert all(name == "TopicMap" for name, _ in calls[:1])
    assert result["relevance"]["segments"][3]["start"] == 1440


def test_overrides_reuse_analysis_and_invalidate_notes(tmp_path, monkeypatch):
    lecture, settings = make_lecture(2), make_settings(tmp_path)
    calls = relevance_provider(monkeypatch, {1: "off_topic"})
    first = run(lecture, settings)
    assert len(first["notes"]["chunks"]) == 1
    calls.clear()
    lecture["relevance_overrides"] = {"1": "course_material", "0": "needs_review"}
    result = run(lecture, settings)
    assert len(result["notes"]["chunks"]) == 2
    assert not any(name in {"TopicMap", "ClassificationBatch"} for name, _ in calls)
    assert result["relevance"]["segments"][1]["source"] == "manual"
    calls.clear()
    assert run(lecture, settings) == result
    assert not calls


def test_provenance_and_old_notes_compatibility(tmp_path, monkeypatch):
    from lecnote.schemas import Notes

    lecture = make_lecture(1)
    lecture.update(course_id="physics", course_title="Physics 101", selected_resource_ids=["slides-1"])
    lecture["resource_provenance"] = [{"id": "slides-1", "name": "Motion.pdf", "revision": 3}]
    relevance_provider(monkeypatch)
    result = run(lecture, make_settings(tmp_path))
    assert "provenance" in result["notes"]
    provenance = result["notes"]["provenance"]
    assert provenance["resource_provenance"] == lecture["resource_provenance"]
    assert provenance["context"] == lecture["context"]
    assert provenance["course_context"] == lecture["course_context"]
    assert provenance.get("title") == lecture["title"]
    assert provenance["course_id"] == "physics"
    assert provenance["course_title"] == "Physics 101"
    assert provenance["selected_resource_ids"] == ["slides-1"]
    assert provenance["relevance_fingerprint"] == result["relevance"]["fingerprint"]
    old = result["notes"].copy()
    old.pop("provenance")
    assert Notes.model_validate(old).chunks


def test_long_summary_is_hierarchical_bounded_and_cancellable(monkeypatch):
    from lecnote.notes import NoteGenerator
    from lecnote.schemas import ChunkNote, PipelineCancelled

    calls = relevance_provider(monkeypatch)
    chunks = [
        ChunkNote.model_validate(chunk_data(i, i, i + 1) | {"summary": "fact " * 700}) for i in range(150)
    ]
    generator = NoteGenerator(make_settings(None))
    result, usage = generator.summarize(chunks, "Motion", "Physics")
    assert result.title == "Motion"
    assert any(name == "CompactSummary" for name, _ in calls)
    assert usage.input_tokens == len(calls) * 100
    cancelled = False

    def hook(name, payload):
        nonlocal cancelled
        cancelled = True

    relevance_provider(monkeypatch, hook=hook)
    with pytest.raises(PipelineCancelled):
        NoteGenerator(make_settings(None), lambda: cancelled).summarize(chunks, "Motion", "Physics")


def test_failed_relevance_does_not_replace_old_notes(tmp_path, monkeypatch):
    lecture, settings = make_lecture(1), make_settings(tmp_path)
    relevance_provider(monkeypatch)
    run(lecture, settings)
    path = settings.lecture_dir(lecture["id"]) / "notes.json"
    old = path.read_bytes()
    lecture["context"] = "Changed"

    def fail(name, payload):
        raise RuntimeError("provider unavailable")

    relevance_provider(monkeypatch, hook=fail)
    with pytest.raises(RuntimeError, match="unavailable"):
        run(lecture, settings)
    assert path.read_bytes() == old
    assert json.loads(path.with_name("transcript.json").read_text()) == lecture["transcript"]


@pytest.mark.parametrize(
    "model, expected",
    [
        ("gpt-5.4-mini", {"effort": "low"}),
        ("gpt-5-mini", {"effort": "low"}),
        ("gpt-5.4-mini-2026-03-17", {"effort": "low"}),
        ("gpt-4.1-mini", None),
        ("custom-model", None),
        ("gpt-5-pro", None),
        ("gpt-5-chat-latest", None),
    ],
)
def test_reasoning_only_on_compatible_models(monkeypatch, model, expected):
    from test_notes import source_chunk

    from lecnote.notes import NoteGenerator

    seen = []

    def parse(**kwargs):
        seen.append(kwargs)
        return response(chunk_data(), kwargs["text_format"])

    install_provider(monkeypatch, parse)
    NoteGenerator(make_settings(None, model=model)).generate_chunk(source_chunk(), "")
    assert seen[0].get("reasoning") == expected


def test_full_long_transcript_reaches_topic_map_before_classification(tmp_path, monkeypatch):
    lecture = make_lecture(120)
    for s in lecture["transcript"]["segments"]:
        s["text"] = f"Beginning topic {s['id']}. " + "Teaching evidence. " * 800 + f" FINAL {s['id']}"
    calls = relevance_provider(monkeypatch)
    result = run(lecture, make_settings(tmp_path))
    assert len(result["relevance"]["segments"]) == 120
    first_classification = next(i for i, (name, _) in enumerate(calls) if name == "ClassificationBatch")
    maps = calls[:first_classification]
    assert all(name == "TopicMap" for name, _ in maps)
    evidence = [s for _, p in maps for s in p.get("evidence", [])]
    for original in lecture["transcript"]["segments"]:
        assert "".join(s["text"] for s in evidence if s["segment_id"] == original["id"]) == original["text"]
    assert any("topic_maps" in p for _, p in maps)


def test_missing_and_low_confidence_exclusions_are_retained(tmp_path, monkeypatch):
    calls = relevance_provider(monkeypatch)
    from lecnote import notes

    original_factory = notes.OpenAI

    def factory(**kwargs):
        client = original_factory(**kwargs)
        parse = client.responses.parse

        def incomplete(**request):
            result = parse(**request)
            if request["text_format"].__name__ == "ClassificationBatch":
                result.output_parsed.segments.pop()
                result.output_parsed.segments[0].category = "off_topic"
                result.output_parsed.segments[0].confidence = 0.4
            return result

        client.responses.parse = incomplete
        return client

    monkeypatch.setattr(notes, "OpenAI", factory)
    result = run(make_lecture(2), make_settings(tmp_path))
    assert [s["category"] for s in result["relevance"]["segments"]] == ["needs_review"] * 2
    assert len(result["notes"]["chunks"]) == 2
    assert sum(name == "ClassificationBatch" for name, _ in calls) == 1


@pytest.mark.parametrize("stage", ["TopicMap", "ClassificationBatch"])
def test_cancelled_analysis_request_is_cached_for_resume(tmp_path, monkeypatch, stage):
    from lecnote.schemas import PipelineCancelled

    stopped = False

    def stop(name, payload):
        nonlocal stopped
        if name == stage:
            stopped = True

    lecture, settings = make_lecture(2), make_settings(tmp_path)
    calls = relevance_provider(monkeypatch, hook=stop)
    with pytest.raises(PipelineCancelled):
        run(lecture, settings, lambda: stopped)
    assert calls[-1][0] == stage
    calls = relevance_provider(monkeypatch)
    run(lecture, settings)
    assert not any(name == stage for name, _ in calls)


def test_all_excluded_returns_logistics_without_inventing_study_notes(tmp_path, monkeypatch):
    calls = relevance_provider(monkeypatch, {0: "class_logistics", 1: "off_topic"})
    result = run(make_lecture(2), make_settings(tmp_path))
    assert result["notes"]["chunks"] == []
    assert result["notes"]["takeaways"] == []
    assert len(result["relevance"]["logistics"]) == 1
    assert not any(name in {"ChunkNote", "LectureOverview"} for name, _ in calls)


@pytest.mark.parametrize("overrides", [{"999": "off_topic"}, {"0": "discard"}, [], {"x": "off_topic"}])
def test_invalid_overrides_fail_before_inference(tmp_path, monkeypatch, overrides):
    lecture = make_lecture(1)
    lecture["relevance_overrides"] = overrides
    calls = relevance_provider(monkeypatch)
    with pytest.raises(ValueError):
        run(lecture, make_settings(tmp_path))
    assert not calls


def test_resource_revision_invalidates_analysis_and_notes(tmp_path, monkeypatch):
    lecture, settings = make_lecture(1), make_settings(tmp_path)
    lecture["resource_provenance"] = [{"id": "1", "name": "Motion", "revision": 1}]
    calls = relevance_provider(monkeypatch)
    run(lecture, settings)
    calls.clear()
    lecture["resource_provenance"][0]["revision"] = 2
    result = run(lecture, settings)
    assert {name for name, _ in calls} == {"TopicMap", "ClassificationBatch", "ChunkNote", "LectureOverview"}
    assert result["notes"]["provenance"]["resource_provenance"][0]["revision"] == 2


def test_interrupted_hierarchical_summary_reuses_completed_nodes(tmp_path, monkeypatch):
    from lecnote.notes import NoteGenerator
    from lecnote.pipeline import _stage_request
    from lecnote.schemas import ChunkNote, PipelineCancelled

    chunks = [
        ChunkNote.model_validate(chunk_data(i, i, i + 1) | {"summary": "fact " * 700}) for i in range(120)
    ]
    stopped = False

    def stop(name, payload):
        nonlocal stopped
        if name == "CompactSummary":
            stopped = True

    relevance_provider(monkeypatch, hook=stop)
    generator = NoteGenerator(make_settings(tmp_path), lambda: stopped)
    with pytest.raises(PipelineCancelled):
        generator.summarize(chunks, "Motion", "Physics", request=_stage_request(generator, tmp_path, "key"))
    completed = list(tmp_path.glob("CompactSummary-*.json"))
    assert len(completed) == 1
    original = completed[0].read_bytes()
    calls = relevance_provider(monkeypatch)
    generator = NoteGenerator(make_settings(tmp_path))
    result, usage = generator.summarize(
        chunks,
        "Motion",
        "Physics",
        request=_stage_request(generator, tmp_path, "key"),
    )
    assert result.title == "Motion"
    assert completed[0].read_bytes() == original
    assert usage.input_tokens >= (len(calls) + 1) * 100


def test_dense_segment_metadata_does_not_overflow_note_requests():
    from lecnote.notes import encoded_size
    from lecnote.pipeline import chunk_transcript

    transcript = make_lecture(1)["transcript"]
    transcript["segments"] = [
        {"id": i, "start": 0, "end": 1, "text": "V", "speaker": "s" * 500} for i in range(2000)
    ]
    chunks = chunk_transcript(transcript)
    assert all(encoded_size(chunk) < 60_000 for chunk in chunks)
    assert sum(len(chunk["segments"]) for chunk in chunks) == 2000


def test_fingerprint_tracks_inputs_but_not_manual_overrides(tmp_path, monkeypatch):
    lecture, settings = make_lecture(2), make_settings(tmp_path)
    calls = relevance_provider(monkeypatch, {1: "off_topic"})
    first = run(lecture, settings)
    assert len(first["relevance"].get("fingerprint", "")) == 64
    lecture["relevance_overrides"] = {"1": "course_material"}
    overridden = run(lecture, settings)
    assert overridden["relevance"]["fingerprint"] == first["relevance"]["fingerprint"]
    calls.clear()
    lecture["relevance_overrides"] = {}
    reset = run(lecture, settings)
    assert reset["relevance"] == first["relevance"]
    assert not calls
    lecture["course_context"] = "Revised course"
    revised = run(lecture, settings)
    assert revised["relevance"]["fingerprint"] != first["relevance"]["fingerprint"]


def test_classification_batches_cover_all_ids_once_and_never_exceed_64(tmp_path, monkeypatch):
    lecture = make_lecture(130)
    calls = relevance_provider(monkeypatch)
    result = run(lecture, make_settings(tmp_path))
    batches = [p["segments"] for name, p in calls if name == "ClassificationBatch"]
    assert all(len(batch) <= 64 for batch in batches)
    assert [s["id"] for batch in batches for s in batch] == list(range(130))
    assert [s["segment_id"] for s in result["relevance"]["segments"]] == list(range(130))

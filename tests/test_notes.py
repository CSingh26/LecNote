import json
from types import SimpleNamespace

import pytest


@pytest.fixture(autouse=True)
def block_real_openai(monkeypatch):
    from lecnote import notes

    def blocked(**kwargs):
        pytest.fail("A provider boundary was not stubbed; real API requests are forbidden")

    monkeypatch.setattr(notes, "OpenAI", blocked)


def chunk_data(index=0, start=0, end=480):
    return {
        "index": index,
        "start": start,
        "end": end,
        "title": "Motion",
        "summary": "Velocity describes change in position.",
        "key_points": [{"text": "Velocity is a rate.", "timestamp": start}],
        "definitions": [{"term": "Velocity", "definition": "Change in position over time."}],
        "formulas": [{"latex": r"v=\frac{dx}{dt}", "explanation": "Rate of position change."}],
        "examples": ["The lecturer described a moving cart."],
        "emphasized_points": [],
        "practice": [{"question": "Find the speed for 6 m in 2 s.", "answer": "3 m/s."}],
        "visual": None,
    }


def overview_data():
    return {
        "title": "Motion",
        "overview": "Position and velocity are related.",
        "takeaways": ["Velocity is a rate."],
        "glossary": [{"term": "Velocity", "definition": "Rate of position change."}],
        "review_questions": [{"question": "What is velocity?", "answer": "Rate of position change."}],
    }


def response(data, schema):
    return SimpleNamespace(
        status="completed",
        output_parsed=schema.model_validate(data),
        output=[],
        usage=SimpleNamespace(input_tokens=100, output_tokens=40),
    )


def settings(**kwargs):
    return SimpleNamespace(api_key="test-only-key", model="gpt-4.1-mini", **kwargs)


def source_chunk():
    return {
        "index": 0,
        "start": 0,
        "end": 480,
        "segments": [
            {"id": 0, "start": 0, "end": 30, "text": "Velocity is a rate.", "speaker": None},
            {"id": 1, "start": 470, "end": 480, "text": "Closing point.", "speaker": None},
        ],
    }


def install_provider(monkeypatch, handler):
    from lecnote import notes

    constructor_args = []

    def factory(**kwargs):
        constructor_args.append(kwargs)
        return SimpleNamespace(responses=SimpleNamespace(parse=handler), close=lambda: None)

    monkeypatch.setattr(notes, "OpenAI", factory)
    return constructor_args


def test_responses_uses_strict_model_text_only_and_no_storage(monkeypatch):
    from lecnote.notes import NoteGenerator

    calls = []

    def parse(**kwargs):
        calls.append(kwargs)
        return response(chunk_data(), kwargs["text_format"])

    constructor_args = install_provider(monkeypatch, parse)
    generator = NoteGenerator(settings())
    note, usage = generator.generate_chunk(source_chunk(), "Course context")
    assert note.key_points[0].timestamp == 0
    assert usage.model_dump() == {"input_tokens": 100, "output_tokens": 40}
    assert calls[0]["store"] is False
    assert isinstance(calls[0]["input"], str)
    assert "Course context" in calls[0]["input"]
    assert "supplementary" in calls[0]["instructions"].lower()
    assert constructor_args[0]["max_retries"] == 0


@pytest.mark.parametrize("timestamp", [-1, 200, 481])
def test_rejects_citations_outside_actual_source_segments(monkeypatch, timestamp):
    from lecnote.notes import NoteGenerator, NotesError

    attempts = []

    def parse(**kwargs):
        attempts.append(1)
        data = chunk_data()
        data["key_points"][0]["timestamp"] = timestamp
        return response(data, kwargs["text_format"])

    install_provider(monkeypatch, parse)
    monkeypatch.setattr("lecnote.notes.time.sleep", lambda _: None)
    with pytest.raises(NotesError, match="valid|citation|timestamp"):
        NoteGenerator(settings()).generate_chunk(source_chunk(), "")
    assert len(attempts) == 4


def test_transient_errors_retry_with_backoff_at_most_three_times(monkeypatch):
    import httpx
    from openai import RateLimitError

    from lecnote.notes import NoteGenerator, NotesError

    attempts, delays = [], []

    def parse(**kwargs):
        attempts.append(1)
        raise RateLimitError(
            "slow down",
            response=httpx.Response(429, request=httpx.Request("POST", "https://example.test")),
            body=None,
        )

    install_provider(monkeypatch, parse)
    monkeypatch.setattr("lecnote.notes.time.sleep", delays.append)
    with pytest.raises(NotesError, match="rate|429|retry|retries"):
        NoteGenerator(settings()).generate_chunk(source_chunk(), "")
    assert len(attempts) == 4
    assert sum(delays) >= 3


def test_refusal_is_actionable_without_retry(monkeypatch):
    from lecnote.notes import NoteGenerator, NotesError

    calls = []

    def parse(**kwargs):
        calls.append(1)
        return SimpleNamespace(
            status="completed",
            output_parsed=None,
            usage=None,
            output=[SimpleNamespace(content=[SimpleNamespace(type="refusal", refusal="No.")])],
        )

    install_provider(monkeypatch, parse)
    with pytest.raises(NotesError, match="refused"):
        NoteGenerator(settings()).generate_chunk(source_chunk(), "")
    assert len(calls) == 1


def test_oversized_context_rejected_before_paid_request(monkeypatch):
    from lecnote.notes import NoteGenerator, NotesError

    calls = install_provider(monkeypatch, lambda **kwargs: pytest.fail("must not call provider"))
    with pytest.raises(NotesError, match="large|limit"):
        NoteGenerator(settings()).generate_chunk(source_chunk(), "x" * 200_000)
    assert calls == []


@pytest.mark.parametrize(
    "changes",
    [
        {"x": [0, float("nan")], "y": [1, 2]},
        {"x": [0, 1], "y": [1]},
        {"x": ["__import__('os')"], "y": [1]},
        {"kind": "mermaid", "mermaid": 'graph TD\n A-->B\n click A "javascript:alert(1)"'},
        {"kind": "mermaid", "mermaid": "%%{init: {'securityLevel': 'loose'}}%%\ngraph TD\nA-->B"},
    ],
)
def test_visual_schema_rejects_unsafe_or_invalid_specs(changes):
    from pydantic import ValidationError

    from lecnote.schemas import Visual

    data = {
        "kind": "plot",
        "title": "Motion",
        "mermaid": None,
        "x": [0, 1],
        "y": [0, 2],
        "x_label": "Time",
        "y_label": "Position",
        "image": None,
    }
    with pytest.raises(ValidationError):
        Visual.model_validate(data | changes)


def test_sdk_structured_schema_has_required_fields_and_no_extra_properties():
    from openai.lib._pydantic import to_strict_json_schema

    from lecnote.schemas import ChunkNote, LectureOverview

    for model in (ChunkNote, LectureOverview):
        schema = to_strict_json_schema(model)
        for definition in [schema, *schema.get("$defs", {}).values()]:
            if definition.get("type") == "object":
                assert definition["additionalProperties"] is False
                assert set(definition["required"]) == set(definition["properties"])
        assert "NaN" not in json.dumps(schema)


def test_cancellation_during_backoff_stops_retries(monkeypatch):
    import httpx
    from openai import RateLimitError

    from lecnote.notes import NoteGenerator
    from lecnote.pipeline import PipelineCancelled

    calls = []
    cancelled = []

    def parse(**kwargs):
        calls.append(1)
        raise RateLimitError(
            "rate limited",
            response=httpx.Response(429, request=httpx.Request("POST", "https://example.test")),
            body=None,
        )

    install_provider(monkeypatch, parse)
    monkeypatch.setattr("lecnote.notes.time.sleep", lambda _: cancelled.append(True))
    with pytest.raises(PipelineCancelled):
        NoteGenerator(settings(), lambda: bool(cancelled)).generate_chunk(source_chunk(), "")
    assert calls == [1]


def test_missing_key_and_auth_failures_are_actionable_without_retry(monkeypatch):
    import httpx
    from openai import AuthenticationError

    from lecnote.notes import NoteGenerator, NotesError

    with pytest.raises(NotesError, match="API key"):
        NoteGenerator(SimpleNamespace(api_key="", model="gpt-4.1-mini")).generate_chunk(source_chunk(), "")
    calls = []

    def parse(**kwargs):
        calls.append(1)
        raise AuthenticationError(
            "invalid key",
            response=httpx.Response(401, request=httpx.Request("POST", "https://example.test")),
            body=None,
        )

    install_provider(monkeypatch, parse)
    with pytest.raises(NotesError, match="key.*rejected"):
        NoteGenerator(settings()).generate_chunk(source_chunk(), "")
    assert calls == [1]


def test_real_sdk_parse_roundtrip_uses_mock_http_transport(monkeypatch):
    import httpx
    from openai import OpenAI

    from lecnote import notes

    requests = []

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "resp_test",
                "object": "response",
                "created_at": 1750000000,
                "status": "completed",
                "model": "gpt-4.1-mini",
                "error": None,
                "incomplete_details": None,
                "instructions": None,
                "metadata": {},
                "parallel_tool_calls": False,
                "tool_choice": "auto",
                "tools": [],
                "temperature": 1,
                "top_p": 1,
                "output": [
                    {
                        "id": "msg_test",
                        "type": "message",
                        "status": "completed",
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "annotations": [], "text": json.dumps(chunk_data())}
                        ],
                    }
                ],
                "usage": {
                    "input_tokens": 100,
                    "input_tokens_details": {"cached_tokens": 0},
                    "output_tokens": 40,
                    "output_tokens_details": {"reasoning_tokens": 0},
                    "total_tokens": 140,
                },
            },
        )

    client = OpenAI(
        api_key="test-only", http_client=httpx.Client(transport=httpx.MockTransport(handle)), max_retries=0
    )
    monkeypatch.setattr(notes, "OpenAI", lambda **kwargs: client)
    generator = notes.NoteGenerator(settings())
    try:
        result, usage = generator.generate_chunk(source_chunk(), "text context")
    finally:
        generator.close()
    assert result.summary == "Velocity describes change in position."
    assert usage.input_tokens == 100
    assert requests[0]["store"] is False
    assert isinstance(requests[0]["input"], str)
    assert requests[0]["text"]["format"]["type"] == "json_schema"
    assert requests[0]["text"]["format"]["strict"] is True
    assert "tools" not in requests[0]

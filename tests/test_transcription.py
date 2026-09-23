import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


def test_whisper_lazy_cpu_int8_loading_progress_and_vocabulary(tmp_path, monkeypatch):
    from lecnote import transcription

    transcription._models.clear()
    loads, requests, progress = [], [], []

    class FakeWhisper:
        def __init__(self, model, **kwargs):
            loads.append((model, kwargs))

        def transcribe(self, path, **kwargs):
            requests.append((path, kwargs))
            return iter(
                [
                    SimpleNamespace(start=0, end=2, text=" velocity "),
                    SimpleNamespace(start=2, end=4, text=" acceleration "),
                ]
            ), SimpleNamespace(language="en", duration=4)

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=FakeWhisper))
    settings = SimpleNamespace(whisper_model="base", language="en")
    media = tmp_path / "audio.wav"
    media.write_bytes(b"audio")
    result = transcription.transcribe(
        media, settings, "velocity", progress=lambda *args: progress.append(args)
    )
    transcription.transcribe(media, settings)
    assert len(loads) == 1
    assert loads[0][1]["device"] == "cpu"
    assert loads[0][1]["compute_type"] == "int8"
    assert requests[0][1]["initial_prompt"] == "velocity"
    assert requests[0][1]["language"] == "en"
    assert result["segments"] == [
        {"id": 0, "start": 0.0, "end": 2.0, "text": "velocity", "speaker": None},
        {"id": 1, "start": 2.0, "end": 4.0, "text": "acceleration", "speaker": None},
    ]
    assert progress[-1][0] == 100


def test_cancel_raised_by_progress_is_not_wrapped(tmp_path, monkeypatch):
    from lecnote import transcription
    from lecnote.pipeline import PipelineCancelled

    class FakeWhisper:
        def transcribe(self, *args, **kwargs):
            return iter([SimpleNamespace(start=0, end=1, text="hello")]), SimpleNamespace(
                language="en", duration=1
            )

    monkeypatch.setattr(transcription, "_get_model", lambda _: FakeWhisper())
    media = tmp_path / "audio.wav"
    media.write_bytes(b"audio")

    def cancel(*args):
        raise PipelineCancelled("cancelled")

    with pytest.raises(PipelineCancelled):
        transcription.transcribe(media, SimpleNamespace(whisper_model="base", language=""), progress=cancel)


def test_missing_source_has_actionable_error():
    from lecnote.transcription import transcribe

    with pytest.raises(RuntimeError, match="not found|exist"):
        transcribe(Path("/missing/audio.wav"), SimpleNamespace(whisper_model="base", language=""))


def test_onnx_telemetry_is_disabled_before_model_loading_and_inference(tmp_path, monkeypatch):
    from lecnote import transcription

    order = []

    class Model:
        def transcribe(self, *args, **kwargs):
            order.append("inference")
            return iter([SimpleNamespace(start=0, end=1, text="hello")]), SimpleNamespace(
                language="en", duration=1
            )

    def get_model(name):
        order.append("model")
        return Model()

    monkeypatch.setitem(
        sys.modules, "onnxruntime", SimpleNamespace(disable_telemetry_events=lambda: order.append("disable"))
    )
    monkeypatch.setattr(transcription, "_get_model", get_model)
    media = tmp_path / "recording.wav"
    media.write_bytes(b"audio")
    transcription.transcribe(media, SimpleNamespace(whisper_model="base", language="en"))
    assert order == ["disable", "model", "inference"]

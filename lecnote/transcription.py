"""Lazy, local-only faster-whisper transcription with CPU int8 inference."""

from pathlib import Path
from threading import Lock

from .schemas import MAX_CONTEXT_CHARACTERS, PipelineCancelled, Transcript

TRANSCRIPTION_VERSION = "faster-whisper-cpu-int8-v1"
_models = {}
_model_lock = Lock()
_inference_lock = Lock()


def _get_model(name: str):
    with _model_lock:
        if name not in _models:
            try:
                from faster_whisper import WhisperModel

                model = WhisperModel(name, device="cpu", compute_type="int8")
            except ImportError as exc:
                raise RuntimeError(
                    "Local transcription requires faster-whisper. Complete the Python setup."
                ) from exc
            except Exception as exc:
                raise RuntimeError(
                    f"Could not load local Whisper model '{name}'. The first run needs internet to download "
                    "model weights; check the model name, connectivity and available disk space."
                ) from exc
            # Keep only one model resident when the user changes the selection.
            _models.clear()
            _models[name] = model
        return _models[name]


def transcribe(path: Path, settings, vocabulary: str = "", progress=None) -> dict:
    """Return timestamped segments; progress(percent, message) may raise to cancel.

    Model loading and a single inference step cannot be interrupted. Progress is
    emitted before loading and after every yielded segment, enabling cooperative
    cancellation without leaving a partial transcript marked complete.
    """
    path = Path(path)
    if not path.is_file():
        raise RuntimeError("Recording not found. Re-import the audio or video file.")
    if len(vocabulary) > MAX_CONTEXT_CHARACTERS:
        raise ValueError("Vocabulary is too large; shorten the course vocabulary")
    report = progress or (lambda percent, message: None)
    report(0, "Loading the local Whisper model (first use may download weights)")
    with _inference_lock:
        try:
            import onnxruntime
        except ImportError:
            pass
        else:
            onnxruntime.disable_telemetry_events()
        model = _get_model(settings.whisper_model)
        report(0, "Transcribing locally on CPU")
        try:
            segments, info = model.transcribe(
                str(path),
                language=getattr(settings, "language", "") or None,
                initial_prompt=vocabulary.strip() or None,
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=True,
            )
            duration = float(info.duration)
            result = []
            for segment in segments:
                text = segment.text.strip()
                if text:
                    result.append(
                        {
                            "id": len(result),
                            "start": float(segment.start),
                            "end": float(segment.end),
                            "text": text,
                            "speaker": None,
                        }
                    )
                report(min(99, 100 * float(segment.end) / max(duration, 0.01)), "Transcribing locally on CPU")
            if not result:
                raise RuntimeError(
                    "No speech was detected. Check the recording or import a corrected transcript."
                )
            duration = max(duration, result[-1]["end"])
            transcript = Transcript(language=info.language or "unknown", duration=duration, segments=result)
        except PipelineCancelled:
            raise
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(
                "Local transcription failed. Check that the recording is readable and contains audio."
            ) from exc
    report(100, "Local transcription complete")
    return transcript.model_dump()

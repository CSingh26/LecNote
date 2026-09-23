"""Local attachment extraction, optional speaker inference, and recording assembly.

Paths are supplied by the server after upload validation. Importing this module
does not load models, launch a compiler, or perform network requests.
"""

import importlib.util
import inspect
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from contextlib import ExitStack
from pathlib import Path

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
_OCR_SETUP = (
    "Install Tesseract and its language data, and ensure 'tesseract' is on PATH. "
    "On macOS, Apple Vision is also available with Xcode Command Line Tools "
    "(xcode-select --install). Images are processed locally."
)


def _require_file(path: Path) -> Path:
    path = Path(path)
    try:
        if not path.exists():
            raise RuntimeError(f"File not found: {path.name}. Upload the file again.")
        if not path.is_file():
            raise RuntimeError(f"Not a regular file: {path.name}.")
        if not path.stat().st_size:
            raise RuntimeError(f"File is empty: {path.name}. Upload a nonempty file.")
    except OSError as exc:
        raise RuntimeError(f"Cannot access {path.name}. Check local file permissions.") from exc
    return path


def extract_context(path: Path) -> str:
    """Extract UTF-8 text, PDF text, or image text entirely on this computer."""
    path = _require_file(path)
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md"}:
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeError as exc:
            raise RuntimeError("Text attachments must be UTF-8. Save the file as UTF-8 and retry.") from exc
        except OSError as exc:
            raise RuntimeError(f"Cannot read {path.name}. Check local file permissions.") from exc
        if not text.strip():
            raise RuntimeError("Text attachment is empty. Upload a file containing text.")
        return text
    if suffix == ".pdf":
        return _extract_pdf(path)
    if suffix in _IMAGE_SUFFIXES:
        return _extract_image(path)
    raise RuntimeError("Unsupported attachment type. Use .txt, .md, .pdf, .png, .jpg, .jpeg, or .webp.")


def _extract_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("PDF extraction requires pypdf. Install LecNote's project dependencies.") from exc
    try:
        with path.open("rb") as source:
            reader = PdfReader(source)
            if reader.is_encrypted:
                raise RuntimeError("PDF is encrypted. Export an unlocked copy without a password and retry.")
            text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("Cannot read this PDF. It may be invalid or damaged; export a new PDF and retry.") from exc
    if not text.strip():
        raise RuntimeError(
            "PDF has no extractable text. For scanned slides, export pages as images "
            "and attach them for local OCR, or provide a searchable PDF."
        )
    return text


def _swift_path() -> str | None:
    if sys.platform != "darwin" or not Path(__file__).with_name("ocr.swift").is_file():
        return None
    swift = shutil.which("swift")
    if not swift:
        return None
    # /usr/bin/swift is a launcher even on Macs without the developer tools.
    if swift == "/usr/bin/swift":
        xcrun = shutil.which("xcrun")
        if not xcrun:
            return None
        try:
            result = subprocess.run(
                [xcrun, "--find", "swift"], capture_output=True, text=True, timeout=5, check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        swift = result.stdout.strip()
        if result.returncode or not swift or not os.access(swift, os.X_OK):
            return None
    return swift


def _run_ocr(command: list[str]) -> str:
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=120, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Local OCR timed out. Try a smaller image.") from exc
    except OSError as exc:
        raise RuntimeError("Cannot start the local OCR tool. Check its installation.") from exc
    if result.returncode:
        detail = result.stderr.strip()[-1500:]
        raise RuntimeError(f"Local OCR could not read the image. Check the image and backend setup. {detail}")
    return result.stdout.strip()


def _extract_image(path: Path) -> str:
    errors = []
    swift = _swift_path()
    if swift:
        try:
            # Compiling the Swift script happens only on an explicit OCR request.
            with tempfile.TemporaryDirectory(prefix="lecnote-vision-") as cache:
                text = _run_ocr([
                    swift, "-module-cache-path", cache, str(Path(__file__).with_name("ocr.swift")),
                    str(path.resolve()),
                ])
            if text:
                return text
        except RuntimeError as exc:
            errors.append(f"Apple Vision: {exc}")
    tesseract = shutil.which("tesseract")
    if tesseract:
        try:
            text = _run_ocr([tesseract, str(path.resolve()), "stdout"])
            if text:
                return text
        except RuntimeError as exc:
            errors.append(f"Tesseract: {exc}")
    if not swift and not tesseract:
        raise RuntimeError(f"No local OCR backend is available. {_OCR_SETUP}")
    if errors:
        raise RuntimeError(f"{' '.join(errors)} {_OCR_SETUP}")
    raise RuntimeError("Local OCR found no readable text. Upload a sharper, well-lit image containing text.")


def _interval(start, end) -> tuple[float, float]:
    try:
        start, end = float(start), float(end)
    except (TypeError, ValueError) as exc:
        raise ValueError("Speaker interval timestamps must be finite numbers.") from exc
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
        raise ValueError("Speaker interval timestamps must be finite, nonnegative, and ordered.")
    return start, end


def _assign_speakers(segments: list[dict], turns: list[tuple[float, float, str]]) -> list[dict]:
    """Copy segments, assigning greatest total overlap; ties use label order.

    Merge each speaker's overlapping turns so duplicate tracks cannot inflate
    overlap. Zero-duration segments and gaps retain a null speaker.
    """
    by_speaker: dict[str, list[tuple[float, float]]] = {}
    for start, end, speaker in turns:
        start, end = _interval(start, end)
        if not isinstance(speaker, str) or not speaker:
            raise ValueError("Speaker inference returned an invalid speaker label.")
        if end > start:
            by_speaker.setdefault(speaker, []).append((start, end))
    for speaker, intervals in by_speaker.items():
        merged = []
        for start, end in sorted(intervals):
            if merged and start <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], end))
            else:
                merged.append((start, end))
        by_speaker[speaker] = merged
    result = []
    for segment in segments:
        start, end = _interval(segment["start"], segment["end"])
        best_speaker, best_overlap = None, 0.0
        for speaker in sorted(by_speaker):
            overlap = sum(max(0.0, min(end, stop) - max(start, begin)) for begin, stop in by_speaker[speaker])
            if overlap > best_overlap:
                best_speaker, best_overlap = speaker, overlap
        result.append({**segment, "speaker": best_speaker})
    return result


def diarize_segments(path: Path, segments: list[dict], token: str) -> list[dict]:
    """Run optional pyannote locally; weights may download on this explicit call.

    Supports pyannote.audio 3.x and 4.x. Hugging Face access conditions must be
    accepted before the first model download. Audio is never sent to a service.
    """
    path = _require_file(path)
    if not segments:
        return []
    if not token or not token.strip():
        raise RuntimeError("Local diarization requires a Hugging Face token. Add it in Settings and retry.")
    try:
        from pyannote.audio import Pipeline
    except (ImportError, OSError, RuntimeError):
        raise RuntimeError(
            "Local diarization requires working pyannote.audio dependencies. "
            "Install the optional speakers extra (pip install -e '.[speakers]') "
            "and FFmpeg, then restart LecNote."
        ) from None
    modern = "token" in inspect.signature(Pipeline.from_pretrained).parameters
    model = "pyannote/speaker-diarization-community-1" if modern else "pyannote/speaker-diarization-3.1"
    try:
        pipeline = Pipeline.from_pretrained(model, **{"token" if modern else "use_auth_token": token.strip()})
        if pipeline is None:
            raise RuntimeError("Model access was denied.")
        prediction = pipeline(str(path))
        annotation = getattr(prediction, "speaker_diarization", prediction)
        turns = [(turn.start, turn.end, speaker) for turn, _, speaker in annotation.itertracks(yield_label=True)]
        return _assign_speakers(segments, turns)
    except Exception:  # noqa: BLE001 - Third-party inference errors must not expose credentials.
        # Provider exceptions can include authenticated URLs; keep secrets out of job errors.
        raise RuntimeError(
            f"Local diarization failed. Accept the model conditions at https://huggingface.co/{model} "
            "(also pyannote/segmentation-3.0 for pyannote.audio 3.x), verify your Hugging Face token, "
            "and allow the first model download. Check that the audio is readable and that "
            "pyannote.audio, its audio decoder, and FFmpeg are installed correctly."
        ) from None


def _wav_data_size(source) -> int:
    """Check RIFF boundaries and PCM headers, including partial samples wave ignores."""
    size = os.fstat(source.fileno()).st_size
    header = source.read(12)
    if len(header) != 12 or header[:4] != b"RIFF" or header[8:] != b"WAVE":
        raise ValueError("Invalid WAV: expected a RIFF/WAVE header.")
    if struct.unpack_from("<I", header, 4)[0] + 8 != size:
        raise ValueError("Invalid or truncated WAV: RIFF length does not match the file.")
    seen_format = False
    data_size = None
    while source.tell() < size:
        chunk = source.read(8)
        if len(chunk) != 8:
            raise ValueError("Truncated WAV chunk header.")
        kind, length = struct.unpack("<4sI", chunk)
        end = source.tell() + length
        padded_end = end + (length % 2)
        if padded_end > size:
            raise ValueError("Truncated or invalid WAV chunk/sample.")
        if kind == b"fmt ":
            if seen_format or length < 16:
                raise ValueError("Invalid WAV sample format header.")
            code, channels, rate, byte_rate, alignment, bits = struct.unpack("<HHIIHH", source.read(16))
            if code != 1 or channels != 1 or bits != 16:
                raise ValueError("WAV chunks must use uncompressed mono PCM16 (16-bit) audio.")
            if rate <= 0 or byte_rate != rate * 2 or alignment != 2:
                raise ValueError("Invalid WAV sample rate or frame alignment.")
            seen_format = True
        elif kind == b"data":
            if not seen_format or data_size is not None:
                raise ValueError("Invalid WAV: expected one data chunk after the sample format.")
            if not length:
                raise ValueError("WAV chunk contains empty audio.")
            if length % 2:
                raise ValueError("Invalid WAV: incomplete PCM16 sample.")
            data_size = length
        source.seek(padded_end)
    if data_size is None:
        raise ValueError("Invalid WAV: missing audio data.")
    source.seek(0)
    return data_size


def assemble_wav(chunks: list[Path], destination: Path) -> None:
    """Atomically concatenate mono PCM16 WAVs in the caller's sequence order.

    Rates must match. At most 65,536 frames are buffered, and a failed assembly
    leaves an existing destination intact. No resampling or silence is inserted.
    """
    if not chunks:
        raise ValueError("At least one nonempty WAV chunk is required.")
    destination = Path(destination)
    for chunk in chunks:
        if Path(chunk).resolve() == destination.resolve() or (
            destination.exists() and Path(chunk).exists() and os.path.samefile(chunk, destination)
        ):
            raise ValueError("WAV destination must not replace a source chunk.")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent, delete=False,
        ) as target:
            temporary = Path(target.name)
            with ExitStack() as stack:
                output = None
                rate = None
                total_bytes = 0
                for chunk in chunks:
                    path = _require_file(chunk)
                    with path.open("rb") as source:
                        data_size = _wav_data_size(source)
                        with wave.open(source, "rb") as audio:
                            if rate is None:
                                rate = audio.getframerate()
                                output = stack.enter_context(wave.open(target, "wb"))
                                output.setnchannels(1)
                                output.setsampwidth(2)
                                output.setframerate(rate)
                            elif audio.getframerate() != rate:
                                raise ValueError("WAV chunks must have a consistent sample rate.")
                            total_bytes += data_size
                            if total_bytes > 0xFFFFFFFF - 36:
                                raise ValueError("Recording exceeds the 4 GiB WAV size limit. Split the recording.")
                            remaining = data_size // 2
                            while remaining:
                                count = min(remaining, 65_536)
                                data = audio.readframes(count)
                                if len(data) != count * 2:
                                    raise ValueError(f"Truncated WAV audio in {path.name}.")
                                output.writeframesraw(data)
                                remaining -= count
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, destination)
    except (OSError, EOFError, wave.Error, struct.error) as exc:
        raise RuntimeError(
            "Cannot assemble WAV recording. Check that every chunk is a complete mono PCM16 WAV "
            "and the output folder is writable with enough free space."
        ) from exc
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def capabilities() -> dict:
    """Report installed local backends without importing ML runtimes or loading models.

    Availability does not certify model access, cached weights, or OCR quality;
    runtime setup errors remain actionable when a backend is requested.
    """
    try:
        diarization = all(importlib.util.find_spec(name) is not None for name in ("pyannote.audio", "torch"))
    except (ImportError, ValueError, AttributeError):
        diarization = False
    return {"ocr": bool(shutil.which("tesseract") or _swift_path()), "diarization": diarization}

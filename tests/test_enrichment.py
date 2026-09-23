"""Local enrichment behavior; only optional inference/OS boundaries are replaced."""

import importlib
import os
import struct
import subprocess
import sys
import types
import wave

import pytest


@pytest.fixture
def enrichment():
    return importlib.import_module("lecnote.enrichment")


def write_wav(path, samples=(1, -2, 3), *, channels=1, width=2, rate=16000):
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(channels)
        audio.setsampwidth(width)
        audio.setframerate(rate)
        audio.writeframes(
            struct.pack("<" + "h" * len(samples), *samples)
            if width == 2 else b"\x00" * (len(samples) * width)
        )
    return path


def write_pdf(path, pages, *, password=None):
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    for text in pages:
        page = writer.add_blank_page(width=612, height=792)
        if text:
            font = DictionaryObject({
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            })
            page[NameObject("/Resources")] = DictionaryObject({
                NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
            })
            content = DecodedStreamObject()
            content.set_data(f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("ascii"))
            page[NameObject("/Contents")] = content
    if password:
        writer.encrypt(password)
    with path.open("wb") as output:
        writer.write(output)
    return path


@pytest.mark.parametrize("suffix", [".txt", ".md", ".MD", ".TXT"])
def test_text_preserves_unicode_markdown_and_line_order(enrichment, tmp_path, suffix):
    source = tmp_path / ("notes" + suffix)
    source.write_text("\ufeff# Caf\u00e9\n\n- First\n- Second\n", encoding="utf-8")
    assert enrichment.extract_context(source) == "# Caf\u00e9\n\n- First\n- Second\n"


def test_pdf_extracts_actual_text_in_page_order(enrichment, tmp_path):
    source = write_pdf(tmp_path / "slides.pdf", ["First slide", None, "Third slide"])
    result = enrichment.extract_context(source)
    assert result.index("First slide") < result.index("Third slide")
    assert "\n" in result


@pytest.mark.parametrize("kind, match", [
    ("missing", "(?i)(not found|does not exist)"),
    ("directory", "(?i)(regular file|not a file)"),
    ("empty", "(?i)empty"),
    ("binary", "(?i)UTF-8"),
    ("unsupported", "(?i)unsupported"),
    ("broken_pdf", "(?i)(invalid|read).*PDF"),
    ("scanned_pdf", "(?i)(no extractable text|OCR)"),
    ("encrypted_pdf", "(?i)(encrypted|password)"),
])
def test_invalid_context_has_actionable_errors(enrichment, tmp_path, kind, match):
    source = tmp_path / "source.txt"
    if kind == "directory":
        source.mkdir()
    elif kind == "empty":
        source.write_text("")
    elif kind == "binary":
        source.write_bytes(b"\xff\xfe\x00\x01")
    elif kind == "unsupported":
        source = tmp_path / "source.docx"
        source.write_bytes(b"not a supported attachment")
    elif kind == "broken_pdf":
        source = tmp_path / "source.pdf"
        source.write_bytes(b"not a PDF")
    elif kind == "scanned_pdf":
        source = write_pdf(tmp_path / "source.pdf", [None])
    elif kind == "encrypted_pdf":
        source = write_pdf(tmp_path / "source.pdf", ["Secret"], password="locked")
    with pytest.raises(RuntimeError, match=match):
        enrichment.extract_context(source)


def test_speakers_use_total_overlap_not_midpoint_or_first_turn(enrichment):
    segments = [{"id": 1, "start": 0.0, "end": 10.0, "text": "Lecture", "speaker": None}]
    turns = [(0, 3, "A"), (3, 7, "B"), (7, 10, "A")]
    result = enrichment._assign_speakers(segments, turns)
    assert result == [{**segments[0], "speaker": "A"}]
    assert segments[0]["speaker"] is None
    assert result[0] is not segments[0]


def test_speaker_overlap_does_not_double_count_same_speaker(enrichment):
    segments = [{"start": 0, "end": 10}]
    turns = [(0, 4, "A"), (1, 4, "A"), (4, 10, "B")]
    assert enrichment._assign_speakers(segments, turns)[0]["speaker"] == "B"


def test_speaker_gaps_boundaries_and_zero_duration_remain_null(enrichment):
    segments = [{"start": 0, "end": 1}, {"start": 3, "end": 4}, {"start": 2, "end": 2}]
    assert [item["speaker"] for item in enrichment._assign_speakers(segments, [(1, 3, "A")])] == [
        None, None, None,
    ]
    assert enrichment._assign_speakers([{"start": 0, "end": 1}], [])[0]["speaker"] is None


def test_speaker_assignment_handles_unsorted_segments_and_turns(enrichment):
    segments = [{"start": 6, "end": 9}, {"start": 0, "end": 3}]
    assert [item["speaker"] for item in enrichment._assign_speakers(segments, [
        (5, 10, "B"), (0, 5, "A"),
    ])] == ["B", "A"]


@pytest.mark.parametrize("start, end", [(2, 1), (-1, 2), (0, float("inf")), (float("nan"), 2)])
def test_speaker_assignment_rejects_invalid_timestamps(enrichment, start, end):
    with pytest.raises(ValueError, match="(?i)(timestamp|interval)"):
        enrichment._assign_speakers([{"start": start, "end": end}], [])


@pytest.mark.parametrize("modern", [False, True])
def test_diarization_adapts_real_pyannote_result_shapes(enrichment, monkeypatch, tmp_path, modern):
    monkeypatch.delenv("PYANNOTE_METRICS_ENABLED", raising=False)
    source = write_wav(tmp_path / "lecture.wav")
    calls = []

    class Annotation:
        def itertracks(self, yield_label=False):
            assert yield_label
            yield types.SimpleNamespace(start=0.0, end=2.0), "track", "SPEAKER_07"

    def infer(path):
        assert os.environ.get("PYANNOTE_METRICS_ENABLED") == "0"
        calls.append(path)
        return types.SimpleNamespace(speaker_diarization=Annotation()) if modern else Annotation()

    class Pipeline:
        if modern:
            @staticmethod
            def from_pretrained(model, *, token):
                assert model == "pyannote/speaker-diarization-community-1"
                assert token == "test-token"
                return infer
        else:
            @staticmethod
            def from_pretrained(model, *, use_auth_token):
                assert model == "pyannote/speaker-diarization-3.1"
                assert use_auth_token == "test-token"
                return infer

    package = types.ModuleType("pyannote")
    module = types.ModuleType("pyannote.audio")
    module.Pipeline = Pipeline
    monkeypatch.setitem(sys.modules, "pyannote", package)
    monkeypatch.setitem(sys.modules, "pyannote.audio", module)
    segments = [{"start": 0, "end": 1}, {"start": 3, "end": 4}]
    result = enrichment.diarize_segments(source, segments, "test-token")
    assert [item["speaker"] for item in result] == ["SPEAKER_07", None]
    assert calls == [str(source)]
    assert "speaker" not in segments[0]


def test_diarization_missing_token_and_package_are_actionable(enrichment, monkeypatch, tmp_path):
    source = write_wav(tmp_path / "lecture.wav")
    segments = [{"start": 0, "end": 1}]
    with pytest.raises(RuntimeError, match="(?i)Hugging Face.*token"):
        enrichment.diarize_segments(source, segments, "  ")
    monkeypatch.setitem(sys.modules, "pyannote.audio", None)
    with pytest.raises(RuntimeError, match="(?i)(speakers|pyannote)"):
        enrichment.diarize_segments(source, segments, "test-token")


def test_diarization_invalid_file_fails_before_loading_models(enrichment, tmp_path):
    with pytest.raises(RuntimeError, match="(?i)(not found|does not exist)"):
        enrichment.diarize_segments(tmp_path / "missing.wav", [{"start": 0, "end": 1}], "token")


@pytest.mark.parametrize("denied", [False, True])
def test_diarization_failure_is_actionable_and_redacts_token(enrichment, monkeypatch, tmp_path, denied):
    source = write_wav(tmp_path / "lecture.wav")

    class Pipeline:
        @staticmethod
        def from_pretrained(model, *, token):
            if denied:
                return
            raise RuntimeError(f"Provider exception containing {token}")

    module = types.ModuleType("pyannote.audio")
    module.Pipeline = Pipeline
    monkeypatch.setitem(sys.modules, "pyannote", types.ModuleType("pyannote"))
    monkeypatch.setitem(sys.modules, "pyannote.audio", module)
    with pytest.raises(RuntimeError, match="(?i)accept.*model conditions") as error:
        enrichment.diarize_segments(source, [{"start": 0, "end": 1}], "private-test-token")
    assert "private-test-token" not in str(error.value)
    assert error.value.__suppress_context__


def test_empty_transcript_does_not_require_diarization_backend(enrichment, monkeypatch, tmp_path):
    source = write_wav(tmp_path / "lecture.wav")
    monkeypatch.setitem(sys.modules, "pyannote.audio", None)
    assert enrichment.diarize_segments(source, [], "") == []


def test_wav_assembly_preserves_input_sequence_and_samples(enrichment, tmp_path):
    first = write_wav(tmp_path / "10.wav", (1, 2, -3))
    second = write_wav(tmp_path / "2.wav", (200, -300))
    output = tmp_path / "joined.wav"
    enrichment.assemble_wav([first, second], output)
    with wave.open(str(output), "rb") as audio:
        assert (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()) == (
            1, 2, 16000, 5,
        )
        assert struct.unpack("<5h", audio.readframes(5)) == (1, 2, -3, 200, -300)


def test_wav_with_padded_metadata_chunk_is_valid(enrichment, tmp_path):
    source = write_wav(tmp_path / "source.wav", (21, 22, 23))
    raw = source.read_bytes()
    with_metadata = bytearray(raw[:12] + b"JUNK\x03\x00\x00\x00abc\x00" + raw[12:])
    struct.pack_into("<I", with_metadata, 4, len(with_metadata) - 8)
    source.write_bytes(with_metadata)
    output = tmp_path / "output.wav"
    enrichment.assemble_wav([source], output)
    with wave.open(str(output), "rb") as audio:
        assert struct.unpack("<3h", audio.readframes(3)) == (21, 22, 23)


@pytest.mark.parametrize("kind, match", [
    ("no_chunks", "(?i)(no.*chunks|at least one|empty)"),
    ("missing", "(?i)(not found|does not exist)"),
    ("garbage", "(?i)(invalid|WAV)"),
    ("empty_file", "(?i)(empty|WAV)"),
    ("empty_audio", "(?i)empty"),
    ("stereo", "(?i)(mono|PCM16)"),
    ("pcm8", "(?i)(PCM16|16.bit)"),
    ("pcm24", "(?i)(PCM16|16.bit)"),
    ("rate_mismatch", "(?i)(rate|format)"),
    ("zero_rate", "(?i)(rate|invalid)"),
    ("float_format", "(?i)(PCM|format|WAV)"),
    ("truncated", "(?i)(truncated|incomplete|invalid)"),
    ("partial_sample", "(?i)(sample|truncated|invalid)"),
])
def test_invalid_wav_preserves_destination_and_cleans_up(enrichment, tmp_path, kind, match):
    first = write_wav(tmp_path / "first.wav")
    bad = tmp_path / "bad.wav"
    output = tmp_path / "output.wav"
    output.write_bytes(b"existing output must survive")
    if kind == "garbage":
        bad.write_bytes(b"not an audio file")
    elif kind == "empty_file":
        bad.touch()
    elif kind == "empty_audio":
        write_wav(bad, ())
    elif kind == "stereo":
        write_wav(bad, (1, 2), channels=2)
    elif kind in ("pcm8", "pcm24"):
        write_wav(bad, width=1 if kind == "pcm8" else 3)
    elif kind == "rate_mismatch":
        write_wav(bad, rate=48000)
    elif kind in ("truncated", "partial_sample", "zero_rate", "float_format"):
        write_wav(bad)
        data = bytearray(bad.read_bytes())
        if kind == "truncated":
            data = data[:-2]
        elif kind == "partial_sample":
            struct.pack_into("<I", data, 40, 5)
            data = data[:-1]
            struct.pack_into("<I", data, 4, len(data) - 8)
        elif kind == "zero_rate":
            struct.pack_into("<I", data, 24, 0)
        else:
            struct.pack_into("<H", data, 20, 3)
        bad.write_bytes(data)
    before = set(tmp_path.iterdir())
    with pytest.raises((ValueError, RuntimeError), match=match):
        enrichment.assemble_wav([] if kind == "no_chunks" else [first, bad], output)
    assert output.read_bytes() == b"existing output must survive"
    assert set(tmp_path.iterdir()) == before


def test_wav_assembly_reads_bounded_blocks(enrichment, tmp_path, monkeypatch):
    source = write_wav(tmp_path / "large.wav", (123,) * 200_000)
    original = wave.Wave_read.readframes
    requests = []

    def bounded_read(audio, count):
        assert 0 < count <= 65_536
        requests.append(count)
        return original(audio, count)

    monkeypatch.setattr(wave.Wave_read, "readframes", bounded_read)
    output = tmp_path / "output.wav"
    enrichment.assemble_wav([source], output)
    assert len(requests) >= 4
    assert output.stat().st_size == source.stat().st_size


def test_wav_destination_cannot_replace_a_source(enrichment, tmp_path):
    source = write_wav(tmp_path / "source.wav")
    before = source.read_bytes()
    with pytest.raises((ValueError, RuntimeError), match="(?i)(destination|source)"):
        enrichment.assemble_wav([source], source)
    assert source.read_bytes() == before


@pytest.mark.parametrize("kind, match", [
    ("missing", "(?i)(not found|does not exist)"),
    ("empty", "(?i)empty"),
    ("stereo", "(?i)mono"),
    ("truncated", "(?i)truncated"),
])
def test_invalid_first_wav_keeps_specific_error(enrichment, tmp_path, kind, match):
    source = tmp_path / "first.wav"
    if kind == "empty":
        write_wav(source, ())
    elif kind == "stereo":
        write_wav(source, (1, 2), channels=2)
    elif kind == "truncated":
        write_wav(source)
        source.write_bytes(source.read_bytes()[:-2])
    with pytest.raises((ValueError, RuntimeError), match=match):
        enrichment.assemble_wav([source], tmp_path / "output.wav")
    assert not (tmp_path / "output.wav").exists()
    assert not list(tmp_path.glob("*.tmp"))


def test_ocr_missing_backend_explains_local_setup(enrichment, monkeypatch, tmp_path):
    monkeypatch.setattr(enrichment.sys, "platform", "linux")
    monkeypatch.setattr(enrichment.shutil, "which", lambda name: None)
    source = tmp_path / "whiteboard.png"
    source.write_bytes(b"image")
    with pytest.raises(RuntimeError, match="(?i)(install.*Tesseract|Tesseract.*install)"):
        enrichment.extract_context(source)


@pytest.mark.parametrize("suffix", [".png", ".jpg", ".jpeg", ".webp", ".PNG"])
def test_image_ocr_uses_local_tesseract_stdout(enrichment, monkeypatch, tmp_path, suffix):
    monkeypatch.setattr(enrichment.sys, "platform", "linux")
    monkeypatch.setattr(enrichment.shutil, "which", lambda name: "/local/tesseract")
    source = tmp_path / ("whiteboard with spaces" + suffix)
    source.write_bytes(b"image passed to external inference boundary")

    def run(command, **options):
        assert command == ["/local/tesseract", str(source.resolve()), "stdout"]
        assert not options.get("shell", False)
        assert options["timeout"] > 0
        return subprocess.CompletedProcess(command, 0, " First line\nSecond line\n", "")

    monkeypatch.setattr(enrichment.subprocess, "run", run)
    assert enrichment.extract_context(source) == "First line\nSecond line"


def test_vision_failure_falls_back_to_tesseract(enrichment, monkeypatch, tmp_path):
    monkeypatch.setattr(enrichment.sys, "platform", "darwin")
    monkeypatch.setattr(enrichment.shutil, "which", lambda name: "/local/" + name)
    source = tmp_path / "whiteboard.png"
    source.write_bytes(b"image passed to external inference boundary")
    commands = []

    def run(command, **options):
        commands.append(command)
        if command[0] == "/local/swift":
            assert command[-1] == str(source.resolve())
            assert command[-2].endswith("ocr.swift")
            return subprocess.CompletedProcess(command, 1, "", "Vision is unavailable")
        assert command == ["/local/tesseract", str(source.resolve()), "stdout"]
        return subprocess.CompletedProcess(command, 0, "Recovered text", "")

    monkeypatch.setattr(enrichment.subprocess, "run", run)
    assert enrichment.extract_context(source) == "Recovered text"
    assert len(commands) == 2


@pytest.mark.parametrize("kind, match", [
    ("timeout", "(?i)timed out"),
    ("invalid", "(?i)(could not read|invalid)"),
    ("empty", "(?i)no readable text"),
    ("missing_data", "(?i)language data"),
])
def test_ocr_errors_explain_recovery(enrichment, monkeypatch, tmp_path, kind, match):
    monkeypatch.setattr(enrichment.sys, "platform", "linux")
    monkeypatch.setattr(enrichment.shutil, "which", lambda name: "/local/tesseract")
    source = tmp_path / "whiteboard.png"
    source.write_bytes(b"image passed to external inference boundary")

    def run(command, **options):
        if kind == "timeout":
            raise subprocess.TimeoutExpired(command, options["timeout"])
        if kind == "empty":
            return subprocess.CompletedProcess(command, 0, "\n", "")
        return subprocess.CompletedProcess(command, 1, "", "invalid image" if kind == "invalid" else "no eng data")

    monkeypatch.setattr(enrichment.subprocess, "run", run)
    with pytest.raises(RuntimeError, match=match):
        enrichment.extract_context(source)


def test_capabilities_report_local_tools_without_inference(enrichment, monkeypatch):
    monkeypatch.setattr(enrichment.sys, "platform", "linux")
    monkeypatch.setattr(enrichment.shutil, "which", lambda name: None)
    monkeypatch.setattr(enrichment.importlib.util, "find_spec", lambda name: None)
    assert enrichment.capabilities() == {"ocr": False, "diarization": False}
    monkeypatch.setattr(enrichment.shutil, "which", lambda name: "/usr/bin/tesseract")
    monkeypatch.setattr(enrichment.importlib.util, "find_spec", lambda name: object())
    assert enrichment.capabilities() == {"ocr": True, "diarization": True}


def test_capabilities_do_not_run_swift_compiler(enrichment, monkeypatch):
    monkeypatch.setattr(enrichment.sys, "platform", "darwin")
    monkeypatch.setattr(enrichment.importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(
        enrichment.shutil, "which", lambda name: {"swift": "/usr/bin/swift", "xcrun": "/usr/bin/xcrun"}.get(name),
    )

    def run(command, **options):
        assert command == ["/usr/bin/xcrun", "--find", "swift"]
        return subprocess.CompletedProcess(command, 1, "", "Developer tools are not installed")

    monkeypatch.setattr(enrichment.subprocess, "run", run)
    assert enrichment.capabilities() == {"ocr": False, "diarization": False}

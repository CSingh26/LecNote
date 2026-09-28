import subprocess
import sys

import pytest


def test_cli_help_and_local_check_need_no_credentials(tmp_path):
    help_result = subprocess.run([sys.executable, "-m", "lecnote", "--help"], capture_output=True, text=True)
    assert help_result.returncode == 0
    assert "serve" in help_result.stdout
    result = subprocess.run(
        [sys.executable, "-m", "lecnote", "--data-dir", str(tmp_path), "check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "Whisper" in result.stdout
    assert "sk-" not in result.stdout


def test_cli_rejects_nonlocal_bind(tmp_path):
    result = subprocess.run(
        [sys.executable, "-m", "lecnote", "serve", "--host", "0.0.0.0"], capture_output=True, text=True
    )
    assert result.returncode != 0


def test_cli_local_only_processing_exports_transcript_without_api_key(tmp_path):
    from pathlib import Path

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "lecnote",
            "--data-dir",
            str(tmp_path),
            "process",
            str(Path(__file__).resolve().parent.parent / "examples/transcript.json"),
            "--transcribe-only",
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    exported = list(tmp_path.glob("lectures/*/exports/*.json"))
    assert len(exported) == 1
    assert "velocity squared" in exported[0].read_text()


@pytest.mark.parametrize(
    ("name", "content", "reason"),
    [
        ("bad.xyz", b"invalid", "Unsupported recording format"),
        ("empty.wav", b"", "File is empty"),
        ("bad.json", b'{"language":"en","duration":-1,"segments":[]}', "transcript.duration"),
    ],
)
def test_cli_reports_rejected_import_reason(tmp_path, name, content, reason):
    source = tmp_path / name
    source.write_bytes(content)
    result = subprocess.run(
        [sys.executable, "-m", "lecnote", "--data-dir", str(tmp_path / "library"),
         "process", str(source), "--transcribe-only"],
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 1
    assert reason in result.stderr
    assert "http://localhost" not in result.stderr

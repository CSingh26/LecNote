import importlib.util
import json
import os
import shutil
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from dotenv import load_dotenv


@dataclass
class Settings:
    data_dir: Path
    model: str = "gpt-5.4-mini"
    api_key: str = ""
    whisper_model: str = "base"
    chunk_minutes: float = 8
    parallel_requests: int = 4
    language: str = ""
    diarization: bool = False
    hf_token: str = ""
    input_price_per_million: float = 0
    output_price_per_million: float = 0
    optimize_recordings: bool = True

    def __post_init__(self):
        self.data_dir = Path(self.data_dir).expanduser().resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    def load(cls, data_dir: Path | None = None):
        load_dotenv()
        root = Path(data_dir or os.getenv("LN_DATA_DIR", "data")).expanduser().resolve()
        values = {
            "model": os.getenv("LN_MODEL", "gpt-5.4-mini"),
            "api_key": os.getenv("OPENAI_API_KEY", ""),
            "whisper_model": os.getenv("LN_WHISPER_MODEL", "base"),
            "chunk_minutes": float(os.getenv("LN_CHUNK_MINUTES", "8")),
            "parallel_requests": int(os.getenv("LN_PARALLEL_REQUESTS", "4")),
            "hf_token": os.getenv("HF_TOKEN", ""),
        }
        path = root / "settings.json"
        if path.exists():
            saved = json.loads(path.read_text())
            allowed = {f.name for f in fields(cls)} - {"data_dir"}
            values.update({k: v for k, v in saved.items() if k in allowed})
        return cls(data_dir=root, **values)

    def lecture_dir(self, lecture_id: str) -> Path:
        path = (self.data_dir / "lectures" / lecture_id).resolve()
        if path.parent != (self.data_dir / "lectures").resolve():
            raise ValueError("Invalid lecture identifier")
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save(self):
        values = asdict(self)
        values.pop("data_dir")
        path = self.data_dir / "settings.json"
        temporary = path.with_suffix(".tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(values, handle, indent=2)
        temporary.replace(path)
        path.chmod(0o600)

    def public(self):
        from .enrichment import capabilities

        values = asdict(self)
        for key in ("data_dir", "api_key", "hf_token"):
            values.pop(key)
        values.update(
            api_key_configured=bool(self.api_key),
            hf_token_configured=bool(self.hf_token),
            capabilities={
                "whisper": importlib.util.find_spec("faster_whisper") is not None,
                "ffmpeg": shutil.which("ffmpeg") is not None,
                **capabilities(),
            },
        )
        return values

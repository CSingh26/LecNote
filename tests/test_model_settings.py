import json

from lecnote.config import Settings


def test_new_default_does_not_override_saved_model(tmp_path, monkeypatch):
    monkeypatch.delenv("LN_MODEL", raising=False)
    monkeypatch.setattr("lecnote.config.load_dotenv", lambda: None)
    assert Settings.load(tmp_path).model == "gpt-5.4-mini"
    (tmp_path / "settings.json").write_text(json.dumps({"model": "my-custom-model"}))
    assert Settings.load(tmp_path).model == "my-custom-model"

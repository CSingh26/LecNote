import json

import pytest
from test_notes import chunk_data, overview_data


def lecture_data():
    return {
        "id": "lecture",
        "title": "Motion <script>alert('title')</script>",
        "notes": overview_data()
        | {
            "chunks": [chunk_data()],
            "usage": {"input_tokens": 200, "output_tokens": 80},
            "model": "gpt-4.1-mini",
        },
        "transcript": {
            "language": "en",
            "duration": 480,
            "segments": [
                {
                    "id": 0,
                    "start": 0,
                    "end": 480,
                    "text": "Velocity <img src=x onerror=alert(1)>",
                    "speaker": "Teacher",
                }
            ],
        },
        "user_notes": "Remember units <script>alert('notes')</script>",
    }


@pytest.mark.parametrize("format", ["md", "html", "pdf", "json"])
def test_all_exports_include_study_material_transcript_and_user_notes(tmp_path, format):
    from lecnote.exports import export_notes

    path = export_notes(lecture_data(), format, tmp_path)
    assert path.is_file()
    assert path.suffix == f".{format}"
    if format == "pdf":
        from pypdf import PdfReader

        content = "\n".join(page.extract_text() for page in PdfReader(path).pages)
    else:
        content = path.read_text()
    for text in ["Remember units", "Velocity", "moving cart", "Find the speed", "Rate of position"]:
        assert text in content
    if format in ("md", "html", "pdf"):
        assert "Supplementary practice" in content
    if format == "json":
        payload = json.loads(content)
        assert payload["user_notes"] == lecture_data()["user_notes"]
        assert payload["transcript"]["segments"][0]["start"] == 0


def test_html_and_markdown_escape_untrusted_content_and_use_no_remote_resources(tmp_path):
    from lecnote.exports import export_notes

    for format in ("html", "md"):
        content = export_notes(lecture_data(), format, tmp_path).read_text()
        assert "<script>alert" not in content
        assert "<img src=x" not in content
        assert "&lt;script&gt;" in content
        assert "https://cdn" not in content


def test_plot_and_math_embed_in_standalone_html_and_pdf(tmp_path):
    from lecnote.exports import export_notes

    lecture = lecture_data()
    lecture["notes"]["chunks"][0]["visual"] = {
        "kind": "plot",
        "title": "Position over time",
        "mermaid": None,
        "x": [0, 1, 2],
        "y": [0, 2, 4],
        "x_label": "Time (s)",
        "y_label": "Position (m)",
        "image": None,
    }
    content = export_notes(lecture, "html", tmp_path).read_text()
    assert "data:image/png;base64," in content
    assert 'class="formula"' in content
    assert "Position over time" in content
    from pypdf import PdfReader

    document = PdfReader(export_notes(lecture, "pdf", tmp_path))
    assert sum(len(page.images) for page in document.pages) >= 2


def test_export_never_reads_arbitrary_image_paths(tmp_path):
    from lecnote.exports import export_notes

    lecture = lecture_data()
    secret = tmp_path / "private.txt"
    secret.write_text("PRIVATE-DATA-NEVER-EMBED")
    lecture["notes"]["chunks"][0]["visual"] = {
        "kind": "mermaid",
        "title": "Concepts",
        "mermaid": "graph TD\nA[Position] --> B[Velocity]",
        "x": [],
        "y": [],
        "x_label": "",
        "y_label": "",
        "image": str(secret),
    }
    content = export_notes(lecture, "html", tmp_path).read_text()
    assert str(secret) not in content
    assert "PRIVATE-DATA-NEVER-EMBED" not in content
    assert "Concepts" in content


def test_export_rejects_unknown_format_and_does_not_leak_internal_lecture_fields(tmp_path):
    from lecnote.exports import export_notes

    lecture = lecture_data() | {"media_path": "/private/recording.wav", "api_key": "secret"}
    with pytest.raises(ValueError, match="format"):
        export_notes(lecture, "../../escape", tmp_path)
    payload = json.loads(export_notes(lecture, "json", tmp_path).read_text())
    assert "api_key" not in payload
    assert "media_path" not in payload


def test_json_exports_imported_transcript_before_notes_exist(tmp_path):
    from lecnote.exports import export_notes

    lecture = lecture_data() | {"notes": None}
    payload = json.loads(export_notes(lecture, "json", tmp_path).read_text())
    assert payload["notes"] is None
    assert payload["transcript"] == lecture["transcript"]


def test_safe_flowchart_has_local_raster_and_no_bundle_fallback_is_readable(tmp_path, monkeypatch):
    from lecnote import exports

    lecture = lecture_data()
    lecture["notes"]["chunks"][0]["visual"] = {
        "kind": "mermaid",
        "title": "Relationships",
        "mermaid": "graph TD\nA[Position] --> B[Velocity]",
        "x": [],
        "y": [],
        "x_label": "",
        "y_label": "",
        "image": None,
    }
    monkeypatch.setattr(exports, "_mermaid_bundle", lambda: None)
    content = exports.export_notes(lecture, "html", tmp_path).read_text()
    assert 'class="diagram-fallback" src="data:image/png;base64,' in content
    assert "Position" in content
    assert "<script" not in content
    from pypdf import PdfReader

    reader = PdfReader(exports.export_notes(lecture, "pdf", tmp_path))
    assert sum(len(page.images) for page in reader.pages) >= 2


def test_unsupported_math_stays_readable_without_executing_tex(tmp_path):
    from lecnote.exports import export_notes, formula_png

    latex = r"\input{/etc/passwd}"
    assert formula_png(latex) is None
    lecture = lecture_data()
    lecture["notes"]["chunks"][0]["formulas"][0]["latex"] = latex
    content = export_notes(lecture, "html", tmp_path).read_text()
    assert latex in content


def test_visual_rendering_does_not_swallow_cancellation(tmp_path, monkeypatch):
    from lecnote import exports
    from lecnote.schemas import Notes, PipelineCancelled

    notes = lecture_data()["notes"]
    notes["chunks"][0]["visual"] = {
        "kind": "plot",
        "title": "Motion",
        "mermaid": None,
        "x": [0, 1],
        "y": [0, 2],
        "x_label": "Time",
        "y_label": "Position",
        "image": None,
    }

    def cancel(*args):
        raise PipelineCancelled("cancelled")

    monkeypatch.setattr(exports, "visual_png", cancel)
    with pytest.raises(PipelineCancelled):
        exports.render_visual_assets(Notes.model_validate(notes), tmp_path, "lecture")


@pytest.mark.parametrize("latex", ["x < y", r"\begin{matrix}a & b \\ c & d\end{matrix}"])
def test_markdown_preserves_tex_relations_and_matrix_alignment(tmp_path, latex):
    from lecnote.exports import export_notes

    lecture = lecture_data()
    lecture["notes"]["chunks"][0]["formulas"][0]["latex"] = latex
    content = export_notes(lecture, "md", tmp_path).read_text()
    assert "$$\n" + latex + "\n$$" in content
    assert "&lt;" not in content.split("$$")[1]
    assert "&amp;" not in content.split("$$")[1]


def test_markdown_math_cannot_inject_delimiters_or_raw_html(tmp_path):
    from lecnote.exports import export_notes

    lecture = lecture_data()
    lecture["notes"]["chunks"][0]["formulas"][0]["latex"] = 'x\n$$\n<script>alert("math")</script>\n$$'
    content = export_notes(lecture, "md", tmp_path).read_text()
    assert "<script>" not in content
    assert "$$" not in content
    assert "&lt;script&gt;" in content


def test_pdf_cjk_text_has_unicode_font_and_remains_extractable(tmp_path):
    from pypdf import PdfReader

    from lecnote.exports import export_notes

    lecture = lecture_data()
    lecture["title"] = "中文课堂笔记"
    lecture["notes"]["overview"] = "速度表示位置随时间的变化。"
    lecture["user_notes"] = "注意单位。"
    reader = PdfReader(export_notes(lecture, "pdf", tmp_path))
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert "中文课堂笔记" in text
    assert "速度表示位置随时间的变化。" in text
    assert "注意单位。" in text
    assert "\x00" not in text
    fonts = [
        str(font.get_object().get("/BaseFont"))
        for page in reader.pages
        for font in page["/Resources"]["/Font"].values()
    ]
    assert "/STSong-Light" in fonts

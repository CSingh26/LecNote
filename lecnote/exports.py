"""Offline study exports. All untrusted prose is escaped; visuals are local."""

import base64
import hashlib
import html
import io
import json
import os
import re
import secrets
import tempfile
import textwrap
from pathlib import Path
from threading import RLock

from .schemas import Notes, PipelineCancelled, Visual

_render_lock = RLock()


def _atomic_bytes(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as stream:
            name = stream.name
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if name:
            Path(name).unlink(missing_ok=True)


def _png(figure):
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    buffer = io.BytesIO()
    FigureCanvasAgg(figure)
    figure.savefig(buffer, format="png", dpi=160, bbox_inches="tight", facecolor="white")
    figure.clear()
    return buffer.getvalue()


def _plot_png(visual: Visual) -> bytes:
    from matplotlib import rc_context
    from matplotlib.figure import Figure

    with _render_lock, rc_context({"text.usetex": False, "text.parse_math": False}):
        figure = Figure(figsize=(7, 4), layout="constrained")
        axes = figure.subplots()
        axes.plot(visual.x, visual.y, color="#24634b", marker="o", markersize=3, linewidth=1.8)
        axes.set_title(textwrap.fill(visual.title, 65), fontsize=12, pad=14)
        axes.set_xlabel(textwrap.fill(visual.x_label, 70))
        axes.set_ylabel(textwrap.fill(visual.y_label, 45))
        axes.grid(True, color="#e0e4e1", linewidth=0.6)
        axes.spines[["top", "right"]].set_visible(False)
        return _png(figure)


def _flowchart_png(visual: Visual) -> bytes | None:
    """Rasterize a small plain flowchart; other Mermaid types retain source.

    This intentionally recognizes only node declarations and directed edges.
    Browser exports can additionally render full Mermaid with the local bundle.
    """
    source = visual.mermaid or ""
    header = re.match(r"\s*(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)\b", source)
    if header is None:
        return None
    node = r"([A-Za-z_][\w-]*)(?:\[([^\]\n]{1,250})\]|\(([^)\n]{1,250})\)|\{([^}\n]{1,250})\})?"
    edge = re.compile(rf"\s*{node}\s*(-->|==>|-\.->)\s*(?:\|([^|\n]{{1,100}})\|\s*)?{node}\s*")
    declaration = re.compile(rf"\s*{node}\s*")
    labels, edges = {}, []

    def remember(groups):
        name, *label = groups
        value = next((item for item in label if item), None)
        labels[name] = value.strip('"') if value else labels.get(name, name)
        return name

    for line in re.split(r"[;\n]+", source[header.end() :]):
        if not line.strip() or line.strip().startswith("%%"):
            continue
        match = edge.fullmatch(line)
        if match:
            groups = match.groups()
            left = remember(groups[:4])
            right = remember(groups[6:10])
            edges.append((left, right, groups[5] or ""))
        else:
            match = declaration.fullmatch(line)
            if not match:
                return None
            remember(match.groups())
    if not labels or len(labels) > 20 or len(edges) > 40 or any(len(label) > 90 for label in labels.values()):
        return None
    from matplotlib import rc_context
    from matplotlib.figure import Figure
    from matplotlib.patches import FancyArrowPatch

    with _render_lock, rc_context({"text.usetex": False, "text.parse_math": False}):
        figure = Figure(figsize=(7, max(2.6, len(labels) * 1.0)), layout="constrained")
        axes = figure.subplots()
        axes.axis("off")
        axes.set_xlim(-1, 1)
        axes.set_ylim(-0.8, len(labels) - 0.2)
        positions = {name: (0, len(labels) - 1 - index) for index, name in enumerate(labels)}
        axes.set_title(textwrap.fill(visual.title, 60), fontsize=12, pad=15)
        for name, label in labels.items():
            x, y = positions[name]
            axes.text(
                x,
                y,
                textwrap.fill(label, 46),
                ha="center",
                va="center",
                fontsize=10,
                bbox={
                    "boxstyle": "round,pad=0.55,rounding_size=0.1",
                    "facecolor": "#f2f7f3",
                    "edgecolor": "#41745d",
                },
                zorder=3,
            )
        order = list(labels)
        for left, right, label in edges:
            a, b = positions[left], positions[right]
            adjacent = abs(order.index(left) - order.index(right)) == 1
            curve = 0 if adjacent else 0.45
            arrow = FancyArrowPatch(
                a,
                b,
                arrowstyle="-|>",
                mutation_scale=12,
                shrinkA=15,
                shrinkB=18,
                connectionstyle=f"arc3,rad={curve}",
                color="#64736c",
                zorder=1,
            )
            axes.add_patch(arrow)
            if label:
                axes.text(0.23 if adjacent else 0.55, (a[1] + b[1]) / 2, textwrap.fill(label, 20), fontsize=8)
        return _png(figure)


def visual_png(visual: dict | Visual) -> bytes | None:
    if not isinstance(visual, Visual):
        visual = Visual.model_validate(visual)
    return _plot_png(visual) if visual.kind == "plot" else _flowchart_png(visual)


def formula_png(latex: str) -> bytes | None:
    """Use Matplotlib's internal math parser, never shell out to TeX."""
    if not latex or len(latex) > 1000:
        return None
    from matplotlib import rc_context
    from matplotlib.font_manager import FontProperties
    from matplotlib.mathtext import math_to_image

    expression = latex.strip().removeprefix("$$").removesuffix("$$").strip().strip("$")
    try:
        with _render_lock, rc_context({"text.usetex": False}):
            buffer = io.BytesIO()
            math_to_image(
                f"${expression}$",
                buffer,
                prop=FontProperties(size=16),
                dpi=180,
                format="png",
                color="#202823",
            )
            return buffer.getvalue()
    except (ValueError, RuntimeError, OverflowError):
        return None


def render_visual_assets(notes: Notes, destination: Path, lecture_id: str, check=lambda: None):
    for chunk in notes.chunks:
        check()
        if chunk.visual is None:
            continue
        specification = chunk.visual.model_dump(exclude={"image"})
        key = hashlib.sha256(json.dumps(specification, sort_keys=True).encode()).hexdigest()[:24]
        name = f"visual-{key}.png"
        path = destination / name
        if not path.is_file():
            try:
                data = visual_png(chunk.visual)
                if data is None:
                    continue
                _atomic_bytes(path, data)
            except PipelineCancelled:
                raise
            except (ImportError, OSError, RuntimeError, ValueError, OverflowError):
                # Visuals are optional; the validated source specification stays
                # available for browser rendering and a later export attempt.
                continue
        chunk.visual.image = f"/api/lectures/{lecture_id}/assets/{name}"


def _timestamp(value):
    seconds = max(0, int(float(value)))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"


def _escape(value):
    return html.escape(str(value), quote=True)


def _markdown_text(value):
    value = html.escape(str(value), quote=False)
    # Prevent prose from introducing links, images, fences or Markdown blocks.
    value = re.sub(r"([\\`*_{}\[\]()#!|])", r"\\\1", value)
    return re.sub(r"(?m)^([\s]*)([-+]|\d+[.])(?=\s)", r"\1\\\2", value)


def _markdown_formula(latex: str) -> str:
    # TeX needs literal relational operators and alignment ampersands. Unsafe
    # delimiters/markup/macros become ordinary escaped prose, never a math block.
    if re.search(
        r"\$|</?[A-Za-z][^>]*>|<!--|<!DOCTYPE|"
        r"\\(?:href|url|html\w*|input|include\w*|write\w*|openout|read|def|newcommand|catcode)\b",
        latex,
        re.I,
    ):
        return "Formula (literal): " + _markdown_text(latex).replace("$", "&#36;")
    return "$$\n" + latex + "\n$$"


def _data_uri(data):
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _blocks(lecture):
    """A shared content stream prevents export formats from omitting sections."""
    notes = lecture.get("notes") or {}
    yield "title", lecture.get("title") or notes.get("title") or "Lecture notes"
    yield "heading", "Overview"
    yield "text", notes.get("overview", "")
    if notes.get("takeaways"):
        yield "heading", "Takeaways"
        for text in notes["takeaways"]:
            yield "bullet", text
    for chunk in notes.get("chunks", []):
        yield "heading", f"{_timestamp(chunk['start'])} - {_timestamp(chunk['end'])}  {chunk['title']}"
        yield "text", chunk.get("summary", "")
        for point in chunk.get("key_points", []):
            yield "bullet", f"[{_timestamp(point['timestamp'])}] {point['text']}"
        for definition in chunk.get("definitions", []):
            yield "text", f"{definition['term']}: {definition['definition']}"
        for formula in chunk.get("formulas", []):
            yield "formula", formula
        if chunk.get("examples"):
            yield "subheading", "Examples from the lecture"
            for example in chunk["examples"]:
                yield "bullet", example
        if chunk.get("emphasized_points"):
            yield "subheading", "Emphasized in the lecture"
            for point in chunk["emphasized_points"]:
                yield "bullet", point
        if chunk.get("practice"):
            yield "subheading", "Supplementary practice (generated)"
            for question in chunk["practice"]:
                yield "question", question
        if chunk.get("visual"):
            yield "visual", chunk["visual"]
    if notes.get("glossary"):
        yield "heading", "Glossary"
        for definition in notes["glossary"]:
            yield "text", f"{definition['term']}: {definition['definition']}"
    if notes.get("review_questions"):
        yield "heading", "Review questions"
        for question in notes["review_questions"]:
            yield "question", question
    yield "heading", "Your notes"
    yield "text", lecture.get("user_notes") or ""
    transcript = lecture.get("transcript") or {}
    if transcript.get("segments"):
        yield "heading", "Transcript"
        for segment in transcript["segments"]:
            speaker = f"{segment['speaker']}: " if segment.get("speaker") else ""
            yield "text", f"[{_timestamp(segment['start'])}] {speaker}{segment['text']}"
    if notes.get("usage"):
        usage = notes["usage"]
        yield "heading", "Generation details"
        yield (
            "text",
            (
                f"Model: {notes.get('model', '')}. Input tokens: {usage.get('input_tokens', 0)}. "
                f"Output tokens: {usage.get('output_tokens', 0)}. Includes cached completed stages; "
                "not a billing statement."
            ),
        )


def _markdown(lecture):
    lines = []
    for kind, value in _blocks(lecture):
        if kind in ("title", "heading", "subheading"):
            lines.append(
                {"title": "# ", "heading": "## ", "subheading": "### "}[kind] + _markdown_text(value)
            )
        elif kind == "bullet":
            lines.append("- " + _markdown_text(value))
        elif kind == "question":
            lines.extend(
                ["**Q:** " + _markdown_text(value["question"]), "**A:** " + _markdown_text(value["answer"])]
            )
        elif kind == "formula":
            lines.extend(
                [
                    _markdown_formula(value["latex"]),
                    _markdown_text(value["explanation"]),
                ]
            )
        elif kind == "visual":
            visual = Visual.model_validate(value)
            png = visual_png(visual)
            if png:
                lines.append(f"![{_markdown_text(visual.title)}]({_data_uri(png)})")
            if visual.mermaid:
                # An indented code block is inert even in Mermaid-aware viewers.
                lines.append(
                    "Diagram source:\n\n"
                    + "\n".join("    " + _escape(line) for line in visual.mermaid.splitlines())
                )
        else:
            lines.append(_markdown_text(value))
    return "\n\n".join(lines) + "\n"


def _mermaid_bundle():
    # Both installed packages and source checkouts can provide a local bundle.
    # Never download assets or use CDN imports during export.
    candidates = (
        Path(__file__).parent / "static" / "mermaid.min.js",
        Path(__file__).resolve().parents[1] / "web" / "node_modules" / "mermaid" / "dist" / "mermaid.min.js",
    )
    for path in candidates:
        if path.is_file() and path.stat().st_size <= 12_000_000:
            return path.read_text(encoding="utf-8")
    return None


def _html(lecture):
    parts, has_mermaid = [], False
    for kind, value in _blocks(lecture):
        if kind in ("title", "heading", "subheading"):
            tag = {"title": "h1", "heading": "h2", "subheading": "h3"}[kind]
            parts.append(f"<{tag}>{_escape(value)}</{tag}>")
        elif kind == "question":
            parts.append(
                f"<p><strong>Q:</strong> {_escape(value['question'])}<br><strong>A:</strong> {_escape(value['answer'])}</p>"
            )
        elif kind == "formula":
            png = formula_png(value["latex"])
            if png:
                parts.append(
                    f'<figure class="formula"><img src="{_data_uri(png)}" alt="{_escape(value["latex"])}">'
                    f"<figcaption>{_escape(value['explanation'])}</figcaption></figure>"
                )
            else:
                parts.append(
                    f'<pre class="formula">{_escape(value["latex"])}</pre><p>{_escape(value["explanation"])}</p>'
                )
        elif kind == "visual":
            visual = Visual.model_validate(value)
            png = visual_png(visual)
            parts.append(f"<figure><figcaption>{_escape(visual.title)}</figcaption>")
            if visual.mermaid:
                has_mermaid = True
                parts.append(f'<pre class="mermaid">{_escape(visual.mermaid)}</pre>')
                if png:
                    parts.append(
                        f'<img class="diagram-fallback" src="{_data_uri(png)}" alt="{_escape(visual.title)}">'
                    )
            elif png:
                parts.append(f'<img src="{_data_uri(png)}" alt="{_escape(visual.title)}">')
            parts.append("</figure>")
        elif kind == "bullet":
            parts.append(f'<p class="bullet">&bull; {_escape(value)}</p>')
        else:
            parts.append(f"<p>{_escape(value)}</p>")
    nonce = secrets.token_urlsafe(24)
    scripts = ""
    bundle = _mermaid_bundle() if has_mermaid else None
    if bundle:
        bundle = re.sub(r"</script", r"<\\/script", bundle, flags=re.I)
        scripts = f'<script nonce="{nonce}">{bundle}</script>'
        scripts += f'''<script nonce="{nonce}">
mermaid.initialize({{startOnLoad:false,securityLevel:'strict',htmlLabels:false,maxTextSize:8000,maxEdges:60,
  flowchart:{{htmlLabels:false}},fontFamily:'Arial, sans-serif'}});
document.querySelectorAll('pre.mermaid').forEach(async (node) => {{
  try {{ await mermaid.run({{nodes:[node]}});
    const fallback = node.parentElement.querySelector('.diagram-fallback');
    if (fallback) fallback.remove();
  }} catch (_) {{ /* The escaped source and local raster remain available. */ }}
}});
</script>'''
    title = _escape(lecture.get("title") or "Lecture notes")
    policy = (
        f"default-src 'none'; img-src data:; style-src 'unsafe-inline'; "
        f"script-src 'nonce-{nonce}'; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
    )
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{policy}"><title>{title}</title>
<style>
body{{font:16px/1.6 system-ui,sans-serif;color:#202823;background:#fff;margin:0}}
main{{max-width:820px;margin:auto;padding:32px 24px}}h1{{font-size:30px;line-height:1.25}}
h2{{font-size:21px;margin-top:32px;border-bottom:1px solid #d8e1db;padding-bottom:8px}}
h3{{font-size:17px;margin-top:24px}}p{{white-space:pre-wrap;overflow-wrap:anywhere}}
.bullet{{padding-left:14px}}figure{{margin:24px 0;break-inside:avoid}}figcaption{{font-size:14px;color:#4c6254}}
img,svg{{max-width:100%;height:auto}}.formula img{{max-height:150px;width:auto}}
pre{{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f4f6f5}}
@media print{{main{{max-width:none;padding:0}}h2,h3{{break-after:avoid}}}}
</style></head><body><main>{"".join(parts)}</main>{scripts}</body></html>'''


def _pdf(lecture):
    from matplotlib import get_data_path
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer

    # Matplotlib already ships a Unicode font, so PDF needs no system font setup.
    font_dir = Path(get_data_path()) / "fonts" / "ttf"
    with _render_lock:
        for name in ("STSong-Light", "HeiseiMin-W3", "HYGothic-Medium"):
            if name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(UnicodeCIDFont(name))
        if "LecNoteSans" not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont("LecNoteSans", str(font_dir / "DejaVuSans.ttf")))
            pdfmetrics.registerFont(TTFont("LecNoteSans-Bold", str(font_dir / "DejaVuSans-Bold.ttf")))
            pdfmetrics.registerFontFamily(
                "LecNoteSans",
                normal="LecNoteSans",
                bold="LecNoteSans-Bold",
                italic="LecNoteSans",
                boldItalic="LecNoteSans-Bold",
            )
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=48,
        leftMargin=48,
        topMargin=48,
        bottomMargin=48,
        title=str(lecture.get("title") or "Lecture notes"),
        author="LecNote",
    )
    styles = getSampleStyleSheet()
    for style in styles.byName.values():
        style.fontName = "LecNoteSans"
    styles.add(
        ParagraphStyle(
            "LectureBody",
            fontName="LecNoteSans",
            fontSize=9.5,
            leading=15,
            spaceAfter=8,
            alignment=TA_LEFT,
            splitLongWords=True,
        )
    )
    styles["Title"].fontName = "LecNoteSans-Bold"
    styles["Title"].fontSize = 22
    styles["Title"].leading = 28
    for heading in ("Heading2", "Heading3"):
        styles[heading].fontName = "LecNoteSans-Bold"
        styles[heading].textColor = colors.HexColor("#24634b")
    story = []

    def paragraph(text, style="LectureBody"):
        text = str(text)
        if re.search(r"[\u3040-\u30ff]", text):
            cjk_font = "HeiseiMin-W3"
        elif re.search(r"[\u1100-\u11ff\uac00-\ud7af]", text):
            cjk_font = "HYGothic-Medium"
        else:
            cjk_font = "STSong-Light"
        # CID fonts cover CJK runs; the embedded Unicode font retains Latin,
        # Greek and other supported scripts without replacing missing glyphs.
        pieces = []
        end = 0
        for match in re.finditer(
            r"[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]+", text
        ):
            pieces.append(_escape(text[end : match.start()]))
            pieces.append(f'<font name="{cjk_font}">{_escape(match.group())}</font>')
            end = match.end()
        pieces.append(_escape(text[end:]))
        escaped = "".join(pieces).replace("\n", "<br/>")
        story.append(Paragraph(escaped or " ", styles[style]))

    def picture(data, max_height=410, natural=False):
        width, height = ImageReader(io.BytesIO(data)).getSize()
        scale = min(document.width / width, max_height / height, 0.48 if natural else 1)
        graphic = Image(io.BytesIO(data), width=width * scale, height=height * scale)
        graphic.hAlign = "LEFT"
        story.extend([graphic, Spacer(1, 8)])

    for kind, value in _blocks(lecture):
        if kind in ("title", "heading", "subheading"):
            paragraph(value, {"title": "Title", "heading": "Heading2", "subheading": "Heading3"}[kind])
        elif kind == "question":
            paragraph("Q: " + value["question"])
            paragraph("A: " + value["answer"])
        elif kind == "bullet":
            paragraph("- " + value)
        elif kind == "formula":
            png = formula_png(value["latex"])
            if png:
                picture(png, max_height=100, natural=True)
            else:
                paragraph(value["latex"])
            paragraph(value["explanation"])
        elif kind == "visual":
            visual = Visual.model_validate(value)
            png = visual_png(visual)
            if png:
                picture(png)
            elif visual.mermaid:
                paragraph(visual.title, "Heading3")
                paragraph("Diagram source (Mermaid):\n" + visual.mermaid)
        else:
            # Small paragraphs keep long freeform user notes splittable across pages.
            for line in str(value).split("\n"):
                paragraph(line)

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("LecNoteSans", 8)
        canvas.setFillColor(colors.HexColor("#617067"))
        canvas.drawRightString(A4[0] - 48, 25, f"LecNote  |  {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def export_notes(lecture: dict, format: str, output_dir: Path) -> Path:
    if format not in {"md", "html", "pdf", "json"}:
        raise ValueError("Unsupported export format; use md, html, pdf or json")
    if not lecture.get("notes") and format != "json":
        raise ValueError("Generate lecture notes before exporting")
    # Copy only the documented public artifact fields, not paths or credentials.
    safe = {key: lecture.get(key) for key in ("id", "title", "notes", "transcript", "user_notes")}
    if format == "json":
        # Embed visual bytes even though the app's asset URL will not exist offline.
        safe = json.loads(json.dumps(safe, ensure_ascii=False, allow_nan=False))
        for chunk in (safe["notes"] or {}).get("chunks", []):
            if chunk.get("visual"):
                png = visual_png(chunk["visual"])
                chunk["visual"]["image"] = _data_uri(png) if png else None
        data = json.dumps(safe, ensure_ascii=False, allow_nan=False, indent=2).encode("utf-8")
    elif format == "md":
        data = _markdown(safe).encode("utf-8")
    elif format == "html":
        data = _html(safe).encode("utf-8")
    else:
        data = _pdf(safe)
    stem = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(lecture.get("id") or "lecture")).strip("-")[:80] or "lecture"
    path = Path(output_dir) / f"{stem}-notes.{format}"
    _atomic_bytes(path, data)
    return path

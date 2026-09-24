"""Bound supporting material per request without modifying the saved sources."""

import math
import re
import textwrap

from .schemas import MAX_CONTEXT_CHARACTERS

STOP_WORDS = set("a an and are as at be by for from in is it of on or that the this to was we with you".split())


def terms(text):
    return {word for word in re.findall(r"\w+", text.casefold()) if len(word) > 1} - STOP_WORDS


class SupportingContext:
    def __init__(self, lecture):
        self.title = f"Lecture title: {lecture.get('title', '')}"
        self.sources = []
        pieces = [self.title]
        for key in ("course_context", "context", "vocabulary"):
            value = lecture.get(key) or ""
            if not isinstance(value, str):
                raise ValueError(f"{key} must be text")
            if value:
                self.sources.append((key, value))
                pieces.append(f"{key}:\n{value}")
        for index, attachment in enumerate(lecture.get("attachments") or []):
            value = attachment.get("text") or ""
            if not isinstance(value, str):
                raise ValueError("Attachment context must be extracted text")
            if value:
                label = str(attachment.get("name") or f"Material {index + 1}")[:200]
                self.sources.append((label, value))
                pieces.append("Supporting attachment text:\n" + value)
        self.full = "\n\n".join(pieces)
        self.limited = len(self.full) > MAX_CONTEXT_CHARACTERS
        self.passages = []
        if self.limited:
            for source, (label, value) in enumerate(self.sources):
                for index, passage in enumerate(textwrap.wrap(
                    value, width=1600, replace_whitespace=False, break_on_hyphens=False,
                )):
                    self.passages.append((source, index, label, passage, terms(passage)))

    def select(self, query=""):
        if not self.limited:
            return self.full
        query_terms = terms(query)
        ranked = sorted(self.passages, key=lambda item: (
            -len(query_terms & item[4]) / math.sqrt(max(1, len(item[4]))), item[0], item[1],
        ))
        result = self.title + "\n\nSelected supporting excerpts; some material is omitted from this request."
        included = set()

        def append(item):
            nonlocal result
            source, index, label, passage, _ = item
            key = (source, index)
            excerpt = f"\n\n{label} (excerpt {index + 1}):\n{passage}"
            if key not in included and len(result) + len(excerpt) <= MAX_CONTEXT_CHARACTERS:
                result += excerpt
                included.add(key)

        # Retain brief user context/vocabulary, then represent each source before
        # spending the remaining budget on passages matching this lecture chunk.
        for item in ranked:
            if self.sources[item[0]][0] in {"context", "course_context", "vocabulary"} and len(
                self.sources[item[0]][1]
            ) <= 1600:
                append(item)
        represented = {source for source, _ in included}
        for item in ranked:
            if item[0] not in represented:
                append(item)
                represented.add(item[0])
        for item in ranked:
            append(item)
        return result

import copy

import pytest

from lecnote.context import SupportingContext


def test_small_context_is_kept_in_full():
    lecture = {"title": "Accounting", "context": "Inventory methods", "vocabulary": "LIFO, FIFO",
               "attachments": [{"name": "Slides.pdf", "text": "Complete slide text"}]}
    context = SupportingContext(lecture).select()
    for text in ("Accounting", "Inventory methods", "LIFO, FIFO", "Complete slide text"):
        assert text in context


def test_oversized_materials_use_relevant_excerpts_without_changing_sources():
    lecture = {
        "title": "ACC502", "vocabulary": "LIFO, FIFO",
        "attachments": [
            {"name": "Inventory.pdf", "text": "Inventory methods. " * 1500},
            {"name": "Assets.pdf", "text": "Background administration. " * 1500
             + "\nDepreciation allocates the depreciable asset cost over its useful life.\n"},
        ],
    }
    original = copy.deepcopy(lecture)
    context = SupportingContext(lecture).select("depreciation asset cost useful life")
    assert len(context) <= 24_000
    assert "Depreciation allocates" in context
    assert "Inventory methods" in context
    assert "LIFO, FIFO" in context
    assert "Inventory.pdf" in context and "Assets.pdf" in context
    assert "excerpts" in context.lower()
    assert lecture == original
    assert SupportingContext(lecture).select("depreciation asset cost useful life") == context


def test_large_manual_context_and_unicode_fit_the_request_budget():
    lecture = {"title": "Accounting", "context": "财务报告 " * 20000,
               "course_context": "Income statements. " * 9000,
               "vocabulary": "Financial accounting. " * 3000}
    context = SupportingContext(lecture).select("财务报告 income statements")
    assert 0 < len(context) <= 24_000
    assert "财务报告" in context and "Income statements" in context


@pytest.mark.parametrize("source", ["context", "course_context", "vocabulary", "attachment"])
def test_non_text_context_is_still_rejected(source):
    lecture = {"title": "Accounting", source: ["invalid"]}
    if source == "attachment":
        lecture["attachments"] = [{"text": ["invalid"]}]
    with pytest.raises(ValueError, match="text"):
        SupportingContext(lecture)

"""Isolated UI verification server with a deterministic inference boundary."""

import os
from pathlib import Path

import uvicorn

from lecnote.api import create_app
from lecnote.config import Settings


def fixture_pipeline(lecture, settings, progress, cancelled):
    progress("generating", 70, "Creating verification notes")
    transcript = lecture["transcript"]
    segment = transcript["segments"][0]
    return {
        "transcript": transcript,
        "notes": {
            "title": lecture["title"],
            "overview": "Kinetic energy describes the energy of motion.",
            "takeaways": ["Doubling speed quadruples kinetic energy."],
            "glossary": [{"term": "Kinetic energy", "definition": "Energy of motion."}],
            "review_questions": [
                {"question": "What happens when speed doubles?", "answer": "Energy quadruples."}
            ],
            "chunks": [
                {
                    "index": 0,
                    "start": segment["start"],
                    "end": transcript["duration"],
                    "title": "Energy of motion",
                    "summary": "Mass and speed determine kinetic energy.",
                    "key_points": [
                        {"text": "Kinetic energy depends on speed squared.", "timestamp": segment["start"]}
                    ],
                    "definitions": [{"term": "Joule", "definition": "A unit of energy."}],
                    "formulas": [
                        {"latex": "E_k = \\frac{1}{2}mv^2", "explanation": "Kinetic energy formula."}
                    ],
                    "examples": ["A 2 kg object at 3 m/s has 9 J of kinetic energy."],
                    "emphasized_points": ["Remember the squared speed."],
                    "practice": [{"question": "Calculate energy for 1 kg at 2 m/s.", "answer": "2 J."}],
                    "visual": {
                        "kind": "mermaid",
                        "title": "Relationships",
                        "mermaid": "graph LR\nA[Mass] --> B[Energy]\nC[Speed squared] --> B",
                        "x": [],
                        "y": [],
                        "x_label": "",
                        "y_label": "",
                        "image": None,
                    },
                }
            ],
            "usage": {"input_tokens": 200, "output_tokens": 100},
            "model": "test-fixture",
        },
    }


if __name__ == "__main__":
    settings = Settings(data_dir=Path(os.environ["LECNOTE_TEST_DATA"]), api_key="test-fixture")
    app = create_app(settings)
    app.state.jobs.pipeline = fixture_pipeline
    uvicorn.run(app, host="127.0.0.1", port=8766)

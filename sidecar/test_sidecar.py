import time
from typing import List, Dict, Any, Optional
import pytest
from fastapi.testclient import TestClient

from app import app
from schemas import (
    ExtractRequest,
    ExtractResponse,
    HealthResponse,
    LABELS,
    MAX_TEXT_CHARS,
)
from runtime import predict_windowed, calculate_iou


class MockGlinerModel:
    """Mock GLiNER model for deterministic unit tests without loading neural weights."""

    def __init__(self, mock_responses: Optional[Dict[str, List[Dict[str, Any]]]] = None):
        self.mock_responses = mock_responses or {}
        self.call_count = 0

    def predict_entities(self, text: str, labels: List[str], threshold: float = 0.40):
        self.call_count += 1
        results = []

        # Return EVERY occurrence of each keyword (not just the first) so
        # long-document tests can reason about full-window coverage.
        for needle, label, score in [
            ("Rahul Kumar", "person", 0.94),
            ("ABC Technologies", "organization", 0.91),
            ("Bengaluru", "location", 0.88),
        ]:
            search_from = 0
            while True:
                start = text.find(needle, search_from)
                if start < 0:
                    break
                results.append({
                    "label": label,
                    "text": needle,
                    "start": start,
                    "end": start + len(needle),
                    "score": score,
                })
                search_from = start + len(needle)

        return results


@pytest.fixture
def client(monkeypatch):
    # Patch the model loader so lifespan injects the mock directly: the real
    # GLiNER.from_pretrained (weights download + load) is never invoked, with
    # or without gliner/torch installed in the test environment.
    monkeypatch.setattr(
        "app.load_gliner_model", lambda model_id: (MockGlinerModel(), "cpu")
    )
    with TestClient(app) as test_client:
        yield test_client
    app.state.model = None


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["model"] == "gliner_small-v2.1"
    assert data["ready"] is True


def test_extract_mock_prediction(client):
    payload = {
        "text": "Rahul Kumar works at ABC Technologies in Bengaluru.",
        "threshold": 0.40,
    }
    response = client.post("/extract", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "entities" in data
    entities = data["entities"]
    assert len(entities) == 3

    labels = {e["label"] for e in entities}
    assert labels == {"person", "organization", "location"}

    # Verify slice invariant on extracted entities
    raw_text = payload["text"]
    for ent in entities:
        assert raw_text[ent["start"]:ent["end"]] == ent["text"]


def test_text_truncation(client):
    long_text = "Rahul Kumar " * 2500  # > 20,000 chars
    assert len(long_text) > MAX_TEXT_CHARS

    response = client.post("/extract", json={"text": long_text})
    assert response.status_code == 200
    data = response.json()
    assert data["textTruncated"] is True


def test_tail_fully_scanned_and_not_partial(client):
    """Regression: the window cap must cover the whole 20k cap, and the response
    must not claim partial when the tail was actually scanned."""
    long_text = "Rahul Kumar " * 2500  # truncated to 20,000 chars server-side
    response = client.post("/extract", json={"text": long_text})
    assert response.status_code == 200
    data = response.json()
    assert data["partial"] is False

    # With full coverage, entities must be found deep into the truncated tail.
    # 20,000 chars / 12 per occurrence ≈ 1,666 occurrences; the old 16-window cap
    # stopped at ~17,400 chars and lost the tail (~1,450 max).
    entities = data["entities"]
    assert len(entities) > 1_550, f"tail appears unscanned: only {len(entities)} entities"
    max_end = max(e["end"] for e in entities)
    assert max_end > 19_000


def test_calculate_iou():
    # Perfect overlap
    assert calculate_iou(0, 10, 0, 10) == 1.0
    # Half overlap: (5 to 10) / (0 to 15) = 5 / 15 = 0.333
    assert abs(calculate_iou(0, 10, 5, 15) - (5 / 15)) < 1e-4
    # No overlap
    assert calculate_iou(0, 10, 15, 20) == 0.0


def test_schema_validation_rejection(client):
    # Empty text
    res = client.post("/extract", json={"text": ""})
    assert res.status_code == 422

    # Whitespace-only text
    res = client.post("/extract", json={"text": "   "})
    assert res.status_code == 422

    # Threshold > 1.0
    res = client.post("/extract", json={"text": "Test", "threshold": 1.5})
    assert res.status_code == 422


def test_cooperative_deadline():
    """The deadline must stop unprocessed windows and flag partial=True."""

    class SlowModel:
        def predict_entities(self, text, labels, threshold=0.4):
            time.sleep(0.1)
            return []

    long_text = "A" * 5_000  # 5 windows at WINDOW=1_200 / OVERLAP=120
    model = SlowModel()
    entities, is_partial = predict_windowed(model, long_text, threshold=0.4, deadline_s=0.15)
    assert is_partial is True  # 0.1s per window: the 0.15s deadline trips mid-document
    assert isinstance(entities, list)


def test_all_windows_failing_raises():
    """If every attempted window fails, raise — an empty success would be a false clean result."""

    class ExplodingModel:
        def predict_entities(self, text, labels, threshold=0.4):
            raise RuntimeError("model exploded")

    with pytest.raises(RuntimeError):
        predict_windowed(ExplodingModel(), "Rahul Kumar lives here", threshold=0.4)


def test_single_window_failure_is_tolerated():
    """A transient failure in one window is skipped; successful windows still yield entities."""

    class FlakyModel:
        def __init__(self):
            self.calls = 0

        def predict_entities(self, text, labels, threshold=0.4):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("transient")
            if "Rahul Kumar" in text:
                start = text.index("Rahul Kumar")
                return [{
                    "label": "person",
                    "text": "Rahul Kumar",
                    "start": start,
                    "end": start + len("Rahul Kumar"),
                    "score": 0.94,
                }]
            return []

    # 2,100 chars -> 2 windows; the first window fails, the second must still deliver.
    long_text = ("A" * 2000) + " then Rahul Kumar appears"
    entities, is_partial = predict_windowed(FlakyModel(), long_text, threshold=0.4)
    assert is_partial is True
    assert len(entities) == 1
    assert entities[0].text == "Rahul Kumar"


def test_duplicate_and_iou_dedup():
    """Identical spans keep the max score; same-label IoU >= 0.5 collapses to one entity."""

    class DuplicateModel:
        def predict_entities(self, text, labels, threshold=0.4):
            start = text.index("Rahul Kumar")
            base = {
                "label": "person",
                "text": "Rahul Kumar",
                "start": start,
                "end": start + len("Rahul Kumar"),
            }
            # Exact duplicate (score 0.90) + IoU-1.0 near-duplicate (score 0.95)
            return [
                {**base, "score": 0.90},
                {**base, "score": 0.95},
            ]

    entities, _ = predict_windowed(DuplicateModel(), "Rahul Kumar works here", threshold=0.4)
    assert len(entities) == 1
    assert entities[0].score == 0.95


def test_unicode_offsets_are_code_points():
    """Offsets must be Python code-point based: text[start:end] == entity text,
    including astral-plane characters (emoji) and combining marks."""

    class UnicodeModel:
        def predict_entities(self, text, labels, threshold=0.4):
            results = []
            for needle, label in [("Rahul कुमार", "person"), ("🚀 Corp", "organization")]:
                idx = text.find(needle)
                if idx >= 0:
                    results.append({
                        "label": label,
                        "text": needle,
                        "start": idx,
                        "end": idx + len(needle),  # len() counts code points in Python 3
                        "score": 0.9,
                    })
            return results

    text = "Contact 🚀 Corp about Rahul कुमार today"
    entities, _ = predict_windowed(UnicodeModel(), text, threshold=0.4)
    assert len(entities) == 2
    for ent in entities:
        assert text[ent.start:ent.end] == ent.text

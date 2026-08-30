import math
import time
from typing import List, Tuple, Any
from schemas import EntityOut, LABELS, MAX_TEXT_CHARS

# 20 windows x step (1_200 - 120) + 1_200 = 21_720 chars >= MAX_TEXT_CHARS (20_000),
# so a capped (truncated) document is always fully covered. The partial flag below
# remains as an honest safety net if these constants ever drift apart.
WINDOW = 1_200
OVERLAP = 120
MAX_WINDOWS = 20
DEADLINE_S = 13.5


def calculate_iou(start1: int, end1: int, start2: int, end2: int) -> float:
    """Calculate Intersection over Union (IoU) of two 1D spans."""
    intersection = max(0, min(end1, end2) - max(start1, start2))
    union = max(end1, end2) - min(start1, start2)
    if union <= 0:
        return 0.0
    return intersection / union


def predict_windowed(
    model: Any,
    text: str,
    threshold: float = 0.40,
    deadline_s: float = DEADLINE_S,
) -> Tuple[List[EntityOut], bool]:
    """
    Executes windowed inference over text up to MAX_TEXT_CHARS.
    Enforces a cooperative deadline (default 13.5s) to guarantee a response before
    the 15s client timeout; the deadline is checked between windows because a PyTorch
    forward pass cannot be preempted mid-flight.

    Raises RuntimeError when every attempted window failed — an empty-but-successful
    result would be a false clean extraction.
    """
    start_time = time.monotonic()
    bounded_text = text[:MAX_TEXT_CHARS]
    text_len = len(bounded_text)

    if text_len == 0:
        return [], False

    # Generate window boundaries
    windows: List[Tuple[int, int]] = []
    step = WINDOW - OVERLAP
    current = 0

    while current < text_len and len(windows) < MAX_WINDOWS:
        window_end = min(current + WINDOW, text_len)
        windows.append((current, window_end))
        if window_end >= text_len:
            break
        current += step

    raw_candidates: List[dict] = []
    is_partial = False
    attempted = 0
    failed = 0

    for win_start, win_end in windows:
        # Check cooperative deadline before starting each forward pass
        if time.monotonic() - start_time > deadline_s:
            is_partial = True
            break
        attempted += 1

        window_text = bounded_text[win_start:win_end]

        try:
            # GLiNER model inference
            predictions = model.predict_entities(
                window_text, LABELS, threshold=threshold
            )
        except Exception:
            # Transient single-window error: skip this window, keep going.
            failed += 1
            is_partial = True
            continue

        for pred in predictions:
            label = str(pred.get("label", "")).lower()
            if label not in LABELS:
                continue

            ent_text = pred.get("text", "")
            local_start = pred.get("start", 0)
            local_end = pred.get("end", 0)
            score = float(pred.get("score", 0.0))

            if not math.isfinite(score) or score < threshold:
                continue

            global_start = win_start + local_start
            global_end = win_start + local_end

            # Validate offsets and slice invariant
            if 0 <= global_start < global_end <= text_len:
                extracted_slice = bounded_text[global_start:global_end]
                # Allow minor whitespace match or exact match
                if extracted_slice == ent_text or extracted_slice.strip() == ent_text.strip():
                    raw_candidates.append(
                        {
                            "label": label,
                            "text": extracted_slice,
                            "start": global_start,
                            "end": global_end,
                            "score": score,
                        }
                    )

    if attempted > 0 and failed == attempted:
        raise RuntimeError(
            f"GLiNER inference failed for all {attempted} attempted windows"
        )

    # Honest partial flag: the deadline stopped us, or the window cap left a tail
    # of the document unscanned (must never happen with MAX_WINDOWS sized to
    # MAX_TEXT_CHARS, but flag it rather than silently claim completeness).
    if windows and windows[-1][1] < text_len:
        is_partial = True

    # Cross-window deduplication
    # Sort candidates by score descending
    raw_candidates.sort(key=lambda x: x["score"], reverse=True)
    deduped: List[EntityOut] = []

    for cand in raw_candidates:
        overlap_found = False
        for accepted in deduped:
            if cand["label"] == accepted.label:
                # Same label with span overlap or IoU >= 0.5
                iou = calculate_iou(
                    cand["start"], cand["end"], accepted.start, accepted.end
                )
                if iou >= 0.5 or (cand["start"] == accepted.start and cand["end"] == accepted.end):
                    overlap_found = True
                    break

        if not overlap_found:
            deduped.append(
                EntityOut(
                    label=cand["label"],
                    text=cand["text"],
                    start=cand["start"],
                    end=cand["end"],
                    score=cand["score"],
                )
            )

    # Sort final entities by start offset ascending
    deduped.sort(key=lambda x: x.start)
    return deduped, is_partial

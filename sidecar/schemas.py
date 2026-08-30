from typing import List, Optional
from pydantic import BaseModel, Field, field_validator

LABELS = ["person", "organization", "location", "address", "email", "phone_number"]

MAX_TEXT_CHARS = 20_000
HARD_BODY_CHARS = 64_000


class ExtractRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=HARD_BODY_CHARS, description="Text to extract entities from")
    threshold: float = Field(default=0.40, ge=0.0, le=1.0, description="Confidence threshold for GLiNER extraction")

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must contain non-whitespace characters")
        return value


class EntityOut(BaseModel):
    label: str = Field(..., description="Entity category label")
    text: str = Field(..., description="Matched entity raw text")
    start: int = Field(..., ge=0, description="Start code-point offset (0-indexed)")
    end: int = Field(..., ge=0, description="End code-point offset (exclusive)")
    score: float = Field(..., ge=0.0, le=1.0, description="Confidence score")


class ExtractResponse(BaseModel):
    entities: List[EntityOut] = Field(default_factory=list)
    textTruncated: bool = False
    partial: bool = False


class HealthResponse(BaseModel):
    status: str = "ok"
    model: str = "gliner_small-v2.1"
    ready: bool = True
    device: str = "cpu"

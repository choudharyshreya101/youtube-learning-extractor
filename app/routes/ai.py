from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.config import get_settings
from app.limiter import check_rate_limit
from app.models import RefineRequest, SyllabusRequest, SyllabusResponse
from app.services import gemini_service

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# POST /api/ai/extract-syllabus
# ---------------------------------------------------------------------------

@router.post("/api/ai/extract-syllabus", response_model=SyllabusResponse)
async def extract_syllabus(request: Request, body: SyllabusRequest) -> SyllabusResponse:
    """Generate a structured learning syllabus from a list of videos."""
    ip = request.client.host if request.client else "unknown"

    if not check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again in a minute.")

    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Gemini API key not configured.")

    try:
        result = await gemini_service.extract_syllabus(
            topic=body.topic,
            videos=body.videos,
            api_key=settings.GEMINI_API_KEY,
        )
    except Exception as exc:
        logger.error("extract_syllabus error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="AI service error. Please try again.") from exc

    return SyllabusResponse(**result)


# ---------------------------------------------------------------------------
# POST /api/ai/refine
# ---------------------------------------------------------------------------

@router.post("/api/ai/refine", response_model=SyllabusResponse)
async def refine_syllabus(request: Request, body: RefineRequest) -> SyllabusResponse:
    """Refine an existing syllabus with additional instructions."""
    ip = request.client.host if request.client else "unknown"

    if not check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again in a minute.")

    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Gemini API key not configured.")

    try:
        result = await gemini_service.refine_syllabus(
            topic=body.topic,
            refinement=body.refinement,
            videos=body.videos,
            api_key=settings.GEMINI_API_KEY,
        )
    except Exception as exc:
        logger.error("refine_syllabus error_type=%s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="AI service error. Please try again.") from exc

    return SyllabusResponse(**result)

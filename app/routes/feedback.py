from __future__ import annotations

import logging
import httpx
from fastapi import APIRouter, HTTPException, Request

from app.config import get_settings
from app.limiter import check_rate_limit
from app.models import FeedbackRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/api/feedback")
async def submit_feedback(request: Request, body: FeedbackRequest) -> dict:
    """Receive anonymous user question or feature request."""
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please wait a moment.")

    settings = get_settings()
    webhook_url = settings.FEEDBACK_WEBHOOK_URL.strip()

    if webhook_url:
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                payload = {
                    "text": body.message,
                    "timestamp": body.timestamp,
                    "source": "youtube-learning-extractor-v2",
                }
                await client.post(webhook_url, json=payload)
        except Exception as exc:
            logger.warning("feedback webhook forwarding failed: %s", exc)

    logger.info("Anonymous feedback received: %s", body.message[:150])
    return {"status": "ok"}

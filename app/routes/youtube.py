from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException, Request

from app import cache as video_cache
from app.config import get_settings
from app.limiter import check_rate_limit
from app.models import EnrichRequest, EnrichResponse, EnrichedVideo, Chapter, PlaylistRequest
from app.services.youtube_service import (
    compute_like_ratio,
    fetch_channel_stats,
    fetch_playlist_items,
    fetch_video_details,
    parse_chapters,
    seconds_from_iso,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")
_PLAYLIST_ID_RE = re.compile(r"[?&]list=([a-zA-Z0-9_-]{10,34})")


# ---------------------------------------------------------------------------
# POST /api/youtube/playlist
# ---------------------------------------------------------------------------

@router.post("/api/youtube/playlist")
async def fetch_playlist(request: Request, body: PlaylistRequest) -> list[dict]:
    """Extract items from a YouTube playlist URL."""
    ip = request.client.host if request.client else "unknown"

    # Apply rate limiter
    if not check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again in a minute.")

    # Extract playlist ID from URL
    match = _PLAYLIST_ID_RE.search(body.url)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid or missing playlist ID.")

    playlist_id = match.group(1)
    settings = get_settings()

    if not settings.YOUTUBE_API_KEY:
        raise HTTPException(status_code=503, detail="YouTube API key not configured.")

    items = await fetch_playlist_items(playlist_id, settings.YOUTUBE_API_KEY)

    logger.info("playlist fetch status=200 items=%d", len(items))
    return items


# ---------------------------------------------------------------------------
# POST /api/youtube/enrich
# ---------------------------------------------------------------------------

@router.post("/api/youtube/enrich", response_model=EnrichResponse)
async def enrich_videos(request: Request, body: EnrichRequest) -> EnrichResponse:
    """Enrich video metadata for a list of video IDs."""
    ip = request.client.host if request.client else "unknown"

    # Validate all videoIds (belt-and-suspenders; model validator runs first)
    for vid in body.videoIds:
        if not _VIDEO_ID_RE.match(vid):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid videoId format: {vid!r}",
            )

    # Apply rate limiter
    if not check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again in a minute.")

    settings = get_settings()
    if not settings.YOUTUBE_API_KEY:
        raise HTTPException(status_code=503, detail="YouTube API key not configured.")

    # Split into cached vs. uncached
    cached_results: list[dict] = []
    uncached_ids: list[str] = []

    for vid in body.videoIds:
        cached = video_cache.get(vid)
        if cached is not None:
            cached_results.append(cached)
        else:
            uncached_ids.append(vid)

    cached_count = len(cached_results)

    # Fetch fresh data for uncached IDs
    fresh_results: list[dict] = []
    if uncached_ids:
        raw_details = await fetch_video_details(uncached_ids, settings.YOUTUBE_API_KEY)

        # Collect unique channel IDs to fetch subscriber counts
        channel_ids = list({d["channelId"] for d in raw_details if d.get("channelId")})
        channel_stats: dict[str, int | None] = {}
        if channel_ids:
            channel_stats = await fetch_channel_stats(channel_ids, settings.YOUTUBE_API_KEY)

        for detail in raw_details:
            channel_id = detail.get("channelId", "")
            subscriber_count = channel_stats.get(channel_id)

            view_count: int | None = detail.get("viewCount")
            like_count: int | None = detail.get("likeCount")
            duration_str: str = detail.get("duration", "PT0S")

            chapters_raw = parse_chapters(detail.get("description", ""))
            like_ratio = compute_like_ratio(like_count, view_count)
            has_high_engagement = like_ratio is not None and like_ratio >= 4.0
            is_duration_short = seconds_from_iso(duration_str) <= 60

            # Recency flag: published within last 365 days
            is_recent = False
            published_at = detail.get("publishedAt", "")
            if published_at:
                try:
                    from datetime import datetime, timezone
                    pub_dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
                    is_recent = (datetime.now(timezone.utc) - pub_dt).days <= 365
                except Exception:
                    is_recent = False

            enriched: dict = {
                "videoId": detail["videoId"],
                "title": detail.get("title", ""),
                "channelName": detail.get("channelName", ""),
                "channelId": channel_id,
                "subscriberCount": subscriber_count,
                "viewCount": view_count,
                "likeCount": like_count,
                "duration": duration_str,
                "publishedAt": published_at,
                "thumbnailUrl": detail.get("thumbnailUrl", ""),
                "description": detail.get("description", ""),
                "likeRatio": like_ratio,
                "hasHighEngagement": has_high_engagement,
                "chapters": chapters_raw,
                "isDurationShort": is_duration_short,
                "source": "youtube",
                "isRecent": is_recent,
            }

            # Store in cache
            video_cache.set(detail["videoId"], enriched)
            fresh_results.append(enriched)

    fresh_count = len(fresh_results)

    # Merge and preserve original request order
    all_by_id: dict[str, dict] = {r["videoId"]: r for r in cached_results + fresh_results}
    ordered: list[dict] = [all_by_id[vid] for vid in body.videoIds if vid in all_by_id]

    logger.info(
        "enrich status=200 total=%d cached=%d fresh=%d",
        len(ordered),
        cached_count,
        fresh_count,
    )

    # Build Pydantic response
    enriched_videos = [
        EnrichedVideo(
            videoId=d["videoId"],
            title=d["title"],
            channelName=d["channelName"],
            channelId=d["channelId"],
            subscriberCount=d.get("subscriberCount"),
            viewCount=d.get("viewCount"),
            likeCount=d.get("likeCount"),
            duration=d["duration"],
            publishedAt=d["publishedAt"],
            thumbnailUrl=d["thumbnailUrl"],
            description=d["description"],
            likeRatio=d.get("likeRatio"),
            hasHighEngagement=d["hasHighEngagement"],
            chapters=[Chapter(time=c["time"], label=c["label"]) for c in d["chapters"]],
            isDurationShort=d["isDurationShort"],
            source=d.get("source", ""),
            isRecent=d.get("isRecent", False),
        )
        for d in ordered
    ]

    return EnrichResponse(videos=enriched_videos)

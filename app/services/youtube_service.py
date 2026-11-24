from __future__ import annotations

import re
from typing import Optional

import httpx

# ---------------------------------------------------------------------------
# YouTube Data API v3 base URL
# ---------------------------------------------------------------------------
_BASE = "https://www.googleapis.com/youtube/v3"

# Titles that indicate deleted / private videos
_SKIP_TITLES = frozenset(["[Deleted video]", "[Private video]", "Deleted video", "Private video"])


# ---------------------------------------------------------------------------
# Public async helpers
# ---------------------------------------------------------------------------

async def fetch_playlist_items(playlist_id: str, api_key: str) -> list[dict]:
    """Paginate through a YouTube playlist and return up to 500 items.

    Each returned dict has keys: videoId, title, channelName, thumbnailUrl, position.
    Deleted / private items are silently skipped.
    """
    items: list[dict] = []
    page_token: Optional[str] = None
    video_id_pattern = re.compile(r"^[a-zA-Z0-9_-]{11}$")

    async with httpx.AsyncClient(timeout=20.0) as client:
        while len(items) < 500:
            params: dict = {
                "part": "snippet",
                "playlistId": playlist_id,
                "maxResults": 50,
                "key": api_key,
            }
            if page_token:
                params["pageToken"] = page_token

            resp = client.get(f"{_BASE}/playlistItems", params=params)
            resp = await resp if hasattr(resp, "__await__") else resp  # type: ignore[assignment]
            resp.raise_for_status()
            data = resp.json()

            for raw in data.get("items", []):
                snippet = raw.get("snippet", {})
                resource = snippet.get("resourceId", {})
                video_id = resource.get("videoId", "")
                title = snippet.get("title", "")

                # Skip missing / deleted / private videos
                if not video_id or not video_id_pattern.match(video_id):
                    continue
                if title in _SKIP_TITLES or not title:
                    continue

                thumbnails = snippet.get("thumbnails", {})
                thumbnail_url = (
                    thumbnails.get("medium", {}).get("url")
                    or thumbnails.get("default", {}).get("url")
                    or ""
                )

                items.append(
                    {
                        "videoId": video_id,
                        "title": title,
                        "channelName": snippet.get("videoOwnerChannelTitle", ""),
                        "thumbnailUrl": thumbnail_url,
                        "position": snippet.get("position", len(items)),
                    }
                )

            page_token = data.get("nextPageToken")
            if not page_token:
                break

    return items


async def fetch_video_details(video_ids: list[str], api_key: str) -> list[dict]:
    """Fetch snippet + statistics + contentDetails for up to N videos.

    Automatically chunks requests into batches of 50.
    """
    results: list[dict] = []

    async with httpx.AsyncClient(timeout=20.0) as client:
        for i in range(0, len(video_ids), 50):
            batch = video_ids[i : i + 50]
            params = {
                "part": "snippet,statistics,contentDetails",
                "id": ",".join(batch),
                "key": api_key,
            }
            resp = await client.get(f"{_BASE}/videos", params=params)
            resp.raise_for_status()
            data = resp.json()

            for item in data.get("items", []):
                vid_id = item.get("id", "")
                snippet = item.get("snippet", {})
                stats = item.get("statistics", {})
                content = item.get("contentDetails", {})

                thumbnails = snippet.get("thumbnails", {})
                thumbnail_url = (
                    thumbnails.get("medium", {}).get("url")
                    or thumbnails.get("high", {}).get("url")
                    or thumbnails.get("default", {}).get("url")
                    or f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg"
                )

                def _safe_int(value: Optional[str]) -> Optional[int]:
                    try:
                        return int(value) if value is not None else None
                    except (ValueError, TypeError):
                        return None

                description = snippet.get("description", "")
                if len(description) > 3000:
                    description = description[:3000]

                results.append(
                    {
                        "videoId": vid_id,
                        "title": snippet.get("title", ""),
                        "channelName": snippet.get("channelTitle", ""),
                        "channelId": snippet.get("channelId", ""),
                        "viewCount": _safe_int(stats.get("viewCount")),
                        "likeCount": _safe_int(stats.get("likeCount")),
                        "duration": content.get("duration", "PT0S"),
                        "publishedAt": snippet.get("publishedAt", ""),
                        "thumbnailUrl": thumbnail_url,
                        "description": description,
                    }
                )

    return results


async def fetch_channel_stats(channel_ids: list[str], api_key: str) -> dict[str, Optional[int]]:
    """Return a mapping of channelId -> subscriberCount (or None if hidden)."""
    result: dict[str, Optional[int]] = {}

    async with httpx.AsyncClient(timeout=20.0) as client:
        for i in range(0, len(channel_ids), 50):
            batch = channel_ids[i : i + 50]
            params = {
                "part": "statistics",
                "id": ",".join(batch),
                "key": api_key,
            }
            resp = await client.get(f"{_BASE}/channels", params=params)
            resp.raise_for_status()
            data = resp.json()

            for item in data.get("items", []):
                ch_id = item.get("id", "")
                stats = item.get("statistics", {})
                hidden = stats.get("hiddenSubscriberCount", False)
                if hidden:
                    result[ch_id] = None
                else:
                    raw = stats.get("subscriberCount")
                    try:
                        result[ch_id] = int(raw) if raw is not None else None
                    except (ValueError, TypeError):
                        result[ch_id] = None

    return result


# ---------------------------------------------------------------------------
# Pure-Python helpers (synchronous)
# ---------------------------------------------------------------------------

_CHAPTER_RE = re.compile(r"(?:^|\n)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)")


def parse_chapters(description: str) -> list[dict]:
    """Extract timestamp-based chapter markers from a video description.

    Returns a list of ``{"time": str, "label": str}`` dicts, or ``[]``.
    """
    matches = _CHAPTER_RE.findall(description)
    return [{"time": ts.strip(), "label": label.strip()} for ts, label in matches]


def compute_like_ratio(likes: Optional[int], views: Optional[int]) -> Optional[float]:
    """Return the like-to-view ratio as a percentage, or None when unavailable.

    Only computed when views >= 1000 and likes is not None.
    """
    if views is None or likes is None:
        return None
    if views < 1000:
        return None
    return round((likes / views) * 100, 2)


_ISO_DURATION_RE = re.compile(
    r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", re.IGNORECASE
)


def seconds_from_iso(duration: str) -> int:
    """Convert an ISO 8601 duration string (PTxHxMxS) to total seconds.

    Handles: PT30S, PT5M, PT1H30M, PT2H15M30S, etc.
    Returns 0 for unrecognised strings.
    """
    m = _ISO_DURATION_RE.match(duration.strip())
    if not m:
        return 0
    hours = int(m.group(1) or 0)
    minutes = int(m.group(2) or 0)
    seconds = int(m.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds

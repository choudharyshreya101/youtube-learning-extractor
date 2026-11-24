from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------

class VideoInput(BaseModel):
    """A single video reference sent from the client."""

    videoId: str = Field(..., pattern=r"^[a-zA-Z0-9_-]{11}$")
    title: str = Field(..., max_length=500)


class SyllabusRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=200)
    videos: list[VideoInput] = Field(..., max_length=500)


class RefineRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=200)
    refinement: str = Field(..., max_length=500)
    videos: list[VideoInput] = Field(..., max_length=500)


class PlaylistRequest(BaseModel):
    url: str = Field(..., max_length=2000)


class EnrichRequest(BaseModel):
    videoIds: list[str] = Field(..., max_length=500)

    @field_validator("videoIds", mode="before")
    @classmethod
    def validate_video_ids(cls, v: list[str]) -> list[str]:
        import re
        pattern = re.compile(r"^[a-zA-Z0-9_-]{11}$")
        for vid in v:
            if not pattern.match(vid):
                raise ValueError(f"Invalid videoId format: {vid!r}")
        return v


# ---------------------------------------------------------------------------
# Output / response models
# ---------------------------------------------------------------------------

class SubTopic(BaseModel):
    name: str
    brief: str
    videoIds: list[str]
    videos: Optional[list[EnrichedVideo]] = None


class SyllabusResponse(BaseModel):
    topic: str
    isTimeSensitive: bool
    subTopics: list[SubTopic]


class Chapter(BaseModel):
    time: str
    label: str


class EnrichedVideo(BaseModel):
    videoId: str
    title: str
    channelName: str
    channelId: str
    subscriberCount: Optional[int] = None
    viewCount: Optional[int] = None
    likeCount: Optional[int] = None
    duration: str
    publishedAt: str
    thumbnailUrl: str
    description: str
    likeRatio: Optional[float] = None
    hasHighEngagement: bool
    chapters: list[Chapter]
    isDurationShort: bool
    source: str = ""
    isRecent: bool = False


class EnrichResponse(BaseModel):
    videos: list[EnrichedVideo]

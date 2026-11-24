from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Optional

_MAX_ENTRIES = 2000
_EVICT_COUNT = 200

_lock = threading.Lock()
_store: OrderedDict[str, dict] = OrderedDict()


def get(video_id: str) -> Optional[dict]:
    """Return cached metadata for *video_id*, or None if not cached."""
    with _lock:
        if video_id in _store:
            # Move to end to mark as recently used
            _store.move_to_end(video_id)
            return _store[video_id]
        return None


def set(video_id: str, data: dict) -> None:  # noqa: A001
    """Store *data* under *video_id*.  Evicts oldest entries when full."""
    with _lock:
        if video_id in _store:
            _store.move_to_end(video_id)
            _store[video_id] = data
            return

        if len(_store) >= _MAX_ENTRIES:
            # Evict the oldest _EVICT_COUNT items (front of OrderedDict)
            for _ in range(_EVICT_COUNT):
                if _store:
                    _store.popitem(last=False)

        _store[video_id] = data


def clear() -> None:
    """Remove all entries from the cache."""
    with _lock:
        _store.clear()

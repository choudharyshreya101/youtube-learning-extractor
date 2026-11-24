from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

_WINDOW_SECONDS = 60
_MAX_REQUESTS = 10

_lock = threading.Lock()
_buckets: dict[str, deque[float]] = defaultdict(deque)


def check_rate_limit(ip: str) -> bool:
    """Return True if the request is allowed, False if rate-limited.

    Uses a sliding-window algorithm: only timestamps within the last
    *_WINDOW_SECONDS* seconds are kept in the per-IP deque.
    """
    now = time.monotonic()
    cutoff = now - _WINDOW_SECONDS

    with _lock:
        dq = _buckets[ip]

        # Prune timestamps outside the sliding window
        while dq and dq[0] <= cutoff:
            dq.popleft()

        if len(dq) >= _MAX_REQUESTS:
            return False  # rate-limited

        dq.append(now)
        return True

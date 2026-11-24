from __future__ import annotations

import json
import pathlib

from fastapi import APIRouter, HTTPException

router = APIRouter()

_PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
_SAMPLE_DATA_PATH = _PROJECT_ROOT / "data" / "sample_data.json"


@router.get("/api/demo/sample-data")
async def get_sample_data() -> dict:
    """Return the bundled sample dataset — no API keys required."""
    if not _SAMPLE_DATA_PATH.exists():
        raise HTTPException(status_code=404, detail="Sample data file not found.")

    with _SAMPLE_DATA_PATH.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    return data

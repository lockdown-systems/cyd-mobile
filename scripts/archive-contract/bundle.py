#!/usr/bin/env python3
"""Shared access to the pinned canonical Cyd Bluesky archive contract bundle."""

from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent
PIN = json.loads((SCRIPT_ROOT / "pin.json").read_text(encoding="utf-8"))


def base_url() -> str:
    return (
        f"https://raw.githubusercontent.com/{PIN['repository']}/"
        f"{PIN['commit']}/{PIN['path']}"
    )


def fetch(relative_path: str) -> bytes:
    """Read one file out of the pinned bundle."""
    request = urllib.request.Request(
        f"{base_url()}/{relative_path}",
        headers={
            "User-Agent": "cyd-mobile-ci",
            **(
                {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"}
                if os.environ.get("GITHUB_TOKEN")
                else {}
            ),
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def download(relative_paths: tuple[str, ...], destination: Path) -> None:
    """Copy files out of the pinned bundle into a local directory."""
    for relative_path in relative_paths:
        output = destination / relative_path
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(fetch(relative_path))

#!/usr/bin/env python3
"""Report whether cyd has a newer canonical Bluesky contract bundle."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path


script_root = Path(__file__).resolve().parent
pin = json.loads((script_root / "pin.json").read_text(encoding="utf-8"))
query = urllib.parse.urlencode({"path": pin["path"], "per_page": 1})
request = urllib.request.Request(
    f"https://api.github.com/repos/{pin['repository']}/commits?{query}",
    headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "cyd-mobile-ci",
        **(
            {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"}
            if os.environ.get("GITHUB_TOKEN")
            else {}
        ),
    },
)
with urllib.request.urlopen(request, timeout=30) as response:
    latest = json.load(response)[0]

if latest["sha"] == pin["commit"]:
    print(f"Canonical Bluesky archive bundle is current at {pin['commit']}.")
else:
    print(
        "::warning title=New canonical Bluesky archive bundle available::"
        f"Pinned {pin['commit']}; latest is {latest['sha']} ({latest['html_url']})."
    )

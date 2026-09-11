#!/usr/bin/env python3
"""Report whether a Bluesky local account is ready to export as a v2 fixture.

Run this against a copy of an account database pulled off a device, before
exporting it as a canonical-adjacent test fixture. A pending media download
silently becomes an unavailable asset, which turns a fixture meant to be
`complete` into an `incomplete` one that still looks fine.

Usage:
    check_account_readiness.py path/to/data.db [--media-dir path/to/media]
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path


SIZE_BUDGET_BYTES = 5 * 1024 * 1024

# Interchange groups Mobile cannot populate today, so a fixture exported from
# Mobile is a complement to the canonical fixtures rather than a superset.
KNOWN_GAPS = (
    ("relationships (follow, block, mute)", "nothing writes the follow table; follows are fetched live to unfollow"),
    ("profiles.avatar_asset_id / banner", "avatars are URLs, never content-addressed"),
    ("profiles.description", "not stored"),
    ("captured historical profiles", "profile is UNIQUE(did), updated in place"),
    ("records.first_observed_at vs observed_at", "one savedAt column"),
    ("records.indexed_at", "not stored"),
    ("assets kind thumbnail", "a video's own thumbnail is a URL, never preserved"),
    ("record_assets owner profile / message", "written only from post persistence"),
    ("created_at of a like or repost", "no creation time stored, so it is the observation time"),
    ("record_subjects for bookmarks", "no bookmark record URI, so the selection names the post"),
    ("deletion state of a removed bookmark", "no bookmark record to carry it"),
    ("deletion state of a like whose URI Cyd never saw", "no like record to carry it"),
    ("context for records Cyd never saved", "author DID only; the URI stays in payload_json"),
    ("portable_settings.save_reposts", "reposts are saved with posts, with no separate switch"),
)


def human(count: int) -> str:
    size = float(count)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if size < 1024 or unit == "GiB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{size:.1f} GiB"


def scalar(database: sqlite3.Connection, query: str) -> int:
    return database.execute(query).fetchone()[0] or 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--media-dir", type=Path, default=None)
    arguments = parser.parse_args()

    if not arguments.database.exists():
        print(f"No account database at {arguments.database}")
        return 2

    database = sqlite3.connect(f"file:{arguments.database}?mode=ro", uri=True)
    database.row_factory = sqlite3.Row
    problems: list[str] = []

    print(f"Account database: {arguments.database} ({human(arguments.database.stat().st_size)})\n")

    print("Selected-record coverage")
    counts = {
        "posts": "SELECT COUNT(*) FROM post WHERE isRepost = 0",
        # Matches what the writer exports: a repost record of its own, or a
        # post the account reposted.
        "reposts": "SELECT COUNT(*) FROM post WHERE isRepost = 1 OR viewerReposted = 1",
        "likes": "SELECT COUNT(*) FROM post WHERE viewerLiked = 1",
        "bookmarks": "SELECT COUNT(*) FROM bookmark",
        "chats": "SELECT COUNT(*) FROM conversation",
        "messages": "SELECT COUNT(*) FROM message",
    }
    for label, query in counts.items():
        total = scalar(database, query)
        marker = "  " if total else "! "
        if not total:
            problems.append(f"no {label} saved — that category will be empty in the fixture")
        print(f"  {marker}{label:<10} {total}")

    print("\nContext coverage")
    for label, query in (
        ("replies", "SELECT COUNT(*) FROM post WHERE isReply = 1"),
        ("quotes", "SELECT COUNT(*) FROM post WHERE isQuote = 1"),
        ("externals", "SELECT COUNT(*) FROM post_external"),
        ("source-deleted", "SELECT COUNT(*) FROM post WHERE deletedPostAt IS NOT NULL"),
    ):
        total = scalar(database, query)
        print(f"    {label:<15} {total}")

    print("\nMedia")
    states = database.execute(
        "SELECT downloadState, COUNT(*) AS total, COALESCE(SUM(byteLength), 0) AS bytes "
        "FROM media_asset GROUP BY downloadState ORDER BY downloadState"
    ).fetchall()
    if not states:
        problems.append("no media assets at all — the fixture will exercise no payloads")
        print("  ! none")
    for row in states:
        marker = "  " if row["downloadState"] == "complete" else "! "
        print(f"  {marker}{row['downloadState']:<12} {row['total']:<5} {human(row['bytes'])}")
        if row["downloadState"] != "complete":
            problems.append(
                f"{row['total']} media assets are '{row['downloadState']}' — "
                "a fixture exported now will be 'incomplete', not 'complete'"
            )

    kinds = database.execute(
        "SELECT mediaType, COUNT(*) AS total FROM media_asset "
        "WHERE downloadState = 'complete' GROUP BY mediaType"
    ).fetchall()
    present = {row["mediaType"] for row in kinds}
    for row in kinds:
        print(f"    {row['mediaType']:<13} {row['total']}")
    for missing in {"image", "video"} - present:
        problems.append(f"no preserved {missing} — the fixture will not exercise {missing} payloads")

    # Media is stored uncompressed in the archive and dominates its size, while
    # data.db deflates to a few KiB. `media_asset.byteLength` is often NULL, so
    # the files themselves are the reliable measure.
    media_dir = arguments.media_dir or arguments.database.parent / "media"
    if media_dir.is_dir():
        media_bytes = sum(f.stat().st_size for f in media_dir.rglob("*") if f.is_file())
        source = str(media_dir)
    else:
        media_bytes = scalar(
            database,
            "SELECT COALESCE(SUM(byteLength), 0) FROM media_asset "
            "WHERE downloadState = 'complete'",
        )
        source = "media_asset.byteLength (no media directory alongside the database)"

    print(f"\nProjected fixture size: {human(media_bytes)} of media, plus a compressed data.db")
    print(f"  measured from {source}")
    if media_bytes > SIZE_BUDGET_BYTES:
        problems.append(
            f"projected fixture is {human(media_bytes)}, over the {human(SIZE_BUDGET_BYTES)} budget — "
            "curate the account further before exporting"
        )

    print("\nInterchange groups Mobile cannot populate (expected to be empty)")
    for group, reason in KNOWN_GAPS:
        print(f"    {group} — {reason}")

    database.close()

    if problems:
        print("\nNot ready:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("\nReady to export.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

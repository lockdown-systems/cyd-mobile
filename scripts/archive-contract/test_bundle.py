#!/usr/bin/env python3
"""Verify Mobile against the pinned canonical Cyd Bluesky archive bundle."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import bundle


PIN = bundle.PIN
FILES = (
    "fixtures/complete.cyd",
    "fixtures/incomplete.cyd",
    "fixtures/semantic-expectations.json",
    # Mobile's writer embeds this file; the test compares the two.
    "schema.sql",
)


def rows(database: sqlite3.Connection, query: str) -> list[dict[str, Any]]:
    return [dict(row) for row in database.execute(query).fetchall()]


def raw_mobile_tables(database: sqlite3.Connection) -> dict[str, Any]:
    queries = {
        "archive": "SELECT * FROM archive",
        "identity": "SELECT * FROM identity",
        "profiles": "SELECT * FROM profiles ORDER BY id",
        "records": "SELECT * FROM records ORDER BY uri",
        "selections": "SELECT * FROM selections ORDER BY category",
        "record_subjects": "SELECT * FROM record_subjects ORDER BY relationship_uri",
        "record_context": "SELECT * FROM record_context ORDER BY record_uri, kind",
        "conversations": "SELECT * FROM conversations ORDER BY id",
        "conversation_members": (
            "SELECT * FROM conversation_members ORDER BY conversation_id, profile_id"
        ),
        "messages": "SELECT * FROM messages ORDER BY id",
        "relationships": "SELECT * FROM relationships ORDER BY uri",
        "record_assets": (
            "SELECT * FROM record_assets "
            "ORDER BY owner_type, owner_id, role, position"
        ),
        "portable_settings": "SELECT * FROM portable_settings ORDER BY key",
        "assets": "SELECT * FROM assets ORDER BY id",
    }
    return {table: rows(database, query) for table, query in queries.items()}


def prepare_fixture(bundle_root: Path, fixture_name: str) -> None:
    archive_path = bundle_root / "fixtures" / fixture_name
    with tempfile.TemporaryDirectory(prefix="cyd-bluesky-v2-") as extracted:
        with zipfile.ZipFile(archive_path) as archive:
            archive.extractall(extracted)
            entries = {
                info.filename: archive.read(info)
                for info in archive.infolist()
                if not info.is_dir()
            }

        metadata = json.loads(entries["metadata.json"])
        manifest = json.loads(entries["manifest.json"])
        assert [payload["path"] for payload in manifest["payloads"]] == sorted(
            path for path in entries if path != "manifest.json"
        )
        for payload in manifest["payloads"]:
            content = entries[payload["path"]]
            assert len(content) == payload["bytes"]
            assert hashlib.sha256(content).hexdigest() == payload["sha256"]

        database = sqlite3.connect(Path(extracted) / "data.db")
        database.row_factory = sqlite3.Row
        try:
            mobile_input = bundle_root / "mobile-input" / f"{fixture_name}.json"
            mobile_input.parent.mkdir(parents=True, exist_ok=True)
            mobile_input.write_text(
                json.dumps(
                    {"metadata": metadata, "tables": raw_mobile_tables(database)}
                ),
                encoding="utf-8",
            )
        finally:
            database.close()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="cyd-contract-") as directory:
        bundle_root = Path(directory)
        bundle.download(FILES, bundle_root)
        prepare_fixture(bundle_root, "complete.cyd")
        prepare_fixture(bundle_root, "incomplete.cyd")
        subprocess.run(
            [
                "npm",
                "test",
                "--",
                "--runInBand",
                "services/__tests__/archive-contract-bundle.test.ts",
            ],
            check=True,
            env={**os.environ, "CYD_BLUESKY_CONTRACT_ROOT": str(bundle_root)},
        )
    print(f"Canonical Bluesky archive semantics match {PIN['commit']}.")


if __name__ == "__main__":
    main()

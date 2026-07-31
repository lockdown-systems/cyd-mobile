#!/usr/bin/env python3
"""Verify Mobile against the pinned canonical Cyd Bluesky archive bundle."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


SCRIPT_ROOT = Path(__file__).resolve().parent
PIN = json.loads((SCRIPT_ROOT / "pin.json").read_text(encoding="utf-8"))
FILES = (
    "fixtures/complete.cyd",
    "fixtures/incomplete.cyd",
    "fixtures/semantic-expectations.json",
)


def download_bundle(destination: Path) -> None:
    base_url = (
        f"https://raw.githubusercontent.com/{PIN['repository']}/"
        f"{PIN['commit']}/{PIN['path']}"
    )
    for relative_path in FILES:
        output = destination / relative_path
        output.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(
            f"{base_url}/{relative_path}", headers={"User-Agent": "cyd-mobile-ci"}
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            output.write_bytes(response.read())


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


def prepare_fixture(bundle: Path, fixture_name: str) -> None:
    archive_path = bundle / "fixtures" / fixture_name
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
            mobile_input = bundle / "mobile-input" / f"{fixture_name}.json"
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
        bundle = Path(directory)
        download_bundle(bundle)
        prepare_fixture(bundle, "complete.cyd")
        prepare_fixture(bundle, "incomplete.cyd")
        subprocess.run(
            [
                "npm",
                "test",
                "--",
                "--runInBand",
                "services/__tests__/archive-contract-bundle.test.ts",
            ],
            check=True,
            env={**os.environ, "CYD_BLUESKY_CONTRACT_ROOT": str(bundle)},
        )
    print(f"Canonical Bluesky archive semantics match {PIN['commit']}.")


if __name__ == "__main__":
    main()

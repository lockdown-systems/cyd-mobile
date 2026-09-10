#!/usr/bin/env python3
"""Check any .cyd file against the pinned Cyd Bluesky archive v2 contract.

Cyd Mobile builds its version 2 writer before the reader that consumes it
(ADR 0004), so for a while nothing in the app can tell a correct archive from a
plausible one. This does, against the pinned canonical schema rather than
against Mobile's own idea of the format.

Usage:
    conformance.py                  # check the pinned canonical fixtures
    conformance.py path/to/x.cyd    # check one archive
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import stat
import sys
import tempfile
import zipfile
from pathlib import Path

import bundle


MEDIA_PATH = re.compile(r"^media/sha256/([0-9a-f]{2})/([0-9a-f]{64})$")
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
FIXED_ENTRIES = {"metadata.json", "manifest.json", "data.db"}
METADATA_KEYS = {
    "format",
    "platform",
    "version",
    "createdAt",
    "accountDid",
    "accountUuid",
    "completeness",
}


class Failures(list):
    def check(self, condition: bool, message: str) -> bool:
        if not condition:
            self.append(message)
        return condition


def entry_path_is_safe(name: str) -> bool:
    if not name or name.startswith("/") or "\\" in name:
        return False
    if re.match(r"^[A-Za-z]:", name):
        return False
    if any(ord(character) < 0x20 for character in name):
        return False
    segments = name.split("/")
    return all(segment not in ("", ".", "..") for segment in segments)


def check_zip_structure(archive: zipfile.ZipFile, failures: Failures) -> list[str]:
    """Entry names, entry types, and the fixed v2 layout."""
    payloads: list[str] = []
    seen: dict[str, str] = {}

    for info in archive.infolist():
        name = info.filename
        if info.flag_bits & 0x1:
            failures.append(f"{name}: encrypted entries are forbidden")
        if info.flag_bits & 0x800 == 0 and not name.isascii():
            failures.append(f"{name}: non-ASCII name without the UTF-8 flag")
        if not entry_path_is_safe(name.rstrip("/")):
            failures.append(f"{name}: not a normalized relative path")
            continue

        lowered = name.rstrip("/").lower()
        if lowered in seen and seen[lowered] != name:
            failures.append(f"{name}: duplicates {seen[lowered]} case-insensitively")
        seen[lowered] = name

        if info.is_dir():
            continue

        # Only judge the entry type when the writer actually recorded one:
        # plenty of valid writers leave the file-type bits empty.
        file_type = (info.external_attr >> 16) & 0o170000
        if file_type and not stat.S_ISREG(file_type):
            failures.append(f"{name}: entries must be regular files or directories")
            continue

        if name not in FIXED_ENTRIES and not MEDIA_PATH.match(name):
            failures.append(f"{name}: not part of the version 2 layout")
        payloads.append(name)

    for required in sorted(FIXED_ENTRIES):
        failures.check(required in payloads, f"{required}: missing")
    return payloads


def check_manifest(
    archive: zipfile.ZipFile, payloads: list[str], failures: Failures
) -> None:
    try:
        manifest = json.loads(archive.read("manifest.json"))
    except (KeyError, ValueError) as error:
        failures.append(f"manifest.json: unreadable ({error})")
        return

    failures.check(
        manifest.get("algorithm") == "sha256",
        "manifest.json: algorithm must be sha256",
    )
    listed = manifest.get("payloads")
    if not isinstance(listed, list):
        failures.append("manifest.json: payloads must be a list")
        return

    paths = [entry.get("path") for entry in listed]
    expected = sorted(name for name in payloads if name != "manifest.json")
    failures.check(
        paths == sorted(paths), "manifest.json: payloads must be sorted by path"
    )
    failures.check(
        sorted(paths) == expected,
        "manifest.json: payload list and archive entries disagree "
        f"(only in manifest: {sorted(set(paths) - set(expected))}, "
        f"only in archive: {sorted(set(expected) - set(paths))})",
    )

    for entry in listed:
        path = entry.get("path")
        if path not in expected:
            continue
        content = archive.read(path)
        failures.check(
            entry.get("bytes") == len(content),
            f"{path}: manifest declares {entry.get('bytes')} bytes, found {len(content)}",
        )
        digest = hashlib.sha256(content).hexdigest()
        failures.check(
            entry.get("sha256") == digest,
            f"{path}: manifest digest does not match contents",
        )


def check_metadata(archive: zipfile.ZipFile, failures: Failures) -> dict:
    try:
        metadata = json.loads(archive.read("metadata.json"))
    except (KeyError, ValueError) as error:
        failures.append(f"metadata.json: unreadable ({error})")
        return {}

    failures.check(
        METADATA_KEYS <= set(metadata),
        f"metadata.json: missing {sorted(METADATA_KEYS - set(metadata))}",
    )
    failures.check(
        metadata.get("format") == "cyd-archive", "metadata.json: format must be cyd-archive"
    )
    failures.check(
        metadata.get("platform") == "bluesky", "metadata.json: platform must be bluesky"
    )
    failures.check(metadata.get("version") == 2, "metadata.json: version must be 2")
    failures.check(
        bool(TIMESTAMP.match(str(metadata.get("createdAt")))),
        "metadata.json: createdAt must be RFC 3339 UTC with milliseconds",
    )
    failures.check(
        metadata.get("completeness") in ("complete", "incomplete"),
        "metadata.json: completeness must be complete or incomplete",
    )
    return metadata


def check_database(
    database: sqlite3.Connection, schema_sql: str, failures: Failures
) -> None:
    """The interchange database must implement the pinned schema exactly."""
    reference = sqlite3.connect(":memory:")
    reference.executescript(schema_sql)

    def objects(connection: sqlite3.Connection) -> dict[tuple[str, str], str]:
        return {
            (row[0], row[1]): " ".join((row[2] or "").split())
            for row in connection.execute(
                "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
            )
        }

    actual, expected = objects(database), objects(reference)
    for key in sorted(expected.keys() - actual.keys()):
        failures.append(f"data.db: missing {key[0]} {key[1]}")
    for key in sorted(actual.keys() - expected.keys()):
        failures.append(f"data.db: unexpected {key[0]} {key[1]}")
    for key in sorted(expected.keys() & actual.keys()):
        failures.check(
            actual[key] == expected[key],
            f"data.db: {key[0]} {key[1]} does not match the pinned schema",
        )

    for pragma, want in (("application_id", 0x43594232), ("user_version", 2)):
        got = database.execute(f"PRAGMA {pragma};").fetchone()[0]
        failures.check(got == want, f"data.db: {pragma} is {got}, expected {want}")

    failures.check(
        database.execute("PRAGMA integrity_check;").fetchone()[0] == "ok",
        "data.db: failed integrity_check",
    )
    violations = database.execute("PRAGMA foreign_key_check;").fetchall()
    failures.check(not violations, f"data.db: {len(violations)} foreign key violations")
    reference.close()


def check_semantics(
    database: sqlite3.Connection,
    archive: zipfile.ZipFile,
    payloads: list[str],
    metadata: dict,
    failures: Failures,
) -> None:
    """Cross-checks the schema alone cannot express."""
    rows = database.execute("SELECT * FROM archive").fetchall()
    if not failures.check(len(rows) == 1, f"archive: expected 1 row, found {len(rows)}"):
        return
    row = rows[0]
    for key, column in (
        ("format", "format"),
        ("platform", "platform"),
        ("version", "version"),
        ("createdAt", "created_at"),
        ("accountDid", "account_did"),
        ("accountUuid", "account_uuid"),
        ("completeness", "completeness"),
    ):
        failures.check(
            metadata.get(key) == row[column],
            f"metadata.{key} is {metadata.get(key)!r}, archive.{column} is {row[column]!r}",
        )

    identity = database.execute("SELECT * FROM identity").fetchall()
    failures.check(
        len(identity) == 1, f"identity: expected 1 row, found {len(identity)}"
    )
    if identity:
        failures.check(
            identity[0]["did"] == row["account_did"],
            "identity.did does not match archive.account_did",
        )

    assets = database.execute("SELECT * FROM assets").fetchall()
    referenced: set[str] = set()
    for asset in assets:
        if asset["availability"] != "available":
            continue
        path, digest = asset["archive_path"], asset["sha256"]
        referenced.add(path)
        if not failures.check(
            path in payloads, f"assets[{asset['id']}]: {path} is not in the archive"
        ):
            continue
        match = MEDIA_PATH.match(path)
        failures.check(
            bool(match) and match.group(2) == digest and match.group(1) == digest[:2],
            f"assets[{asset['id']}]: path does not end in its digest",
        )
        content = archive.read(path)
        failures.check(
            hashlib.sha256(content).hexdigest() == digest,
            f"assets[{asset['id']}]: payload does not match its declared digest",
        )
        failures.check(
            asset["byte_count"] == len(content),
            f"assets[{asset['id']}]: declares {asset['byte_count']} bytes, found {len(content)}",
        )

    orphans = sorted(set(name for name in payloads if MEDIA_PATH.match(name)) - referenced)
    for orphan in orphans:
        failures.append(f"{orphan}: media payload no asset row references")

    complete = all(asset["availability"] == "available" for asset in assets)
    failures.check(
        (metadata.get("completeness") == "complete") == complete,
        "completeness must be 'complete' if and only if every asset is available",
    )


def check_archive(path: Path, schema_sql: str) -> Failures:
    failures = Failures()
    with zipfile.ZipFile(path) as archive:
        payloads = check_zip_structure(archive, failures)
        check_manifest(archive, payloads, failures)
        metadata = check_metadata(archive, failures)
        if "data.db" not in payloads:
            return failures
        with tempfile.TemporaryDirectory(prefix="cyd-conformance-") as directory:
            extracted = Path(directory) / "data.db"
            extracted.write_bytes(archive.read("data.db"))
            database = sqlite3.connect(extracted)
            database.row_factory = sqlite3.Row
            try:
                check_database(database, schema_sql, failures)
                check_semantics(database, archive, payloads, metadata, failures)
            finally:
                database.close()
    return failures


def main() -> int:
    schema_sql = bundle.fetch("schema.sql").decode("utf-8")
    targets: list[tuple[str, Path]] = []
    stack = tempfile.TemporaryDirectory(prefix="cyd-conformance-fixtures-")

    if len(sys.argv) > 1:
        targets = [(argument, Path(argument)) for argument in sys.argv[1:]]
    else:
        root = Path(stack.name)
        names = ("fixtures/complete.cyd", "fixtures/incomplete.cyd")
        bundle.download(names, root)
        targets = [(f"canonical {Path(n).name}", root / n) for n in names]

    failed = False
    with stack:
        for label, path in targets:
            failures = check_archive(path, schema_sql)
            if failures:
                failed = True
                print(f"FAIL {label}")
                for failure in failures:
                    print(f"  - {failure}")
            else:
                print(f"ok   {label}")

    if failed:
        print("\nArchive does not conform to the pinned Bluesky v2 contract.")
        return 1
    print(f"\nConforms to the Bluesky v2 contract pinned at {bundle.PIN['commit']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

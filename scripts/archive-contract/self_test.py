#!/usr/bin/env python3
"""Prove the conformance checker rejects archives it should reject.

A checker that passes everything would let a broken version 2 writer look
correct, which matters more than usual while Mobile builds its writer before
the reader that would otherwise catch it (ADR 0004). Each case below mutates
the pinned canonical fixture and must be caught.

Cases are resealed with a recomputed manifest, because that is how a broken
writer actually fails: internally consistent, and wrong. Without resealing,
the manifest digest catches everything first and the deeper checks never run.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import stat
import tempfile
import zipfile
from pathlib import Path

import bundle
import conformance


def seal(source: Path, destination: Path, entries: dict[str, bytes], reseal: bool) -> None:
    if reseal:
        entries["manifest.json"] = json.dumps(
            {
                "algorithm": "sha256",
                "payloads": [
                    {
                        "path": name,
                        "bytes": len(entries[name]),
                        "sha256": hashlib.sha256(entries[name]).hexdigest(),
                    }
                    for name in sorted(entries)
                    if name != "manifest.json"
                ],
            }
        ).encode("utf-8")

    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            info = zipfile.ZipInfo(name, (2026, 1, 15, 12, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            symlink = name.startswith("symlink:")
            info.external_attr = (
                (stat.S_IFLNK | 0o777) if symlink else (stat.S_IFREG | 0o644)
            ) << 16
            archive.writestr(info, content)


def edit_database(work: Path, entries: dict[str, bytes], sql: str) -> dict[str, bytes]:
    scratch = work / "scratch.db"
    scratch.write_bytes(entries["data.db"])
    database = sqlite3.connect(scratch)
    database.executescript(sql)
    database.commit()
    database.close()
    entries["data.db"] = scratch.read_bytes()
    return entries


def add(entries: dict[str, bytes], name: str, content: bytes) -> dict[str, bytes]:
    entries[name] = content
    return entries


def replace_json(
    entries: dict[str, bytes], name: str, changes: dict
) -> dict[str, bytes]:
    entries[name] = json.dumps({**json.loads(entries[name]), **changes}).encode("utf-8")
    return entries


DROP_ONE_ASSET = """
UPDATE assets
   SET availability = 'unavailable', byte_count = NULL, sha256 = NULL,
       archive_path = NULL, unavailable_reason = 'download failed'
 WHERE id = (SELECT id FROM assets WHERE availability = 'available' LIMIT 1);
"""


def cases(work: Path):
    """(label, mutate, reseal) — every one must be rejected."""
    return [
        ("stray entry outside the layout", lambda e: add(e, "notes.txt", b"hi"), True),
        ("path traversal", lambda e: add(e, "../escape.json", b"{}"), True),
        ("symlink entry", lambda e: add(e, "symlink:link", b"data.db"), True),
        ("truncated payload", lambda e: e.update({"data.db": e["data.db"][:-200]}) or e, False),
        ("forged manifest digest", _forge_manifest, False),
        (
            "metadata disagrees with the archive row",
            lambda e: replace_json(e, "metadata.json", {"accountDid": "did:plc:someoneelse"}),
            True,
        ),
        (
            "unsupported version",
            lambda e: replace_json(e, "metadata.json", {"version": 3}),
            True,
        ),
        (
            "Mobile private column leaked into the interchange schema",
            lambda e: edit_database(work, e, "ALTER TABLE records ADD COLUMN mobile_private TEXT;"),
            True,
        ),
        (
            "dropped index",
            lambda e: edit_database(work, e, "DROP INDEX records_author;"),
            True,
        ),
        (
            "asset unavailable while metadata still claims complete",
            lambda e: edit_database(work, e, DROP_ONE_ASSET),
            True,
        ),
        (
            "asset byte count lies about its payload",
            lambda e: edit_database(
                work,
                e,
                "UPDATE assets SET byte_count = byte_count + 1 "
                "WHERE id = (SELECT id FROM assets WHERE availability = 'available' LIMIT 1);",
            ),
            True,
        ),
        (
            "orphan media payload nothing references",
            lambda e: add(e, f"media/sha256/ab/{'ab' * 32}", b"orphan"),
            True,
        ),
    ]


def _forge_manifest(entries: dict[str, bytes]) -> dict[str, bytes]:
    manifest = json.loads(entries["manifest.json"])
    manifest["payloads"][0]["sha256"] = "0" * 64
    entries["manifest.json"] = json.dumps(manifest).encode("utf-8")
    return entries


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="cyd-conformance-self-test-") as directory:
        work = Path(directory)
        bundle.download(("fixtures/complete.cyd", "fixtures/incomplete.cyd"), work)
        schema_sql = bundle.fetch("schema.sql").decode("utf-8")
        source = work / "fixtures" / "complete.cyd"

        with zipfile.ZipFile(source) as archive:
            original = {
                info.filename: archive.read(info)
                for info in archive.infolist()
                if not info.is_dir()
            }

        bugs = 0

        for name in ("complete.cyd", "incomplete.cyd"):
            failures = conformance.check_archive(work / "fixtures" / name, schema_sql)
            if failures:
                bugs += 1
                print(f"BUG!  canonical {name} should conform: {failures[0]}")
            else:
                print(f"ok    canonical {name} conforms")

        for label, mutate, reseal in cases(work):
            target = work / "case.cyd"
            target.unlink(missing_ok=True)
            seal(source, target, mutate(dict(original)), reseal)
            failures = conformance.check_archive(target, schema_sql)
            if failures:
                print(f"ok    rejected: {label}")
            else:
                bugs += 1
                print(f"BUG!  accepted an archive it should reject: {label}")

    if bugs:
        print(f"\n{bugs} conformance checker problems.")
        return 1
    print("\nThe conformance checker accepts the canonical fixtures and rejects each mutation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

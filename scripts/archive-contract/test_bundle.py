#!/usr/bin/env python3
"""Verify Mobile against the pinned canonical Cyd Bluesky archive bundle."""

from __future__ import annotations

import hashlib
import json
import sqlite3
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


def parse_json_fields(
    values: list[dict[str, Any]], fields: tuple[str, ...]
) -> list[dict[str, Any]]:
    for value in values:
        for field in fields:
            value[field] = None if value[field] is None else json.loads(value[field])
    return values


def normalize_semantics(database: sqlite3.Connection) -> dict[str, Any]:
    return {
        "archive": dict(
            database.execute(
                """SELECT created_at AS createdAt, account_did AS accountDid,
                account_uuid AS accountUuid FROM archive"""
            ).fetchone()
        ),
        "identity": dict(
            database.execute(
                "SELECT did, current_profile_id AS currentProfileId FROM identity"
            ).fetchone()
        ),
        "profiles": rows(
            database,
            """SELECT id, did, handle, display_name AS displayName,
            description, avatar_asset_id AS avatarAssetId,
            banner_asset_id AS bannerAssetId, captured_at AS capturedAt
            FROM profiles ORDER BY id""",
        ),
        "records": parse_json_fields(
            rows(
                database,
                """SELECT uri, cid, record_type AS recordType,
                author_profile_id AS authorProfileId, indexed_at AS indexedAt,
                created_at AS createdAt, first_observed_at AS firstObservedAt,
                observed_at AS observedAt, source_deleted_at AS sourceDeletedAt,
                text, facets_json AS facets, payload_json AS payload
                FROM records ORDER BY uri""",
            ),
            ("facets", "payload"),
        ),
        "selections": rows(
            database,
            """SELECT category, subject_id AS subjectId, selected_at AS selectedAt
            FROM selections ORDER BY category""",
        ),
        "recordSubjects": rows(
            database,
            """SELECT relationship_uri AS relationshipUri,
            subject_record_uri AS subjectRecordUri
            FROM record_subjects ORDER BY relationship_uri""",
        ),
        "recordContext": parse_json_fields(
            rows(
                database,
                """SELECT record_uri AS recordUri, kind,
                context_record_uri AS contextRecordUri,
                context_profile_id AS contextProfileId, external_json AS external
                FROM record_context ORDER BY record_uri, kind""",
            ),
            ("external",),
        ),
        "conversations": rows(
            database,
            """SELECT id, rev, first_observed_at AS firstObservedAt,
            observed_at AS observedAt, source_deleted_at AS sourceDeletedAt
            FROM conversations ORDER BY id""",
        ),
        "conversationMembers": rows(
            database,
            """SELECT conversation_id AS conversationId, profile_id AS profileId
            FROM conversation_members ORDER BY conversation_id, profile_id""",
        ),
        "messages": parse_json_fields(
            rows(
                database,
                """SELECT id, conversation_id AS conversationId,
                sender_profile_id AS senderProfileId, sent_at AS sentAt,
                observed_at AS observedAt, source_deleted_at AS sourceDeletedAt,
                text, facets_json AS facets, payload_json AS payload
                FROM messages ORDER BY id""",
            ),
            ("facets", "payload"),
        ),
        "relationships": rows(
            database,
            """SELECT uri, kind, actor_did AS actorDid, subject_did AS subjectDid,
            created_at AS createdAt, observed_at AS observedAt,
            source_deleted_at AS sourceDeletedAt
            FROM relationships ORDER BY uri""",
        ),
        "recordAssets": rows(
            database,
            """SELECT owner_type AS ownerType, owner_id AS ownerId,
            asset_id AS assetId, role, position
            FROM record_assets ORDER BY owner_type, owner_id, role, position""",
        ),
        "portableSettings": parse_json_fields(
            rows(
                database,
                """SELECT key, value_json AS value
                FROM portable_settings ORDER BY key""",
            ),
            ("value",),
        ),
    }


def normalize_assets(database: sqlite3.Connection) -> list[dict[str, Any]]:
    return rows(
        database,
        """SELECT id, kind, media_type AS mediaType, byte_count AS byteCount,
        sha256, archive_path AS archivePath, availability,
        unavailable_reason AS unavailableReason, source_url AS sourceUrl,
        width, height, alt_text AS altText FROM assets ORDER BY id""",
    )


def verify_fixture(bundle: Path, fixture_name: str, expectations: dict[str, Any]) -> None:
    archive_path = bundle / "fixtures" / fixture_name
    fixture_expectations = expectations["fixtures"][fixture_name]
    with tempfile.TemporaryDirectory(prefix="cyd-bluesky-v2-") as extracted:
        with zipfile.ZipFile(archive_path) as archive:
            archive.extractall(extracted)
            entries = {
                info.filename: archive.read(info)
                for info in archive.infolist()
                if not info.is_dir()
            }

        metadata = json.loads(entries["metadata.json"])
        assert {
            key: metadata[key] for key in ("format", "platform", "version")
        } == expectations["archiveFormat"]

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
            assert normalize_semantics(database) == expectations["commonSemantics"]
            assert normalize_assets(database) == fixture_expectations["assets"]
            completeness = database.execute(
                "SELECT completeness FROM archive"
            ).fetchone()[0]
            assert completeness == fixture_expectations["completeness"]
        finally:
            database.close()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="cyd-contract-") as directory:
        bundle = Path(directory)
        download_bundle(bundle)
        expectations = json.loads(
            (bundle / "fixtures/semantic-expectations.json").read_text(
                encoding="utf-8"
            )
        )
        version_behavior = expectations["desktopBlueskyVersionBehavior"]
        assert {
            key: version_behavior[key]
            for key in (
                "unversionedV1",
                "blueskyV2Import",
                "otherPlatform",
                "newerVersion",
            )
        } == {
            "unversionedV1": "reject_unsupported_legacy_format",
            "blueskyV2Import": "accept",
            "otherPlatform": "reject_unsupported_archive_platform",
            "newerVersion": "reject_unsupported_newer_version",
        }
        verify_fixture(bundle, "complete.cyd", expectations)
        verify_fixture(bundle, "incomplete.cyd", expectations)
    print(f"Canonical Bluesky archive semantics match {PIN['commit']}.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""The Cyd Bluesky archive v2 conformance matrix, run as one gate.

Issue #100 does not ask for more tests. It asks for a *matrix*: a named list of
the things a Cyd Bluesky archive has to do for Mobile's writer to be safe to
turn on, each one tied to the test that proves it, failing loudly when a row
has nothing behind it any more.

That last part is what this file is for. Evidence spread across eighty test
files is evidence nobody can audit: a test renamed in good faith silently
un-proves a release gate, and nothing notices. So the rows below name their
evidence by test name, the whole suite is run once, and a row whose tests have
gone missing fails exactly as loudly as a row whose tests went red.

Three things run here:

  * Mobile's own suite, including the contract-gated suites that only run with
    a pinned bundle downloaded (`archive-contract-bundle`, `-exchange`).
  * `conformance.py` over archives *Mobile's writer produced* — the committed
    real-data fixtures, and the archive the round-trip test writes from a
    canonical Desktop one. Mobile checking its own output against its own
    reader would prove nothing; this checks it against the pinned contract.
  * `self_test.py`, so the checker doing that is known to still reject the
    archives it should.

Usage:
    matrix.py            # run the whole matrix
    matrix.py --list     # print the rows without running anything
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import bundle
import conformance
import self_test
import test_bundle


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
COMMITTED_FIXTURES = (
    REPOSITORY_ROOT / "testUtils/fixtures/bluesky-archive/complete.cyd",
    REPOSITORY_ROOT / "testUtils/fixtures/bluesky-archive/incomplete.cyd",
)


@dataclass(frozen=True)
class Jest:
    """One or more Jest tests, named by the file and part of the test name."""

    file: str
    name: str


@dataclass(frozen=True)
class Check:
    """A check this script runs itself, by key."""

    key: str


@dataclass(frozen=True)
class Row:
    key: str
    what: str
    evidence: tuple[Jest | Check, ...]


@dataclass
class Outcome:
    passed: int = 0
    problems: list[str] = field(default_factory=list)


#: The matrix. Every acceptance criterion of #100 is a section here.
MATRIX: tuple[tuple[str, tuple[Row, ...]], ...] = (
    (
        "Bidirectional exchange, by normalized semantic comparison",
        (
            Row(
                "desktop-to-mobile",
                "A canonical Desktop archive becomes a browseable local account",
                (
                    Jest("archive-contract-bundle", "normalizes"),
                    Jest("archive-contract-bundle", "streaming intake"),
                    Jest("archive-contract-exchange", "restored by Mobile"),
                ),
            ),
            Row(
                "mobile-to-desktop",
                "What Mobile writes still says what Desktop wrote, and conforms",
                (
                    Jest("archive-contract-exchange", "rewritten by Mobile"),
                    Check("mobile-writer-conformance"),
                ),
            ),
            Row(
                "declared-losses",
                "Every loss a Mobile round trip causes is a declared loss",
                (Jest("archive-contract-exchange", "loses, on purpose"),),
            ),
            Row(
                "pinned-schema",
                "Mobile's embedded interchange schema is the pinned one",
                (Jest("archive-contract-bundle", "character for character"),),
            ),
        ),
    ),
    (
        "Matrix coverage",
        (
            Row(
                "record-categories",
                "Posts, replies, quotes, reposts, likes, bookmarks, chats, follows",
                (
                    Jest("archive-export/__tests__/interchange", "repost"),
                    Jest("archive-export/__tests__/interchange", "like"),
                    Jest("archive-export/__tests__/interchange", "bookmark"),
                    Jest("archive-export/__tests__/interchange", "conversation"),
                    Jest("archive-export/__tests__/interchange", "follows"),
                    Jest("archive-export/__tests__/interchange", "reply parent"),
                    Jest("archive-restore/__tests__/mobile-rows", "restores"),
                    Jest("archive-contract-exchange", "every category"),
                ),
            ),
            Row(
                "identity-mapping",
                "DID matching, handle changes, UUID preservation and remapping",
                (
                    Jest("archive-merge/__tests__/destination", "DID"),
                    Jest("archive-restore/__tests__/identity", "UUID"),
                    Jest("archive-contract-exchange", "renamed handle"),
                ),
            ),
            Row(
                "repeated-import",
                "Importing the same archive twice has no further effect",
                (
                    Jest("archive-merge/__tests__/merge", "second time"),
                    Jest("archive-contract-exchange", "changes nothing the second"),
                ),
            ),
            Row(
                "mixed-device-merge",
                "Two devices' observations become a union, not a replacement",
                (
                    Jest("archive-merge/__tests__/merge-plan", "newer observation"),
                    Jest("archive-merge/__tests__/merge-plan", "quieter archive"),
                    Jest("archive-merge/__tests__/merge-plan", "says nothing about"),
                    Jest("archive-contract-exchange", "could not carry"),
                ),
            ),
            Row(
                "settings-behavior",
                "Existing settings win; archive settings are defaults for new accounts",
                (
                    Jest("archive-merge/__tests__/merge", "own identifier, settings"),
                    Jest("archive-restore/__tests__/restore", "defaults"),
                    Jest("archive-contract-exchange", "save and delete defaults"),
                ),
            ),
            Row(
                "media-deduplication",
                "An asset is stored once per account and packaged once per archive",
                (
                    Jest("archive-export/__tests__/export", "exactly once"),
                    Jest("archive-export/__tests__/interchange", "repeated asset"),
                    Jest("archive-restore/__tests__/restore", "once, content-addressably"),
                    Jest("archive-contract-exchange", "once, content-addressably"),
                ),
            ),
            Row(
                "offline-browsing",
                "Restored media renders from local files with no network",
                (
                    Jest("archive-restore/__tests__/restore", "without a network"),
                    Jest("archive-contract-exchange", "with no network"),
                ),
            ),
            Row(
                "completeness",
                "A structurally valid archive is not the same as a complete backup",
                (
                    Jest("archive-export/__tests__/export", "never finished downloading"),
                    Jest("archive-restore/__tests__/restore", "missing asset explicit"),
                    Jest("archive-contract-exchange", "backup is complete"),
                ),
            ),
        ),
    ),
    (
        "Adversarial and lifecycle cases",
        (
            Row(
                "integrity",
                "Traversal, symlinks, forged manifests, bad digests, entry limits",
                (
                    Jest("archive-import/__tests__/intake", "not safe to unpack"),
                    Jest("archive-import/__tests__/zip-reader", "rejects"),
                    Jest("archive-import/__tests__/entry-paths", "rejects"),
                    Jest("archive-import/__tests__/intake", "resource limits"),
                    Check("checker-self-test"),
                ),
            ),
            Row(
                "unsupported-version",
                "The prototype, a newer version, and another platform are refused",
                (
                    Jest("archive-metadata", "rejects"),
                    Jest("archive-contract-bundle", "version rejection"),
                ),
            ),
            Row(
                "termination-restart",
                "Import and export resume from their checkpoints on next launch",
                (
                    Jest("archive-import/__tests__/intake", "surviving termination"),
                    Jest("archive-export/__tests__/export-resume", "interrupted run staged"),
                    Jest("hooks/__tests__/use-bluesky-archive-export", "earlier launch left"),
                ),
            ),
            Row(
                "cleanup",
                "Cancellation, failure and delivery all leave no staging behind",
                (
                    Jest("archive-import/__tests__/intake", "cancellation"),
                    Jest("archive-export/__tests__/export-resume", "walks away"),
                    Jest("hooks/__tests__/use-bluesky-archive-export", "keeps nothing staged"),
                    Jest("hooks/__tests__/use-bluesky-archive-import", "nothing on screen or in staging"),
                    Jest("archive-restore/__tests__/restore", "no trace"),
                ),
            ),
            Row(
                "point-in-time-snapshot",
                "The exported database and asset inventory describe one moment",
                (
                    Jest("archive-export/__tests__/export", "one point in time"),
                    Jest("archive-export/__tests__/export-resume", "at the moment it staged it"),
                ),
            ),
            Row(
                "credential-exclusion",
                "No credentials, jobs, schedules or local paths reach an archive",
                (
                    Jest("archive-export/__tests__/export", "no credentials"),
                    Jest("archive-export/__tests__/interchange", "private storage"),
                    Jest("archive-contract-exchange", "no credentials"),
                    Jest("archive-restore/__tests__/restore", "no credentials"),
                ),
            ),
            Row(
                "device-backup",
                "Committed account data is backup-eligible; staging is excluded",
                (
                    Jest("device-storage", "backup"),
                    Jest("android-backup-rules", "staging out of every backup"),
                    Jest("app-config", "backup"),
                ),
            ),
            Row(
                "entitlement",
                "Export, import and offline browsing need no premium subscription",
                (
                    Jest("BlueskyArchiveExportModal", "no Cyd account signed in"),
                    Jest("use-bluesky-archive-import", "no Cyd account signed in"),
                    Jest("archive-entitlement", "never asks"),
                ),
            ),
        ),
    ),
)


def run_jest(contract_root: Path, round_trip_output: Path) -> dict:
    """Mobile's whole suite, as JSON, with the contract-gated suites enabled."""
    with tempfile.NamedTemporaryFile(
        prefix="cyd-matrix-", suffix=".json", delete=False
    ) as handle:
        report = Path(handle.name)
    try:
        subprocess.run(
            ["npx", "jest", "--runInBand", "--json", f"--outputFile={report}"],
            cwd=REPOSITORY_ROOT,
            check=False,
            env={
                **os.environ,
                "CYD_BLUESKY_CONTRACT_ROOT": str(contract_root),
                "CYD_BLUESKY_ROUND_TRIP_OUT": str(round_trip_output),
            },
        )
        return json.loads(report.read_text(encoding="utf-8"))
    finally:
        report.unlink(missing_ok=True)


def jest_results(report: dict) -> list[tuple[str, str, str]]:
    """(file, full test name, status) for every test that ran."""
    results = []
    for suite in report.get("testResults", []):
        path = str(Path(suite["name"]).relative_to(REPOSITORY_ROOT))
        for assertion in suite.get("assertionResults", []):
            results.append((path, assertion["fullName"], assertion["status"]))
    return results


def check_mobile_writer_conformance(
    schema_sql: str, round_trip_output: Path
) -> Outcome:
    """Every archive Mobile's own writer produced, against the pinned contract."""
    outcome = Outcome()
    archives = [*COMMITTED_FIXTURES, *sorted(round_trip_output.glob("*.cyd"))]
    if not any(path.parent == round_trip_output for path in archives):
        outcome.problems.append(
            "the round-trip test wrote no archive; did its suite run?"
        )
    for archive in archives:
        failures = conformance.check_archive(archive, schema_sql)
        if failures:
            outcome.problems.append(f"{archive.name}: {failures[0]}")
        else:
            outcome.passed += 1
    return outcome


def check_checker_self_test(schema_sql: str, work: Path) -> Outcome:
    """The conformance checker still rejects every archive it should."""
    import zipfile

    outcome = Outcome()
    source = work / "fixtures" / "complete.cyd"
    with zipfile.ZipFile(source) as archive:
        original = {
            info.filename: archive.read(info)
            for info in archive.infolist()
            if not info.is_dir()
        }

    for label, mutate, reseal in self_test.cases(work):
        target = work / "matrix-case.cyd"
        target.unlink(missing_ok=True)
        self_test.seal(source, target, mutate(dict(original)), reseal)
        if conformance.check_archive(target, schema_sql):
            outcome.passed += 1
        else:
            outcome.problems.append(f"accepted an archive it should reject: {label}")
    return outcome


def evaluate(row: Row, results: list[tuple[str, str, str]], checks: dict[str, Outcome]) -> Outcome:
    outcome = Outcome()
    for evidence in row.evidence:
        if isinstance(evidence, Check):
            found = checks[evidence.key]
            outcome.passed += found.passed
            outcome.problems.extend(found.problems)
            continue

        matched = [
            (name, status)
            for path, name, status in results
            if evidence.file in path and evidence.name in name
        ]
        if not matched:
            outcome.problems.append(
                f"no test in *{evidence.file}* named like {evidence.name!r}"
            )
            continue
        for name, status in matched:
            if status == "passed":
                outcome.passed += 1
            else:
                outcome.problems.append(f"{status}: {name}")
    return outcome


def print_matrix() -> None:
    for section, rows in MATRIX:
        print(f"\n{section}")
        for row in rows:
            print(f"  {row.key:<24} {row.what}")


def main() -> int:
    if "--list" in sys.argv[1:]:
        print_matrix()
        return 0

    with tempfile.TemporaryDirectory(prefix="cyd-matrix-") as directory:
        work = Path(directory)
        contract_root = work / "bundle"
        round_trip_output = work / "round-trip"
        round_trip_output.mkdir(parents=True)

        bundle.download(test_bundle.FILES, contract_root)
        for fixture in ("complete.cyd", "incomplete.cyd"):
            test_bundle.prepare_fixture(contract_root, fixture)
        schema_sql = (contract_root / "schema.sql").read_text(encoding="utf-8")

        report = run_jest(contract_root, round_trip_output)
        results = jest_results(report)
        checks = {
            "mobile-writer-conformance": check_mobile_writer_conformance(
                schema_sql, round_trip_output
            ),
            "checker-self-test": check_checker_self_test(schema_sql, contract_root),
        }

    failed = 0
    for section, rows in MATRIX:
        print(f"\n{section}")
        for row in rows:
            outcome = evaluate(row, results, checks)
            if outcome.problems:
                failed += 1
                print(f"  FAIL  {row.key:<24} {row.what}")
                for problem in outcome.problems:
                    print(f"          - {problem}")
            else:
                print(f"  ok    {row.key:<24} {row.what}  ({outcome.passed})")

    total = sum(len(rows) for _, rows in MATRIX)
    if failed:
        print(
            f"\n{failed} of {total} matrix rows are unproven. "
            "Cyd Mobile does not conform to the pinned Cyd Bluesky archive v2 "
            "contract, and its writer must not be enabled."
        )
        return 1
    print(
        f"\nAll {total} matrix rows pass against the canonical Cyd Bluesky "
        f"archive v2 contract pinned at {bundle.PIN['commit']}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

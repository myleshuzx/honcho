#!/usr/bin/env python3
"""Import daily markdown diary files into Honcho with created_at from filename."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timezone
from pathlib import Path
from typing import Any


FILENAME_RE = re.compile(r"^(?P<date>\d{4}-\d{2}-\d{2})-(?P<weekday>[A-Za-z]+)\.md$")
MAX_BATCH_SIZE = 100


@dataclass(frozen=True)
class DiaryEntry:
    path: Path
    diary_date: date
    created_at: str
    content: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import ~/diary_ok/*.md diary files into Honcho."
    )
    parser.add_argument(
        "--diary-dir",
        default=os.environ.get("DIARY_DIR", "~/diary_ok"),
        help="Directory containing YYYY-MM-DD-Weekday.md files.",
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("HONCHO_API_BASE", "http://127.0.0.1:8000/v3"),
        help="Honcho API base URL.",
    )
    parser.add_argument(
        "--workspace",
        default=os.environ.get("HONCHO_WORKSPACE", "honcho-local-ajimi-zh-v3"),
        help="Honcho workspace name.",
    )
    parser.add_argument(
        "--session",
        default=os.environ.get("HONCHO_SESSION", "diary-import"),
        help="Honcho session name.",
    )
    parser.add_argument(
        "--peer",
        default=os.environ.get("HONCHO_PEER", "huzhuoxian"),
        help="Peer ID used as message author.",
    )
    parser.add_argument(
        "--created-time",
        default=os.environ.get("DIARY_CREATED_TIME", "12:00:00"),
        help="UTC clock time to use with the date from each filename.",
    )
    parser.add_argument(
        "--state-file",
        default=os.environ.get("DIARY_IMPORT_STATE", "~/script/diary_import_state.json"),
        help="JSON state file recording successfully imported filenames.",
    )
    parser.add_argument(
        "--since",
        help="Only import diary files on or after this date, YYYY-MM-DD.",
    )
    parser.add_argument(
        "--until",
        help="Only import diary files on or before this date, YYYY-MM-DD.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Import at most this many files after filtering.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=20,
        help="Messages per API request, max 100.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore state file and import matching files again.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be imported without calling the API.",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.2,
        help="Seconds to sleep between API requests.",
    )
    return parser.parse_args()


def parse_date_arg(value: str | None, name: str) -> date | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise SystemExit(f"{name} must be YYYY-MM-DD, got: {value}") from None


def parse_created_time(value: str) -> dt_time:
    try:
        parsed = dt_time.fromisoformat(value)
    except ValueError:
        raise SystemExit(f"--created-time must be HH:MM[:SS], got: {value}") from None
    if parsed.tzinfo is not None:
        raise SystemExit("--created-time should be a UTC clock time without timezone")
    return parsed


def load_state(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"State file is not valid JSON: {path}: {exc}") from None
    imported = data.get("imported", [])
    if not isinstance(imported, list):
        raise SystemExit(f"State file has invalid 'imported' field: {path}")
    return {str(item) for item in imported}


def save_state(path: Path, imported: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"imported": sorted(imported)}
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def iter_diary_entries(
    diary_dir: Path,
    *,
    created_clock: dt_time,
    since: date | None,
    until: date | None,
) -> list[DiaryEntry]:
    entries: list[DiaryEntry] = []
    if not diary_dir.exists():
        raise SystemExit(f"Diary directory does not exist: {diary_dir}")
    if not diary_dir.is_dir():
        raise SystemExit(f"Diary path is not a directory: {diary_dir}")

    for path in sorted(diary_dir.glob("*.md")):
        match = FILENAME_RE.match(path.name)
        if not match:
            print(f"skip: filename does not match YYYY-MM-DD-Weekday.md: {path.name}")
            continue

        diary_date = date.fromisoformat(match.group("date"))
        expected_weekday = diary_date.strftime("%A")
        if match.group("weekday") != expected_weekday:
            print(
                "warn: weekday mismatch for "
                f"{path.name}: expected {expected_weekday}"
            )

        if since and diary_date < since:
            continue
        if until and diary_date > until:
            continue

        content = path.read_text(encoding="utf-8").strip()
        if not content:
            print(f"skip: empty diary file: {path.name}")
            continue

        created = datetime.combine(
            diary_date, created_clock, tzinfo=timezone.utc
        ).isoformat().replace("+00:00", "Z")
        entries.append(
            DiaryEntry(
                path=path,
                diary_date=diary_date,
                created_at=created,
                content=content,
            )
        )

    return entries


def chunks(items: list[DiaryEntry], size: int) -> list[list[DiaryEntry]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def post_json(url: str, payload: dict[str, Any]) -> Any:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Failed to connect to {url}: {exc}") from exc


def import_batch(
    *,
    api_base: str,
    workspace: str,
    session: str,
    peer: str,
    entries: list[DiaryEntry],
) -> None:
    api_base = api_base.rstrip("/")
    url = f"{api_base}/workspaces/{workspace}/sessions/{session}/messages"
    payload = {
        "messages": [
            {
                "peer_id": peer,
                "content": entry.content,
                "created_at": entry.created_at,
                "metadata": {
                    "source": "diary_ok",
                    "filename": entry.path.name,
                    "diary_date": entry.diary_date.isoformat(),
                },
            }
            for entry in entries
        ]
    }
    post_json(url, payload)


def main() -> int:
    args = parse_args()
    batch_size = min(max(args.batch_size, 1), MAX_BATCH_SIZE)
    diary_dir = Path(args.diary_dir).expanduser()
    state_file = Path(args.state_file).expanduser()
    since = parse_date_arg(args.since, "--since")
    until = parse_date_arg(args.until, "--until")
    created_clock = parse_created_time(args.created_time)

    imported = load_state(state_file)
    entries = iter_diary_entries(
        diary_dir,
        created_clock=created_clock,
        since=since,
        until=until,
    )
    if not args.force:
        entries = [entry for entry in entries if entry.path.name not in imported]
    if args.limit is not None:
        entries = entries[: max(args.limit, 0)]

    print(f"diary_dir: {diary_dir}")
    print(f"api_base: {args.api_base}")
    print(f"workspace/session/peer: {args.workspace}/{args.session}/{args.peer}")
    print(f"pending files: {len(entries)}")

    if not entries:
        return 0

    print(f"first: {entries[0].path.name} -> {entries[0].created_at}")
    print(f"last:  {entries[-1].path.name} -> {entries[-1].created_at}")

    if args.dry_run:
        for entry in entries[:20]:
            print(f"dry-run: {entry.path.name} -> {entry.created_at}")
        if len(entries) > 20:
            print(f"dry-run: ... {len(entries) - 20} more")
        return 0

    completed = 0
    for batch in chunks(entries, batch_size):
        import_batch(
            api_base=args.api_base,
            workspace=args.workspace,
            session=args.session,
            peer=args.peer,
            entries=batch,
        )
        imported.update(entry.path.name for entry in batch)
        save_state(state_file, imported)
        completed += len(batch)
        print(f"imported {completed}/{len(entries)}")
        if args.sleep > 0:
            time.sleep(args.sleep)

    print(f"done. state_file: {state_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

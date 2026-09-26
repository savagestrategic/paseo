#!/usr/bin/env python3
"""Locate one local Paseo conversation without starting a provider or writing state."""
import argparse
import json
import re
from pathlib import Path


def locate(agent_id: str, paseo_home: Path, kimi_homes: list[Path]) -> dict:
    if not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", agent_id):
        raise ValueError("Provide a Paseo agent UUID, not a provider-native session ID")
    records = list((paseo_home / "agents").glob(f"*/{agent_id}.json"))
    direct = paseo_home / "agents" / f"{agent_id}.json"
    if direct.is_file():
        records.append(direct)
    if len(records) != 1:
        raise ValueError(f"Expected one saved agent on this daemon; found {len(records)}")
    record = json.loads(records[0].read_text())
    if record.get("id") != agent_id:
        raise ValueError("Saved record ID does not match")
    handle = record.get("persistence") or {}
    session_id = handle.get("sessionId")
    result = {key: record.get(key) for key in ("id", "title", "provider", "cwd", "workspaceId", "owner", "lastStatus", "updatedAt")}
    result.update(metadata_path=str(records[0]), native_session_id=session_id, live_status="unverified", continuation_transcripts=[], native_transcripts=[])
    for archive in record.get("continuations", []):
        path = Path(archive)
        result["continuation_transcripts"].append({"path": str(path), "exists": path.is_file()})
    if str(record.get("provider", "")).startswith("kimi") and session_id:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", session_id):
            raise ValueError("Invalid saved native session ID")
        for home in kimi_homes:
            for state_path in (home / "sessions").glob(f"*/{session_id}/state.json"):
                state = json.loads(state_path.read_text())
                if state.get("id") != session_id or state.get("cwd") != record.get("cwd"):
                    continue
                result["native_transcripts"].append({"profile_home": str(home), "state_path": str(state_path), "files": [str(p) for p in sorted(state_path.parent.glob("agents/*/wire.jsonl"))]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("agent_id")
    parser.add_argument("--home", type=Path, default=Path.home() / ".paseo")
    parser.add_argument("--kimi-home", action="append", type=Path, help="Exact local Kimi home; repeat for isolated profiles")
    args = parser.parse_args()
    homes = args.kimi_home or [Path.home() / ".kimi-code", *sorted((Path.home() / ".kimi-code-profiles").glob("*"))]
    try:
        print(json.dumps(locate(args.agent_id, args.home.expanduser(), homes), indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f"Recovery lookup failed: {error}\n")


if __name__ == "__main__":
    main()

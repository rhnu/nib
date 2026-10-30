"""Classify CI changes and fingerprint the tracked inputs consumed by the Web build."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess


def git(*arguments: str) -> bytes:
    return subprocess.check_output(["git", *arguments], stderr=subprocess.PIPE)


def documentation(path: str) -> bool:
    file = PurePosixPath(path)
    return (
        path.startswith("docs/")
        or (len(file.parts) == 1 and (file.suffix.lower() == ".md" or file.name in {"LICENSE", "LICENSE.txt", "LICENSE-MIT", "LICENSE-APACHE"}))
        or path.startswith(".github/ISSUE_TEMPLATE/")
        or path == ".github/PULL_REQUEST_TEMPLATE.md"
    )


def software_changed(event_name: str, event, head: str) -> bool:
    if event_name == "pull_request":
        base = event.get("pull_request", {}).get("base", {}).get("sha")
    elif event_name == "push":
        base = event.get("before")
    else:
        return True
    if not base or set(base) == {"0"}:
        return True
    try:
        # A move from software into docs still removes a software input.
        paths = git("diff", "--no-renames", "--name-only", "-z", base, head).decode("utf-8").split("\0")
    except (subprocess.CalledProcessError, UnicodeDecodeError):
        print("Change base unavailable; checking all software")
        return True
    return any(path and not documentation(path) for path in paths)


def web_input(path: str) -> bool:
    if path.startswith(("apps/desktop/src/", "apps/desktop/public/", ".cargo/", ".github/actions/")):
        return True
    if path.startswith("apps/desktop/"):
        relative = path.removeprefix("apps/desktop/")
        return not relative.startswith("src-tauri/") and not documentation(relative)
    for directory in ("xtask/", "modules/prompt/"):
        if path.startswith(directory):
            return not documentation(path.removeprefix(directory))
    if "/" not in path:
        # Unknown root configuration can affect tool resolution or compilation.
        return not documentation(path)
    return path in {".github/workflows/ci.yml", ".github/scripts/ci-inputs.py"}


def web_fingerprint() -> str:
    paths = sorted(path for path in git("ls-files", "-z").decode("utf-8").split("\0") if path and web_input(path))
    if not paths:
        raise ValueError("No tracked Web build inputs found")
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.encode("utf-8") + b"\0")
        # Hash each file separately so concatenated bytes cannot hide file boundaries.
        digest.update(hashlib.sha256(Path(path).read_bytes()).digest())
    return digest.hexdigest()


def emit(values) -> None:
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n")
            print(f"{key}={value}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("changes", "web-fingerprint"))
    args = parser.parse_args()
    if args.command == "changes":
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
        changed = str(software_changed(os.environ["GITHUB_EVENT_NAME"], event, os.environ["GITHUB_SHA"])).lower()
        emit({"software": changed, "web": changed, "native": changed})
    else:
        emit({"fingerprint": web_fingerprint()})


if __name__ == "__main__":
    main()

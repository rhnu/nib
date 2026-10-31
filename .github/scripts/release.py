"""Publish a checked application installer and Tauri update manifest for an existing version tag."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tomllib
from urllib.parse import quote


def stable_version(tag: str) -> tuple[int, int, int] | None:
    match = re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", tag)
    return tuple(map(int, match.groups())) if match else None


def validate() -> tuple[str, str]:
    tag = os.environ["GITHUB_REF_NAME"]
    version = tomllib.loads(Path("Cargo.toml").read_text(encoding="utf-8"))["workspace"]["package"]["version"]
    if stable_version(tag) is None or tag != f"v{version}":
        raise ValueError("Release tags must be stable vMAJOR.MINOR.PATCH and exactly match workspace.package.version")
    return tag, version


def gh(*arguments: str) -> str:
    return subprocess.check_output(["gh", *arguments], text=True)


def api(path: str):
    return json.loads(gh("api", path))


def releases(repository: str) -> list[dict]:
    pages = json.loads(gh("api", "--paginate", "--slurp", f"repos/{repository}/releases?per_page=100"))
    return [release for page in pages for release in page]


def release_for_tag(candidates: list[dict], tag: str) -> dict | None:
    return next((release for release in candidates if release["tag_name"] == tag), None)


def update_manifest(version: str, repository: str, tag: str, installer: str, signature: str, notes: str, published_at: str) -> dict:
    return {
        "version": version,
        "notes": notes,
        "pub_date": published_at,
        "platforms": {
            "windows-x86_64": {
                "url": f"https://github.com/{repository}/releases/download/{quote(tag, safe='')}/{quote(installer, safe='')}",
                "signature": signature,
            },
        },
    }


def publish(assets: Path) -> None:
    tag, version = validate()
    repository = os.environ["GITHUB_REPOSITORY"]
    installers = list(assets.glob("*-setup.exe"))
    if len(installers) != 1 or installers[0].stat().st_size == 0:
        raise ValueError("Expected one nonempty Windows NSIS installer")
    installer = installers[0]
    signature_path = installer.with_suffix(installer.suffix + ".sig")
    signature = signature_path.read_text(encoding="utf-8").strip()
    if not signature:
        raise ValueError("The installer signature is empty")
    manifest_path = assets / "latest.json"
    expected_names = {installer.name, signature_path.name, manifest_path.name}
    # The tag endpoint only returns published releases. Lists also include our writable drafts.
    candidates = releases(repository)
    release = release_for_tag(candidates, tag)
    if release and not release["draft"]:
        if not expected_names.issubset({asset["name"] for asset in release["assets"]}):
            raise ValueError("An incomplete release is already public; published release assets must not be replaced")
        print(f"Release {tag} is already published; leaving its assets unchanged")
        return

    # Use the preceding application tag, excluding independently published resource releases.
    published = [release for release in candidates if not release["draft"] and not release["prerelease"] and stable_version(release["tag_name"]) is not None]
    preceding = [release for release in published if stable_version(release["tag_name"]) < stable_version(tag)]
    previous = max(preceding, key=lambda item: stable_version(item["tag_name"]), default=None)
    arguments = ["api", f"repos/{repository}/releases/generate-notes", "-f", f"tag_name={tag}"]
    if previous:
        arguments.extend(["-f", f"previous_tag_name={previous['tag_name']}"])
    notes = json.loads(gh(*arguments))["body"] if previous else "Initial Windows x64 release."
    notes_path = assets / "release-notes.md"
    notes_path.write_text(notes, encoding="utf-8")
    manifest_path.write_text(json.dumps(update_manifest(version, repository, tag, installer.name, signature, notes, datetime.now(timezone.utc).isoformat()), indent=2) + "\n", encoding="utf-8")
    if not release:
        gh("release", "create", tag, "--repo", repository, "--verify-tag", "--draft", "--latest=false", "--title", f"nib {version}", "--notes-file", str(notes_path))
        release = release_for_tag(releases(repository), tag)
        if release is None:
            raise ValueError("The newly created draft release is missing")
    else:
        gh("release", "edit", tag, "--repo", repository, "--notes-file", str(notes_path))
    gh("release", "upload", tag, str(installer), str(signature_path), str(manifest_path), "--repo", repository, "--clobber")
    uploaded = api(f"repos/{repository}/releases/{release['id']}")
    actual = {asset["name"]: asset for asset in uploaded["assets"]}
    for path in (installer, signature_path, manifest_path):
        if path.name not in actual or actual[path.name]["size"] != path.stat().st_size:
            raise ValueError(f"Release asset was not uploaded completely: {path.name}")
    promote = not published or stable_version(tag) > max(stable_version(item["tag_name"]) for item in published)
    gh("release", "edit", tag, "--repo", repository, "--draft=false", f"--latest={'true' if promote else 'false'}")
    # The publish job is serialized across tags, so an older backfill cannot replace the latest app.
    if promote:
        latest = api(f"repos/{repository}/releases/latest")
        if latest["tag_name"] != tag:
            raise ValueError("The latest release does not point to the newly published application")
    print(f"Published nib {version}: https://github.com/{repository}/releases/tag/{tag}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("validate", "publish"))
    parser.add_argument("--assets", type=Path, default=Path("release-assets"))
    args = parser.parse_args()
    if args.command == "validate":
        tag, _ = validate()
        print(f"Validated application tag {tag}")
    else:
        publish(args.assets)


if __name__ == "__main__":
    main()

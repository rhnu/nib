"""Prepare application release metadata and verify the draft before publishing by ID."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
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
    matches = [release for release in candidates if release["tag_name"] == tag]
    if len(matches) > 1:
        raise ValueError(f"Multiple releases exist for {tag}; resolve duplicates before publishing")
    return next(iter(matches), None)


def application_releases(candidates: list[dict]) -> list[dict]:
    return [release for release in candidates if not release["draft"] and not release["prerelease"] and stable_version(release["tag_name"]) is not None]


def previous_application_release(candidates: list[dict], tag: str) -> dict | None:
    preceding = [release for release in application_releases(candidates) if stable_version(release["tag_name"]) < stable_version(tag)]
    return max(preceding, key=lambda release: stable_version(release["tag_name"]), default=None)


def should_promote(candidates: list[dict], tag: str) -> bool:
    return all(stable_version(tag) >= stable_version(release["tag_name"]) for release in application_releases(candidates))


def verify_assets(actual: list[dict], expected: dict[str, tuple[int, str]]) -> None:
    uploaded = {asset["name"]: asset for asset in actual}
    for name, (size, digest) in expected.items():
        asset = uploaded.get(name)
        if not asset or asset["state"] != "uploaded" or asset["size"] != size or asset.get("digest") != digest:
            raise ValueError(f"Release asset does not match the checked artifact: {name}")


def emit(values: dict[str, str]) -> None:
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n")
            print(f"{key}={value}")


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


def release_files(assets: Path) -> tuple[Path, Path, Path]:
    """Require the signed NSIS bundle produced by the checked desktop job."""
    installers = list(assets.glob("*-setup.exe"))
    if len(installers) != 1 or installers[0].stat().st_size == 0:
        raise ValueError("Expected one nonempty Windows NSIS installer")
    installer = installers[0]
    signature_path = installer.with_suffix(installer.suffix + ".sig")
    signature = signature_path.read_text(encoding="utf-8").strip()
    if not signature:
        raise ValueError("The installer signature is empty")
    return installer, signature_path, assets / "latest.json"


def prepare(assets: Path) -> None:
    tag, version = validate()
    repository = os.environ["GITHUB_REPOSITORY"]
    installer, signature_path, manifest_path = release_files(assets)
    candidates = releases(repository)
    release = release_for_tag(candidates, tag)
    if release and not release["draft"]:
        complete = {asset["name"] for asset in release["assets"] if asset["state"] == "uploaded" and asset["size"] > 0}
        if release["prerelease"] or not {installer.name, signature_path.name, manifest_path.name}.issubset(complete):
            raise ValueError("An incomplete release is already public; published release assets must not be replaced")
        print(f"Release {tag} is already published; leaving its assets unchanged")
        emit({"publish": "false"})
        return

    # Use the preceding application tag, excluding independently published resource releases.
    previous = previous_application_release(candidates, tag)
    arguments = ["api", f"repos/{repository}/releases/generate-notes", "-f", f"tag_name={tag}"]
    if previous:
        arguments.extend(["-f", f"previous_tag_name={previous['tag_name']}"])
    notes = json.loads(gh(*arguments))["body"] if previous else "Initial Windows x64 release."
    notes_path = assets / "release-notes.md"
    notes_path.write_text(notes, encoding="utf-8")
    signature = signature_path.read_text(encoding="utf-8").strip()
    manifest_path.write_text(json.dumps(update_manifest(version, repository, tag, installer.name, signature, notes, datetime.now(timezone.utc).isoformat()), indent=2) + "\n", encoding="utf-8")
    emit({"publish": "true", "version": version})


def finalize(assets: Path, release_id: int) -> None:
    """Use the Action's returned ID instead of rediscovering a newly created draft."""
    tag, version = validate()
    repository = os.environ["GITHUB_REPOSITORY"]
    paths = release_files(assets)
    expected = {path.name: (path.stat().st_size, f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}") for path in paths}
    endpoint = f"repos/{repository}/releases/{release_id}"
    release = api(endpoint)
    if release["tag_name"] != tag or release["prerelease"] or not release["draft"]:
        raise ValueError(f"Expected the writable application draft for {tag}, got release {release_id}")
    # Query assets by ID as well; never depend on draft visibility in the tag/list endpoints.
    pages = json.loads(gh("api", "--paginate", "--slurp", f"{endpoint}/assets?per_page=100"))
    verify_assets([asset for page in pages for asset in page], expected)
    promote = should_promote(releases(repository), tag)
    published = json.loads(gh("api", "--method", "PATCH", endpoint, "-F", "draft=false", "-f", f"make_latest={'true' if promote else 'false'}"))
    if published["draft"] or published["tag_name"] != tag:
        raise ValueError(f"Release {release_id} was not published as {tag}")
    # The publish job is serialized across tags, so an older backfill cannot replace the latest app.
    if promote:
        latest = api(f"repos/{repository}/releases/latest")
        if latest["tag_name"] != tag:
            raise ValueError("The latest release does not point to the newly published application")
    print(f"Published nib {version}: https://github.com/{repository}/releases/tag/{tag}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("validate", "prepare", "finalize"))
    parser.add_argument("--assets", type=Path, default=Path("release-assets"))
    parser.add_argument("--release-id", type=int)
    args = parser.parse_args()
    if args.command == "validate":
        tag, _ = validate()
        print(f"Validated application tag {tag}")
    elif args.command == "prepare":
        prepare(args.assets)
    elif args.release_id is None:
        parser.error("finalize requires --release-id from the release Action")
    else:
        finalize(args.assets, args.release_id)


if __name__ == "__main__":
    main()

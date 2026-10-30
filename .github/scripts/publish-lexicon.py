"""Publish a verified resource candidate with resumable immutable asset uploads."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request


def api(path: str):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GH_REPO']}/{path}",
        headers={
            "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def gh(*arguments: str) -> None:
    subprocess.run(["gh", *arguments], check=True)


def find_release(version: str):
    release = api(f"releases/tags/{urllib.parse.quote(version, safe='')}")
    if release is not None:
        return release
    # The list endpoint explicitly includes drafts for callers with push access.
    page = 1
    while releases := api(f"releases?per_page=100&page={page}"):
        for release in releases:
            if release["tag_name"] == version:
                return release
        page += 1
    return None


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify_asset(tag: str, asset, path: Path) -> None:
    if asset["size"] != path.stat().st_size:
        raise ValueError(f"Published asset size conflicts with candidate: {path.name}")
    expected = digest(path)
    remote = asset.get("digest")
    if remote and remote.startswith("sha256:"):
        actual = remote.removeprefix("sha256:")
    else:
        # Older assets may lack the REST digest. gh handles authenticated draft downloads.
        with tempfile.TemporaryDirectory() as directory:
            gh("release", "download", tag, "--pattern", path.name, "--dir", directory)
            actual = digest(Path(directory) / path.name)
    if actual != expected:
        raise ValueError(f"Published asset hash conflicts with candidate: {path.name}")


def publish(package: Path, version: str, sha: str, run_id: str) -> None:
    files = sorted(package.iterdir())
    if not files or any(not path.is_file() for path in files):
        raise ValueError("Candidate package must contain resource files only")
    for name in ("lexicon-manifest.json", "sources.lock.json", "embeddings.sqlite3.gz", "embedding-cache.json"):
        if not (package / name).is_file():
            raise ValueError(f"Candidate package is missing {name}")
    encoded = urllib.parse.quote(version, safe="")
    tag = api(f"git/ref/tags/{encoded}")
    if tag and (tag["object"]["type"] != "commit" or tag["object"]["sha"] != sha):
        raise ValueError("Existing immutable version tag points to a different source commit")
    release = find_release(version)
    if release is None:
        gh("release", "create", version, "--draft", "--target", sha, "--title", version,
           "--notes", f"Verified resource candidate from workflow run {run_id}.", "--latest=false")
        release = find_release(version)
    if release is None:
        raise RuntimeError("GitHub did not return the newly created draft release")
    if not tag and release["target_commitish"] != sha:
        raise ValueError("Draft release points to a different source commit")
    assets = {asset["name"]: asset for asset in release["assets"]}
    # Verify every existing file before uploading missing files; never overwrite versioned assets.
    for path in files:
        if path.name in assets:
            verify_asset(version, assets[path.name], path)
    for path in files:
        if path.name not in assets:
            gh("release", "upload", version, str(path))
    if release["draft"]:
        gh("release", "edit", version, "--draft=false", "--latest=false")
    current = find_release("lexicon-current")
    if current is None:
        gh("release", "create", "lexicon-current", "--target", sha,
           "--title", "Current lexicon resource", "--notes",
           "Manifest pointer to the current immutable lexicon resource.", "--latest=false")
    # Cache and source metadata are available before the client manifest selects this version.
    for name in ("embeddings.sqlite3.gz", "embedding-cache.json", "sources.lock.json", "lexicon-manifest.json"):
        gh("release", "upload", "lexicon-current", str(package / name), "--clobber")
    print(f"Published {version}; lexicon-current now selects this verified candidate")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    publish(args.package, args.id, args.sha, args.run_id)


if __name__ == "__main__":
    main()

"""Publish a verified resource candidate with resumable immutable asset uploads."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request


def api(path: str, payload=None, method=None):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GH_REPO']}/{path}",
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        method=method,
        headers={
            "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return None if response.status == 204 else json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404 and payload is None and method in (None, "GET"):
            return None
        raise


def upload_asset(release, path: Path):
    """Stream a file to the draft's upload URL without another release-by-tag lookup."""
    url = urllib.parse.urlsplit(release["upload_url"].split("{", 1)[0])
    endpoint = f"{url.path}?{urllib.parse.urlencode({'name': path.name})}"
    connection = http.client.HTTPSConnection(url.hostname, timeout=600)
    try:
        connection.putrequest("POST", endpoint)
        connection.putheader("Authorization", f"Bearer {os.environ['GH_TOKEN']}")
        connection.putheader("Content-Type", "application/octet-stream")
        connection.putheader("Content-Length", str(path.stat().st_size))
        connection.putheader("Accept", "application/vnd.github+json")
        connection.putheader("User-Agent", "nib-lexicon-publisher")
        connection.endheaders()
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                connection.send(chunk)
        response = connection.getresponse()
        if response.status != 201:
            raise RuntimeError(f"Uploading {path.name} failed: HTTP {response.status} {response.reason}")
        asset = json.load(response)
        verify_asset(asset, path)
        print(f"Uploaded {path.name} ({asset['size']} bytes)", flush=True)
        return asset
    finally:
        connection.close()


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


def asset_matches(asset, path: Path) -> bool:
    if asset["size"] != path.stat().st_size:
        return False
    expected = digest(path)
    remote = asset.get("digest")
    if remote and remote.startswith("sha256:"):
        actual = remote.removeprefix("sha256:")
    else:
        # Older assets may lack the REST digest. Download by ID, including for drafts.
        with tempfile.TemporaryDirectory() as directory:
            downloaded = Path(directory) / path.name
            with downloaded.open("wb") as output:
                subprocess.run(["gh", "api", f"repos/{os.environ['GH_REPO']}/releases/assets/{asset['id']}",
                                "-H", "Accept: application/octet-stream"], stdout=output, check=True)
            actual = digest(downloaded)
    return actual == expected


def verify_asset(asset, path: Path) -> None:
    if not asset_matches(asset, path):
        raise ValueError(f"Published asset size or hash conflicts with candidate: {path.name}")


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
        # The tag/list read endpoints may not expose a just-created draft immediately.
        # Use the creation response, which already contains its ID and asset list.
        release = api("releases", {
            "tag_name": version, "target_commitish": sha, "name": version, "draft": True,
            "body": f"Verified resource candidate from workflow run {run_id}.", "make_latest": "false",
        })
    if release is None:
        raise RuntimeError("GitHub did not return the newly created draft release")
    if not tag and release["target_commitish"] != sha:
        raise ValueError("Draft release points to a different source commit")
    print(f"Using release {release['id']} for {version} (draft={release['draft']})", flush=True)
    assets = {asset["name"]: asset for asset in release["assets"]}
    # Verify every existing file before uploading missing files; never overwrite versioned assets.
    for path in files:
        if path.name in assets:
            verify_asset(assets[path.name], path)
    for path in files:
        if path.name not in assets:
            upload_asset(release, path)
    if release["draft"]:
        api(f"releases/{release['id']}", {"draft": False, "make_latest": "false"}, method="PATCH")
    current = find_release("lexicon-current")
    if current is None:
        current = api("releases", {
            "tag_name": "lexicon-current", "target_commitish": sha, "name": "Current lexicon resource",
            "body": "Manifest pointer to the current immutable lexicon resource.", "make_latest": "false",
        })
    assets = {asset["name"]: asset for asset in current["assets"]}
    # Cache and source metadata are available before the client manifest selects this version.
    for name in ("embeddings.sqlite3.gz", "embedding-cache.json", "sources.lock.json", "lexicon-manifest.json"):
        path = package / name
        existing = assets.get(name)
        if existing:
            if asset_matches(existing, path):
                continue
            api(f"releases/assets/{existing['id']}", method="DELETE")
        upload_asset(current, path)
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

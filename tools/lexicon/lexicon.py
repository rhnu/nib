"""Build the offline lexicon using pinned public sources and bounded embedding batches."""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import heapq
import json
import logging
import math
import os
import re
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
RESOURCES = ROOT / "resources" / "lexicon"
RESOURCE_WORKTREE = ROOT.with_name(ROOT.name + "-resource")
CATEGORIES = {0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "meta"}
LOG = logging.getLogger("lexicon")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def canonical_json(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def download(url: str, path: Path, expected: str | None = None) -> None:
    """Publish a download only after its entire pinned content has been verified."""
    if path.exists() and expected and sha256(path) == expected:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "nib-lexicon/0.1"})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)
    actual = sha256(temporary)
    if expected and actual != expected:
        raise ValueError(f"Checksum mismatch for {path.name}: expected {expected}, got {actual}")
    temporary.replace(path)
    LOG.info("Fetched %s (%d bytes)", path.name, path.stat().st_size)


def get_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "nib-lexicon/0.1"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def selected_sources(lock, enhanced: bool):
    return [s for s in lock["sources"] if enhanced or s["id"] == "ffdkj"]


def asset_identity(lock, enhanced: bool):
    return {
        s["id"]: {f["path"]: f.get("gitBlobSha", f.get("sha256")) for f in s["files"]}
        for s in selected_sources(lock, enhanced)
    }


def build_recipe_identity(recipe, enhanced: bool):
    return {
        "recipe": recipe, "models": read_json(RESOURCES / "models.lock.json"),
        "novelai": read_json(RESOURCES / "novelai.json"),
        "enhanced": enhanced, "normalizerVersion": 1, "encoderVersion": 1,
    }


def refresh_source(args) -> None:
    """Explicitly resolve upstream HEAD and record verified file identities in the resource worktree."""
    current = read_json(args.sources_lock)
    before = asset_identity(current, args.enhanced)
    for source in selected_sources(current, args.enhanced):
        repository = source["repository"].removeprefix("https://github.com/")
        commit = get_json(f"https://api.github.com/repos/{repository}/commits/HEAD")
        source["revision"] = commit["sha"]
        tree = get_json(f"https://api.github.com/repos/{repository}/git/trees/{commit['sha']}?recursive=1")
        if tree.get("truncated"):
            raise ValueError(f"Cannot verify truncated source tree: {repository}")
        blobs = {entry["path"]: entry for entry in tree["tree"] if entry["type"] == "blob"}
        for item in source["files"]:
            remote = blobs[item["path"]]
            same_blob = item.get("gitBlobSha") == remote["sha"]
            item["gitBlobSha"] = remote["sha"]
            item["bytes"] = remote["size"]
            item["url"] = f"https://raw.githubusercontent.com/{repository}/{commit['sha']}/{item['path']}"
            if not same_blob:
                target = args.work_dir / "sources" / source["id"] / item["name"]
                download(item["url"], target)
                item["sha256"] = sha256(target)
    current.pop("buildRecipe", None)
    write_json(args.sources_lock, current)
    print(json.dumps({"changed": before != asset_identity(current, args.enhanced), "sourcesLock": str(args.sources_lock)}))


def fetch_sources(lock, work_dir: Path, enhanced: bool):
    metadata = []
    for source in selected_sources(lock, enhanced):
        directory = work_dir / "sources" / source["id"]
        for item in source["files"]:
            download(item["url"], directory / item["name"], item["sha256"])
        metadata.append({
            "name": source["id"], "url": source["repository"], "revision": source["revision"],
            "license": source["license"], "licenseText": (directory / "LICENSE").read_text(encoding="utf-8"),
        })
    write_json(work_dir / "sources.json", metadata)
    return metadata


def clean(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def unique(values) -> list[str]:
    return list(dict.fromkeys(value for item in values if (value := clean(item))))


def split_translations(value) -> list[str]:
    return unique((clean(value) or "").replace("，", ",").split(","))


def keep_record(name: str, category: str, count: int, recipe) -> bool:
    retain = set(recipe.get("retain", []))
    exclude = set(recipe.get("exclude", []))
    if name in exclude or "danbooru:" + name in exclude:
        return False
    threshold = recipe.get("minimumPostCountByCategory", {}).get(category, recipe["minimumPostCount"])
    return name in retain or "danbooru:" + name in retain or count >= threshold


def normalize_base(database: Path, recipe) -> dict[str, dict]:
    """Keep qualified records from every known Danbooru category, including untranslated artists."""
    records = {}
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        for name, raw_category, translation, count in connection.execute(
            "SELECT name,category,cn_name,post_count FROM tags ORDER BY name"
        ):
            name = clean(name)
            category = CATEGORIES.get(raw_category)
            if not name or not category:
                continue
            count = int(count or 0)
            if not keep_record(name, category, count, recipe):
                continue
            translation = clean(translation)
            records[name] = {
                "key": "danbooru:" + name, "name": name, "category": category,
                "translation": translation, "description": None, "postCount": count,
                "aliases": [], "searchTerms": unique([name, name.replace("_", " "), translation]),
                "groups": [], "source": "ffdkj", "relations": [],
            }
    finally:
        connection.close()
    return records


def parquet_rows(path: Path):
    import pyarrow.parquet as pq

    for batch in pq.ParquetFile(path).iter_batches(batch_size=8192):
        yield from batch.to_pylist()


def enrich(records: dict[str, dict], directory: Path, relation_limit: int = 50) -> None:
    """Merge optional GPL data into the complete base; the enhanced CSV never defines membership."""
    def mark(record):
        record["source"] = "ffdkj+danbooru-search-online"

    # Upstream currently writes this CSV as GB18030, unlike its UTF-8 JSON assets.
    with (directory / "tags_enhanced.csv").open(encoding="gb18030", newline="") as stream:
        for row in csv.DictReader(stream):
            if (record := records.get(row["name"])) is None:
                continue
            translations = split_translations(row["cn_name"])
            record["searchTerms"] = unique(record["searchTerms"] + translations)
            if not record["translation"] and translations:
                record["translation"] = translations[0]
            record["description"] = clean(row.get("wiki"))
            mark(record)
    for row in parquet_rows(directory / "tag_aliases.parquet"):
        if row["status"] != "active" or (record := records.get(row["consequent_name"])) is None:
            continue
        record["aliases"] = unique(record["aliases"] + [row["antecedent_name"]])
        record["searchTerms"] = unique(record["searchTerms"] + record["aliases"])
        mark(record)
    groups = read_json(directory / "tag_groups.json")
    group_names = groups.get("group_cn_names", {})
    for name, names in groups["tag_to_groups"].items():
        if (record := records.get(name)) is not None:
            record["groups"] = unique(names + [group_names.get(group) for group in names])
            mark(record)
    edges: dict[tuple[str, str], list[tuple[float, str, str]]] = {}

    def edge(source, target, kind, score):
        if source not in records or target not in records or source == target or not math.isfinite(score):
            return
        # Keep only the strongest observed links rather than retaining millions of rows in memory.
        # Raw co-occurrence counts and artist NPMI are incomparable scoring scales.
        heap = edges.setdefault((source, kind), [])
        value = (float(score), target, kind)
        if len(heap) < relation_limit:
            heapq.heappush(heap, value)
        elif value > heap[0]:
            heapq.heapreplace(heap, value)

    if relation_limit > 0:
        for row in parquet_rows(directory / "cooccurrence_clean.parquet"):
            edge(row["tag_a"], row["tag_b"], "cooccurrence", row["count"])
            edge(row["tag_b"], row["tag_a"], "cooccurrence", row["count"])
        for row in parquet_rows(directory / "tag_artist_cooc.parquet"):
            edge(row["tag"], row["artist"], "artist", row["npmi"])
            edge(row["artist"], row["tag"], "artist", row["npmi"])
        for (name, _kind), heap in edges.items():
            records[name]["relations"].extend([
                {"targetKey": "danbooru:" + target, "kind": kind, "score": score}
                for score, target, kind in sorted(heap, reverse=True)
            ])
            mark(records[name])


def normalize(work_dir: Path, output: Path, recipe, enhanced: bool):
    records = normalize_base(work_dir / "sources" / "ffdkj" / "tag.sqlite", recipe)
    if enhanced:
        enrich(records, work_dir / "sources" / "danbooru-search-online", recipe.get("relationLimit", 50))
    apply_prompt_names(records, read_json(RESOURCES / "novelai.json")["overrides"])
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".part")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        for name in sorted(records):
            stream.write(json.dumps(records[name], ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(output)
    counts = {category: sum(r["category"] == category for r in records.values()) for category in CATEGORIES.values()}
    LOG.info("Normalized %d terms: %s", len(records), counts)
    return counts


def apply_prompt_names(records: dict[str, dict], overrides: dict[str, str]) -> None:
    """Keep Danbooru identity while supplying NovelAI's explicit prompt spellings as searchable aliases."""
    for record in records.values():
        name = record["name"]
        record["promptText"] = overrides.get(name, name.replace("_", " "))
        if name in overrides:
            record["aliases"] = unique(record["aliases"] + [record["promptText"]])
            record["searchTerms"] = unique(record["searchTerms"] + [record["promptText"]])
            record["source"] += "+novelai"


def fetch_models(work_dir: Path, reuse: Path | None = None):
    lock = read_json(RESOURCES / "models.lock.json")
    for role, files in lock["files"].items():
        directory = work_dir / "models" / role
        directory.mkdir(parents=True, exist_ok=True)
        for item in files:
            destination = directory / item["name"]
            if "localFile" in item:
                origin = RESOURCES / item["localFile"]
                if sha256(origin) != item["sha256"]:
                    raise ValueError(f"Bundled model license checksum mismatch: {origin}")
                shutil.copyfile(origin, destination)
                continue
            if reuse:
                origin = reuse / item["path"]
                if origin.exists() and sha256(origin) == item["sha256"] and not destination.exists():
                    shutil.copyfile(origin, destination)
            download(item["url"], destination, item["sha256"])
        if role == "query":
            # The contract hashes decoded tokenizer JSON; the release manifest hashes this gzip asset.
            (directory / "tokenizer.json.gz").write_bytes(gzip.compress((directory / "tokenizer.json").read_bytes(), mtime=0))
    metadata_path = work_dir / "sources.json"
    if metadata_path.exists():
        metadata = [source for source in read_json(metadata_path) if source["name"] != "embeddinggemma-2"]
        metadata.append({
            "name": "embeddinggemma-2", "url": lock["repository"], "revision": lock["revision"],
            "license": lock["license"], "licenseText": (work_dir / "models" / "query" / "LICENSE").read_text(encoding="utf-8"),
        })
        write_json(metadata_path, metadata)
    return lock


def model_digest(directory: Path, name: str) -> str:
    """Cover both the ONNX graph and external tensor data in the application contract."""
    graph = sha256(directory / name)
    tensors = sha256(directory / (name + "_data"))
    return hashlib.sha256((graph + ":" + tensors).encode("ascii")).hexdigest()


def make_contract(work_dir: Path, recipe):
    if recipe["model"]["dimension"] != 256:
        raise ValueError("This lexicon encoder contract requires 256 dimensions")
    query = work_dir / "models" / "query"
    document = work_dir / "models" / "document"
    tokenizer_hash = sha256(query / "tokenizer.json")
    if tokenizer_hash != sha256(document / "tokenizer.json"):
        raise ValueError("Query and document tokenizers differ")
    return {
        **recipe["model"], "tokenizerSha256": tokenizer_hash,
        "queryModelSha256": model_digest(query, "model_q4.onnx"),
        "documentModelSha256": model_digest(document, "model_quantized.onnx"),
    }


def document_text(record, template: str = "title: {name_with_spaces} | text: {translations/aliases/description}") -> str:
    body = unique([record["translation"], *record["aliases"], *record["searchTerms"], record["description"]])
    # Canonical spellings already appear in the title and do not need to consume the text budget again.
    body = [s for s in body if s not in {record["name"], record["name"].replace("_", " ")}]
    return template.format_map({
        "name_with_spaces": record["name"].replace("_", " "),
        "translations/aliases/description": "; ".join(body),
    })


def cache_key(document: str, encoder_recipe) -> bytes:
    recipe_bytes = canonical_json(encoder_recipe)
    return hashlib.sha256(len(recipe_bytes).to_bytes(8, "little") + recipe_bytes + document.encode("utf-8")).digest()


def records_from(path: Path):
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                yield json.loads(line)


def semantic_records(path: Path, recipe, shard_index: int = 0, shard_count: int = 1):
    for record in records_from(path):
        if record["category"] not in recipe["semanticCategories"]:
            continue
        shard = int.from_bytes(hashlib.sha256(record["key"].encode("utf-8")).digest()[:8], "little") % shard_count
        if shard == shard_index:
            yield record


class Encoder:
    """Run the official text-only INT8 export and project before L2 normalization."""

    def __init__(self, work_dir: Path, contract, threads: int):
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.np = np
        self.dimension = contract["dimension"]
        directory = work_dir / "models" / "document"
        self.tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=contract["maxTokens"])
        pad_id = self.tokenizer.token_to_id("<pad>")
        if pad_id is None:
            raise ValueError("Tokenizer has no <pad> token")
        self.tokenizer.enable_padding(direction="right", pad_id=pad_id, pad_token="<pad>")
        self.length_tokenizer = Tokenizer.from_str(self.tokenizer.to_str())
        self.length_tokenizer.no_padding()
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = ort.InferenceSession(str(directory / "model_quantized.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
        names = {value.name for value in self.session.get_inputs()}
        if names != {"input_ids", "attention_mask", "image_features", "video_features", "audio_features"}:
            raise ValueError(f"Unexpected ONNX inputs: {sorted(names)}")

    def encode(self, documents: list[str]):
        np = self.np
        encodings = self.tokenizer.encode_batch(documents, add_special_tokens=True)
        inputs = {
            "input_ids": np.asarray([item.ids for item in encodings], dtype=np.int64),
            "attention_mask": np.asarray([item.attention_mask for item in encodings], dtype=np.int64),
            **{name: np.empty((0, 512), dtype=np.float32) for name in ("image_features", "video_features", "audio_features")},
        }
        vectors = self.session.run(["sentence_embedding"], inputs)[0]
        if vectors.ndim != 2 or vectors.shape[0] != len(documents) or vectors.shape[1] < self.dimension:
            raise ValueError(f"Unexpected sentence embedding shape: {vectors.shape}")
        vectors = np.asarray(vectors[:, :self.dimension], dtype=np.float32)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        if not np.isfinite(vectors).all() or (norms <= 0).any():
            raise ValueError("Model returned non-finite or zero embeddings")
        vectors /= norms
        return vectors.astype("<f2")

    def lengths(self, documents: list[str]) -> list[int]:
        return [len(item.ids) for item in self.length_tokenizer.encode_batch(documents, add_special_tokens=True)]


def encode(args, recipe):
    import numpy as np
    import onnxruntime as ort
    import tokenizers

    if args.batch_size < 1 or args.bucket_size < args.batch_size or args.threads < 1 or args.shard_count < 1 or not 0 <= args.shard_index < args.shard_count:
        raise ValueError("Batch size, bucket size, threads and shard range must be positive and valid")
    contract = make_contract(args.work_dir, recipe)
    encoder_recipe = {
        "contract": contract, "documentTemplateImplementation": 1,
        "projection": "prefix-256-then-l2-f32-to-little-endian-f16", "padding": "right-longest",
        "specialTokens": "tokenizer-postprocessor", "onnxruntime": ort.__version__,
        "tokenizers": tokenizers.__version__, "numpy": np.__version__,
        "provider": "CPUExecutionProvider",
    }
    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.parent.mkdir(parents=True, exist_ok=True)
    cache = sqlite3.connect(args.cache, timeout=60)
    cache.execute("PRAGMA journal_mode=WAL")
    cache.execute("CREATE TABLE IF NOT EXISTS embeddings (cache_key BLOB PRIMARY KEY, vector BLOB NOT NULL) WITHOUT ROWID")
    cache.commit()
    encoder = None
    output_tmp = args.output / "vectors.f16.part"
    keys = []
    pending = []
    stats = {"encoded": 0, "reused": 0}
    started = time.monotonic()
    last_progress = started

    def flush(stream):
        nonlocal encoder, last_progress
        if not pending:
            return
        vectors = {}
        missing = {}
        for key, document, digest in pending:
            hit = cache.execute("SELECT vector FROM embeddings WHERE cache_key=?", (digest,)).fetchone()
            if hit is not None:
                if len(hit[0]) != contract["dimension"] * 2:
                    raise ValueError("Invalid cached embedding byte length")
                vectors[digest] = hit[0]
                stats["reused"] += 1
            else:
                missing[digest] = document
        if missing:
            if encoder is None:
                encoder = Encoder(args.work_dir, contract, args.threads)
            documents = list(missing.items())
            lengths = encoder.lengths([document for _, document in documents])
            # Similar sequence lengths avoid making every short term pay for the longest term's padding.
            ordered = [item for _, item in sorted(zip(lengths, documents, strict=True), key=lambda pair: pair[0])]
            for start in range(0, len(ordered), args.batch_size):
                batch = ordered[start:start + args.batch_size]
                encoded = encoder.encode([document for _, document in batch])
                for (digest, _), vector in zip(batch, encoded, strict=True):
                    vectors[digest] = vector.tobytes()
                cache.executemany("INSERT OR IGNORE INTO embeddings VALUES (?,?)", [(digest, vectors[digest]) for digest, _ in batch])
                cache.commit()
                stats["encoded"] += len(batch)
                if time.monotonic() - last_progress >= 15:
                    LOG.info("Embedding shard %d/%d: %d terms ready, %d new, %.1fs", args.shard_index + 1, args.shard_count, len(keys) + len(vectors), stats["encoded"], time.monotonic() - started)
                    last_progress = time.monotonic()
        for key, _, digest in pending:
            stream.write(vectors[digest])
            keys.append(key)
        pending.clear()
        if time.monotonic() - last_progress >= 15:
            LOG.info("Embedding shard %d/%d: %d terms, %d new, %.1fs", args.shard_index + 1, args.shard_count, len(keys), stats["encoded"], time.monotonic() - started)
            last_progress = time.monotonic()

    try:
        with output_tmp.open("wb") as stream:
            for record in semantic_records(args.input, recipe, args.shard_index, args.shard_count):
                text = document_text(record, contract["documentTemplate"])
                pending.append((record["key"], text, cache_key(text, encoder_recipe)))
                if len(pending) >= args.bucket_size:
                    flush(stream)
            flush(stream)
        output_tmp.replace(args.output / "vectors.f16")
        write_json(args.output / "keys.json", keys)
        write_json(args.output / "contract.json", contract)
        write_json(args.output / "encoder.json", encoder_recipe)
        write_json(args.output / "encoding.json", {**stats, "terms": len(keys), "seconds": time.monotonic() - started, "shardIndex": args.shard_index, "shardCount": args.shard_count})
        LOG.info("Embedding complete: %s", stats)
    finally:
        cache.close()


def merge_shards(args, recipe):
    """Reorder independently encoded shards by normalized term order and reject gaps or duplicates."""
    import numpy as np

    expected = [record["key"] for record in semantic_records(args.input, recipe)]
    found = {}
    contract = None
    maps = []
    for directory in args.shards:
        shard_contract = read_json(directory / "contract.json")
        if contract is not None and contract != shard_contract:
            raise ValueError("Shard encoder contracts differ")
        contract = shard_contract
        keys = read_json(directory / "keys.json")
        path = directory / "vectors.f16"
        if path.stat().st_size != len(keys) * contract["dimension"] * 2:
            raise ValueError(f"Invalid vector length in {directory}")
        vectors = np.memmap(path, dtype="<f2", mode="r", shape=(len(keys), contract["dimension"])) if keys else []
        maps.append(vectors)
        for index, key in enumerate(keys):
            if key in found:
                raise ValueError(f"Duplicate shard key: {key}")
            found[key] = (len(maps) - 1, index)
    if set(expected) != set(found):
        raise ValueError(f"Shard coverage differs: {len(set(expected) - set(found))} missing, {len(set(found) - set(expected))} extra")
    args.output.mkdir(parents=True, exist_ok=True)
    temporary = args.output / "vectors.f16.part"
    with temporary.open("wb") as stream:
        for key in expected:
            shard, index = found[key]
            stream.write(maps[shard][index].tobytes())
    temporary.replace(args.output / "vectors.f16")
    write_json(args.output / "keys.json", expected)
    write_json(args.output / "contract.json", contract)


def validate_cache(path: Path) -> int:
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        results = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        if results != ["ok"]:
            raise ValueError(f"Embedding cache integrity check failed: {results[:3]}")
        invalid = connection.execute(
            "SELECT count(*) FROM embeddings WHERE typeof(cache_key)!='blob' OR length(cache_key)!=32 "
            "OR typeof(vector)!='blob' OR length(vector)!=512"
        ).fetchone()[0]
        if invalid:
            raise ValueError(f"Embedding cache contains {invalid} invalid keys or vectors")
        return connection.execute("SELECT count(*) FROM embeddings").fetchone()[0]
    finally:
        connection.close()


def cache_metadata(compressed: Path, snapshot: Path, entries: int):
    return {
        "schemaVersion": 1, "file": compressed.name, "sha256": sha256(compressed),
        "bytes": compressed.stat().st_size, "sqliteSha256": sha256(snapshot),
        "sqliteBytes": snapshot.stat().st_size, "entries": entries,
    }


def validate_cache_metadata(metadata, compressed_identity, sqlite_identity, entries: int) -> None:
    """Check both transport bytes and the decoded SQLite content against one snapshot identity."""
    if metadata["schemaVersion"] != 1 or metadata["file"] != "embeddings.sqlite3.gz":
        raise ValueError("Unsupported embedding cache snapshot metadata")
    if (metadata["sha256"], metadata["bytes"]) != compressed_identity:
        raise ValueError("Compressed embedding cache differs from its snapshot metadata")
    if (metadata["sqliteSha256"], metadata["sqliteBytes"]) != sqlite_identity:
        raise ValueError("Decoded embedding cache differs from its snapshot metadata")
    if metadata["entries"] != entries:
        raise ValueError("Embedding cache entry count differs from its snapshot metadata")


def import_cache(directory: Path, cache: Path) -> None:
    """Restore a verified local resource snapshot without replacing committed local batches."""
    if cache.exists():
        raise ValueError(f"Embedding cache already exists: {cache}; choose a new --cache path to import")
    compressed = directory / "embeddings.sqlite3.gz"
    metadata = read_json(directory / "metadata.json")
    compressed_identity = (sha256(compressed), compressed.stat().st_size)
    if (metadata["sha256"], metadata["bytes"]) != compressed_identity:
        raise ValueError("Compressed embedding cache differs from its snapshot metadata; hydrate Git LFS first")
    cache.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lexicon-cache-", dir=cache.parent) as directory_name:
        temporary = Path(directory_name) / "embeddings.sqlite3"
        with gzip.open(compressed, "rb") as source, temporary.open("wb") as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)
        count = validate_cache(temporary)
        validate_cache_metadata(metadata, compressed_identity, (sha256(temporary), temporary.stat().st_size), count)
        temporary.replace(cache)
    LOG.info("Restored %d reusable document embeddings from %s", count, compressed)


def export_cache(cache: Path, output: Path) -> None:
    """Export a consistent SQLite backup and its identity to the independent resource worktree."""
    if not cache.is_file():
        raise ValueError(f"Embedding cache does not exist: {cache}")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lexicon-cache-", dir=output) as directory_name:
        snapshot = Path(directory_name) / "embeddings.sqlite3"
        source = sqlite3.connect(cache.resolve().as_uri() + "?mode=ro", uri=True)
        target = sqlite3.connect(snapshot)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        count = validate_cache(snapshot)
        compressed = Path(directory_name) / "embeddings.sqlite3.gz"
        with snapshot.open("rb") as source, compressed.open("wb") as target:
            with gzip.GzipFile(filename="", fileobj=target, mode="wb", mtime=0) as encoded:
                shutil.copyfileobj(source, encoded, length=1024 * 1024)
        metadata = cache_metadata(compressed, snapshot, count)
        compressed.replace(output / compressed.name)
        write_json(output / "metadata.json", metadata)
    LOG.info("Exported %d reusable document embeddings to %s", count, output)


def resource_version(value: str) -> str:
    """Resource releases use stable major.minor.patch versions with no ambiguous numeric spelling."""
    if re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", value) is None:
        raise argparse.ArgumentTypeError("Resource version must be a stable major.minor.patch version, for example 1.0.0")
    return value


def release_tag(version: str) -> str:
    return "resource-lexicon-v" + resource_version(version)


def build_metadata(args, lock, enhanced: bool):
    """Keep source-code provenance separate from the independently versioned resource files."""
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip())
    sources = {Path(__file__).resolve()}
    for module in ("lexicon", "resources"):
        directory = ROOT / "modules" / module
        sources.update(directory.glob("src/**/*.rs"))
        sources.update(directory.glob("**/schema.sql"))
    packer_sources = {path.relative_to(ROOT).as_posix(): sha256(path) for path in sorted(sources)}
    semantic = None
    if args.semantic_dir:
        semantic = {
            "files": {name: sha256(args.semantic_dir / name) for name in ("vectors.f16", "keys.json", "contract.json")},
            "encoder": read_json(args.semantic_dir / "encoder.json") if (args.semantic_dir / "encoder.json").exists() else None,
        }
    return {
        "resourceId": "lexicon", "version": args.version, "tag": release_tag(args.version),
        "sourceCommit": commit, "sourceDirty": dirty, "packerSources": packer_sources,
        "normalizedSha256": sha256(args.input), "semanticInputs": semantic,
        "sourcesLockSha256": sha256(args.sources_lock),
        "buildRecipe": build_recipe_identity(read_json(args.recipe), enhanced),
        "sources": [{"id": source["id"], "revision": source["revision"]} for source in selected_sources(lock, enhanced)],
        "semantic": args.semantic_dir is not None,
    }


def pack(args):
    lock = read_json(args.sources_lock)
    used_sources = {record["source"] for record in records_from(args.input)}
    enhanced = any("danbooru-search-online" in source for source in used_sources)
    metadata = [{
        "name": source["id"], "url": source["repository"], "revision": source["revision"],
        "license": source["license"],
        "licenseText": (args.work_dir / "sources" / source["id"] / "LICENSE").read_text(encoding="utf-8"),
    } for source in selected_sources(lock, enhanced)]
    if any("novelai" in source for source in used_sources):
        source = read_json(RESOURCES / "novelai.json")["source"]
        metadata.append({
            "name": source["name"], "url": source["url"], "revision": source["retrievedAt"],
            "license": source["license"], "licenseText": source["notice"],
        })
    if args.semantic_dir:
        model = read_json(RESOURCES / "models.lock.json")
        metadata.append({
            "name": "embeddinggemma-2", "url": model["repository"], "revision": model["revision"],
            "license": model["license"],
            "licenseText": (args.work_dir / "models" / "query" / "LICENSE").read_text(encoding="utf-8"),
        })
    write_json(args.work_dir / "sources.json", metadata)
    command = [
        "cargo", "run", "--locked", "-p", "nib-lexicon", "--bin", "nib-lexicon", "--", "pack",
        "--input", str(args.input), "--output", str(args.output), "--version", args.version,
        "--sources-json", str(args.work_dir / "sources.json"),
    ]
    if args.semantic_dir:
        command += [
            "--vectors", str(args.semantic_dir / "vectors.f16"), "--keys", str(args.semantic_dir / "keys.json"),
            "--model-dir", str(args.work_dir / "models" / "query"), "--contract", str(args.semantic_dir / "contract.json"),
        ]
    subprocess.run(command, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    LOG.info("Assembled lexicon %s in %s", args.version, args.output)
    shutil.copyfile(args.sources_lock, args.output / "sources.lock.json")
    shutil.copyfile(args.recipe, args.output / "recipe.json")
    write_json(args.output / "build.json", build_metadata(args, lock, enhanced))


def package_destination(args) -> Path:
    destination = args.output or args.resource_dir / "lexicon" / "versions" / args.version
    if destination.exists():
        raise ValueError(f"Resource version output already exists: {destination}; choose a new version or an unused --output directory")
    return destination.resolve()


def build(args, recipe):
    destination = package_destination(args)
    args.work_dir.mkdir(parents=True, exist_ok=True)
    lock = read_json(args.sources_lock)
    fetch_sources(lock, args.work_dir, args.enhanced)
    args.input = args.work_dir / "normalized.jsonl"
    counts = normalize(args.work_dir, args.input, recipe, args.enhanced)
    if not args.lexical_only:
        fetch_models(args.work_dir, args.reuse_models)
        args.output = args.work_dir / "semantic"
        args.cache = args.work_dir / "embeddings.sqlite3"
        if not args.cache.exists():
            import_cache(args.resource_dir / "lexicon" / "cache", args.cache)
        else:
            LOG.info("Using %d locally committed document embeddings", validate_cache(args.cache))
        args.shard_index = 0
        args.shard_count = 1
        encode(args, recipe)
        args.semantic_dir = args.output
    else:
        args.semantic_dir = None
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lexicon-version-", dir=destination.parent) as directory:
        staging = Path(directory) / "package"
        args.output = staging
        pack(args)
        staging.rename(destination)
    args.output = destination
    LOG.info("Built lexicon %s: %s; categories: %s", args.version, destination, counts)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    subcommands = result.add_subparsers(dest="command", required=True)

    def common(name):
        sub = subcommands.add_parser(name)
        sub.add_argument("--work-dir", type=Path, default=ROOT / ".dev" / "lexicon-build")
        sub.add_argument("--resource-dir", type=Path, default=RESOURCE_WORKTREE)
        sub.add_argument("--sources-lock", type=Path)
        sub.add_argument("--recipe", type=Path, default=RESOURCES / "recipe.json")
        return sub

    refresh = common("refresh-source")
    refresh.add_argument("--enhanced", action="store_true")
    fetch = common("fetch")
    fetch.add_argument("--enhanced", action="store_true")
    normal = common("normalize")
    normal.add_argument("--output", type=Path, required=True)
    normal.add_argument("--enhanced", action="store_true")
    models = common("models")
    models.add_argument("--reuse-models", type=Path)
    encoder = common("encode")
    encoder.add_argument("--input", type=Path, required=True)
    encoder.add_argument("--output", type=Path, required=True)
    encoder.add_argument("--cache", type=Path, required=True)
    encoder.add_argument("--batch-size", type=int, default=32)
    encoder.add_argument("--bucket-size", type=int, default=2048)
    encoder.add_argument("--threads", type=int, default=min(4, (getattr(os, "process_cpu_count", os.cpu_count)() or 1)))
    encoder.add_argument("--shard-index", type=int, default=0)
    encoder.add_argument("--shard-count", type=int, default=1)
    merge = common("merge")
    merge.add_argument("--input", type=Path, required=True)
    merge.add_argument("--shards", type=Path, nargs="+", required=True)
    merge.add_argument("--output", type=Path, required=True)
    packer = common("pack")
    packer.add_argument("--input", type=Path, required=True)
    packer.add_argument("--output", type=Path)
    packer.add_argument("--semantic-dir", type=Path)
    builder = common("build")
    builder.add_argument("--enhanced", action="store_true")
    builder.add_argument("--lexical-only", action="store_true")
    builder.add_argument("--reuse-models", type=Path)
    builder.add_argument("--batch-size", type=int, default=32)
    builder.add_argument("--bucket-size", type=int, default=2048)
    builder.add_argument("--threads", type=int, default=min(4, (getattr(os, "process_cpu_count", os.cpu_count)() or 1)))
    builder.add_argument("--output", type=Path)
    for name in ("import-cache", "export-cache"):
        snapshot = common(name)
        snapshot.add_argument("--cache", type=Path)
        snapshot.add_argument("--snapshot-dir", type=Path)
    for target in (packer, builder):
        target.add_argument("--version", type=resource_version, required=True)
    return result


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parser().parse_args()
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    args.sources_lock = args.sources_lock or args.resource_dir / "lexicon" / "sources.lock.json"
    recipe = read_json(args.recipe)
    match args.command:
        case "refresh-source": refresh_source(args)
        case "fetch": fetch_sources(read_json(args.sources_lock), args.work_dir, args.enhanced)
        case "normalize": normalize(args.work_dir, args.output, recipe, args.enhanced)
        case "models": fetch_models(args.work_dir, args.reuse_models)
        case "encode": encode(args, recipe)
        case "merge": merge_shards(args, recipe)
        case "pack":
            args.output = package_destination(args)
            pack(args)
        case "build": build(args, recipe)
        case "import-cache" | "export-cache":
            cache = args.cache or args.work_dir / "embeddings.sqlite3"
            directory = args.snapshot_dir or args.resource_dir / "lexicon" / "cache"
            if args.command == "import-cache":
                import_cache(directory, cache)
            else:
                export_cache(cache, directory)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        LOG.warning("Interrupted; committed embedding batches remain reusable")
        sys.exit(130)

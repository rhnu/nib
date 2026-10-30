"""Pure logic checks for source selection, document identity and retention policy."""
import copy
import argparse
import unittest

from lexicon import (
    apply_prompt_names, asset_identity, cache_key, document_text, keep_record,
    release_tag, resource_version, split_translations, validate_cache_metadata,
)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.recipe = {
            "minimumPostCount": 100,
            "minimumPostCountByCategory": {"artist": 20},
            "retain": ["rare_character"],
            "exclude": ["excluded"],
        }

    def test_category_threshold_and_manual_retention(self):
        self.assertTrue(keep_record("artist_name", "artist", 20, self.recipe))
        self.assertFalse(keep_record("ordinary", "general", 99, self.recipe))
        self.assertTrue(keep_record("ordinary", "general", 100, self.recipe))
        self.assertTrue(keep_record("rare_character", "character", 1, self.recipe))
        self.assertFalse(keep_record("excluded", "general", 10000, self.recipe))

    def test_stable_keys_can_be_used_for_manual_retention(self):
        self.recipe["retain"] = ["danbooru:rare_artist"]
        self.assertTrue(keep_record("rare_artist", "artist", 0, self.recipe))

    def test_upstream_revision_without_asset_change_is_unchanged(self):
        original = {"sources": [{"id": "ffdkj", "revision": "old", "files": [{"path": "tag.sqlite", "gitBlobSha": "unchanged"}]}]}
        updated = copy.deepcopy(original)
        updated["sources"][0]["revision"] = "new"
        self.assertEqual(asset_identity(original, False), asset_identity(updated, False))
        updated["sources"][0]["files"][0]["gitBlobSha"] = "changed"
        self.assertNotEqual(asset_identity(original, False), asset_identity(updated, False))


class DocumentTests(unittest.TestCase):
    def setUp(self):
        self.record = {
            "name": "gradient_hair", "translation": "渐变头发", "aliases": ["ombre_hair"],
            "searchTerms": ["gradient_hair", "gradient hair", "渐变头发", "渐变发色"],
            "description": "Hair changes color toward the tips.", "postCount": 200,
        }
        self.recipe = {"tokenizer": "one", "model": "weights", "maxTokens": 128, "dimension": 256}

    def test_official_document_format_avoids_duplicate_title_and_translation(self):
        self.assertEqual(
            document_text(self.record),
            "title: gradient hair | text: 渐变头发; ombre_hair; 渐变发色; Hair changes color toward the tips.",
        )

    def test_count_change_reuses_document_cache_but_text_and_recipe_changes_do_not(self):
        before = document_text(self.record)
        original = cache_key(before, self.recipe)
        self.record["postCount"] += 1
        self.assertEqual(original, cache_key(document_text(self.record), self.recipe))
        self.record["translation"] = "新译名"
        self.assertNotEqual(original, cache_key(document_text(self.record), self.recipe))
        changed_recipe = {**self.recipe, "maxTokens": 64}
        self.assertNotEqual(original, cache_key(before, changed_recipe))

    def test_recipe_object_order_does_not_change_cache_identity(self):
        self.assertEqual(cache_key("文档", {"a": 1, "b": 2}), cache_key("文档", {"b": 2, "a": 1}))

    def test_untranslated_artist_still_has_usable_name_document(self):
        self.record.update(name="some_artist", translation=None, aliases=[], searchTerms=["some_artist", "some artist"], description=None)
        self.assertEqual(document_text(self.record), "title: some artist | text: ")

    def test_translation_aliases_are_trimmed_and_deduplicated(self):
        self.assertEqual(split_translations(" 甲,乙，甲,, "), ["甲", "乙"])

    def test_prompt_metadata_preserves_identity_and_only_explicit_names_change_documents(self):
        original = {**self.record, "key": "danbooru:gradient_hair", "source": "ffdkj"}
        default = copy.deepcopy(original)
        apply_prompt_names({default["name"]: default}, {})
        self.assertEqual(default["promptText"], "gradient hair")
        self.assertEqual(document_text(default), document_text(original))
        renamed = copy.deepcopy(original)
        apply_prompt_names({renamed["name"]: renamed}, {"gradient_hair": "color fading hair"})
        self.assertEqual(renamed["key"], original["key"])
        self.assertEqual(renamed["name"], original["name"])
        self.assertIn("color fading hair", renamed["aliases"])
        self.assertNotEqual(document_text(renamed), document_text(original))


class ResourceVersionTests(unittest.TestCase):
    def test_stable_version_determines_release_identity(self):
        self.assertEqual(resource_version("1.0.0"), "1.0.0")
        self.assertEqual(release_tag("2.10.3"), "resource-lexicon-v2.10.3")

    def test_ambiguous_or_non_stable_versions_are_rejected(self):
        for value in ("01.0.0", "1.0", "v1.0.0", "1.0.0-rc.1", "1.0.0+local", "1.0.0/other", "1.0.0\n"):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                resource_version(value)


class CacheSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.metadata = {
            "schemaVersion": 1, "file": "embeddings.sqlite3.gz", "sha256": "compressed",
            "bytes": 50, "sqliteSha256": "decoded", "sqliteBytes": 100, "entries": 3,
        }

    def test_matching_snapshot_identity_is_accepted(self):
        validate_cache_metadata(self.metadata, ("compressed", 50), ("decoded", 100), 3)

    def test_snapshot_bytes_decoded_content_and_entry_count_are_all_checked(self):
        for compressed, decoded, entries in (
            (("changed", 50), ("decoded", 100), 3),
            (("compressed", 49), ("decoded", 100), 3),
            (("compressed", 50), ("changed", 100), 3),
            (("compressed", 50), ("decoded", 99), 3),
            (("compressed", 50), ("decoded", 100), 2),
        ):
            with self.subTest(compressed=compressed, decoded=decoded, entries=entries), self.assertRaises(ValueError):
                validate_cache_metadata(self.metadata, compressed, decoded, entries)

    def test_unknown_snapshot_format_or_payload_name_is_rejected(self):
        for changed in ({"schemaVersion": 2}, {"file": "other.sqlite3.gz"}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_cache_metadata({**self.metadata, **changed}, ("compressed", 50), ("decoded", 100), 3)


if __name__ == "__main__":
    unittest.main()

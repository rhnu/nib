"""Pure logic checks for source selection, document identity and retention policy."""
import copy
import unittest

from lexicon import apply_prompt_names, asset_identity, cache_key, document_text, keep_record, split_translations


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


if __name__ == "__main__":
    unittest.main()

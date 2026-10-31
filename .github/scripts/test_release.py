"""Pure release metadata checks; no GitHub requests or local installer execution."""

import unittest

from release import previous_application_release, release_for_tag, should_promote, stable_version, update_manifest, verify_assets


class ReleaseMetadataTests(unittest.TestCase):
    def test_existing_draft_is_selected_for_resuming_a_release(self):
        releases = [
            {"id": 1, "tag_name": "resource-lexicon-v1.0.0", "draft": False},
            {"id": 2, "tag_name": "v1.0.0", "draft": True},
        ]
        self.assertEqual(release_for_tag(releases, "v1.0.0")["id"], 2)
        self.assertIsNone(release_for_tag(releases, "v1.0.1"))

    def test_duplicate_releases_require_resolution(self):
        with self.assertRaises(ValueError):
            release_for_tag([{"tag_name": "v1.0.0"}, {"tag_name": "v1.0.0"}], "v1.0.0")

    def test_application_history_excludes_resources_drafts_and_prereleases(self):
        releases = [
            {"tag_name": "v1.9.0", "draft": False, "prerelease": False},
            {"tag_name": "resource-lexicon-v9.0.0", "draft": False, "prerelease": False},
            {"tag_name": "v1.10.0", "draft": True, "prerelease": False},
            {"tag_name": "v1.11.0", "draft": False, "prerelease": True},
            {"tag_name": "v1.12.0", "draft": False, "prerelease": False},
        ]
        self.assertEqual(previous_application_release(releases, "v1.10.0")["tag_name"], "v1.9.0")
        self.assertFalse(should_promote(releases, "v1.10.0"))
        self.assertTrue(should_promote(releases, "v1.13.0"))
        self.assertTrue(should_promote(releases, "v1.12.0"))
        self.assertIsNone(previous_application_release(releases, "v1.0.0"))
        self.assertTrue(should_promote([], "v1.0.0"))

    def test_publication_requires_complete_assets_with_matching_content(self):
        expected = {"installer.exe": (3, "sha256:abc"), "latest.json": (5, "sha256:def")}
        assets = [
            {"name": "installer.exe", "state": "uploaded", "size": 3, "digest": "sha256:abc"},
            {"name": "latest.json", "state": "uploaded", "size": 5, "digest": "sha256:def"},
        ]
        verify_assets(assets, expected)
        with self.assertRaises(ValueError):
            verify_assets(assets[:1], expected)
        for field, value in (("state", "starter"), ("size", 2), ("digest", "sha256:wrong"), ("digest", None)):
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                verify_assets([assets[0] | {field: value}, assets[1]], expected)

    def test_stable_tags_have_unambiguous_numeric_versions(self):
        self.assertEqual(stable_version("v1.12.3"), (1, 12, 3))
        self.assertLess(stable_version("v1.9.9"), stable_version("v1.10.0"))
        for tag in ("1.2.3", "v01.2.3", "v1.2", "v1.2.3-rc.1", "resource-lexicon-v1.2.3", "v1.2.3\n"):
            self.assertIsNone(stable_version(tag))

    def test_manifest_binds_signature_to_a_versioned_installer_url(self):
        manifest = update_manifest("2.3.4", "example/app", "v2.3.4", "app setup.exe", "signature", "Changes", "2030-01-01T00:00:00Z")
        self.assertEqual(manifest["version"], "2.3.4")
        platform = manifest["platforms"]["windows-x86_64"]
        self.assertEqual(platform["signature"], "signature")
        self.assertEqual(platform["url"], "https://github.com/example/app/releases/download/v2.3.4/app%20setup.exe")
        self.assertEqual(manifest["notes"], "Changes")


if __name__ == "__main__":
    unittest.main()

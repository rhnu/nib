"""Pure release metadata checks; no GitHub requests or local installer execution."""

import unittest

from release import stable_version, update_manifest


class ReleaseMetadataTests(unittest.TestCase):
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

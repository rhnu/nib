use super::supported_locale;

#[test]
fn system_language_distinguishes_chinese_scripts_and_regions() {
    for locale in ["zh", "zh-CN", "zh-SG", "zh-Hans-HK", "ZH_cn"] {
        assert_eq!(supported_locale(locale), Some(true));
    }
    for locale in ["zh-TW", "zh-Hant", "zh-Hant-CN", "ja-JP"] {
        assert_eq!(supported_locale(locale), None);
    }
    assert_eq!(supported_locale("en-GB"), Some(false));
}

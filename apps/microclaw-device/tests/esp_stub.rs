use microclaw_device::esp_feature_hint;

#[test]
fn esp_feature_hint_reports_disabled_on_host() {
    assert_eq!(esp_feature_hint(), "esp-idf disabled");
}

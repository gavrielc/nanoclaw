use microclaw_connectors::DiscordConnector;

#[test]
fn builds_discord_message_url() {
    let url = DiscordConnector::message_url("123");
    assert_eq!(url, "https://discord.com/api/v10/channels/123/messages");
}

#[test]
fn builds_discord_auth_header() {
    let header = DiscordConnector::auth_header("token");
    assert_eq!(
        header,
        ("Authorization".to_string(), "Bot token".to_string())
    );
}

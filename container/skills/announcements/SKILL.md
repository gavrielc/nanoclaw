---
name: announcements
description: Make spoken TTS announcements on Home Assistant media players (Sonos, Google Home, Echo, etc.) via ha-mcp. Use for reminders, notifications, proactive alerts, or any time you need to speak out loud in the house.
allowed-tools: mcp__home-assistant__ha_call_service, mcp__home-assistant__ha_search_entities, mcp__home-assistant__ha_get_state
---

# TTS Announcements via Home Assistant

## Making an announcement

Use `mcp__home-assistant__ha_call_service` with domain `tts` and service `speak`:

```json
{
  "domain": "tts",
  "service": "speak",
  "entity_id": "tts.google_en_com",
  "data": {
    "media_player_entity_id": "media_player.kitchen_speaker",
    "message": "Time to check the oven"
  }
}
```

The `entity_id` is the TTS engine entity (e.g., `tts.google_en_com`, `tts.piper`). The `media_player_entity_id` in `data` is the speaker to play on.

## Discovering speakers

Find available media players with `mcp__home-assistant__ha_search_entities`:

```json
{
  "search_query": "media player",
  "entity_type": "media_player"
}
```

To find speakers in a specific room:

```json
{
  "search_query": "kitchen speaker"
}
```

## Discovering TTS engines

Find available TTS engines:

```json
{
  "search_query": "tts"
}
```

## Multi-room announcements

Call `ha_call_service` once per speaker, or target a speaker group entity if one is configured:

```json
{
  "domain": "tts",
  "service": "speak",
  "entity_id": "tts.google_en_com",
  "data": {
    "media_player_entity_id": "media_player.all_speakers",
    "message": "Dinner is ready"
  }
}
```

## Setting volume before announcing

Adjust volume first for important announcements:

```json
{
  "domain": "media_player",
  "service": "volume_set",
  "entity_id": "media_player.kitchen_speaker",
  "data": {
    "volume_level": 0.6
  }
}
```

## Guidelines

- Keep messages concise and natural-sounding.
- For scheduled reminders, announce on the most relevant speaker (e.g., kitchen for cooking timers, bedroom for morning alarms).
- If you don't know which speaker to use, search for media players first and pick the most appropriate one based on context.
- When a voice request came from a specific room (check the message context), announce back to that room's speaker.

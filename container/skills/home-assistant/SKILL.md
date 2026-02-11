---
name: home-assistant
description: Control smart home devices, query sensor data, and manage automations via Home Assistant. Use whenever the user asks about lights, climate, locks, sensors, media players, or any home automation task.
allowed-tools: mcp__home-assistant__ha_call_service, mcp__home-assistant__ha_search_entities, mcp__home-assistant__ha_get_state
---

# Home Assistant Control via ha-mcp

You have access to Home Assistant through MCP tools. These tools connect to ha-mcp, which provides fuzzy entity search, device control, and state queries.

## Finding entities

Use `mcp__home-assistant__ha_search_entities` to discover entities. It supports fuzzy matching — you don't need exact entity IDs:

```json
{ "search_query": "bedroom lights" }
{ "search_query": "living room temperature" }
{ "search_query": "front door lock" }
{ "search_query": "thermostat" }
```

Filter by type for precision:

```json
{ "search_query": "kitchen", "entity_type": "light" }
{ "search_query": "humidity", "entity_type": "sensor" }
```

## Controlling devices

Use `mcp__home-assistant__ha_call_service` with the appropriate domain and service:

### Lights

```json
{ "domain": "light", "service": "turn_on", "entity_id": "light.bedroom_ceiling" }
{ "domain": "light", "service": "turn_on", "entity_id": "light.bedroom_ceiling", "data": { "brightness": 128 } }
{ "domain": "light", "service": "turn_on", "entity_id": "light.bedroom_ceiling", "data": { "color_temp_kelvin": 3000 } }
{ "domain": "light", "service": "turn_off", "entity_id": "light.bedroom_ceiling" }
```

### Climate

```json
{ "domain": "climate", "service": "set_temperature", "entity_id": "climate.thermostat", "data": { "temperature": 72 } }
{ "domain": "climate", "service": "set_hvac_mode", "entity_id": "climate.thermostat", "data": { "hvac_mode": "heat" } }
```

### Locks

```json
{ "domain": "lock", "service": "lock", "entity_id": "lock.front_door" }
{ "domain": "lock", "service": "unlock", "entity_id": "lock.front_door" }
```

### Switches & covers

```json
{ "domain": "switch", "service": "turn_on", "entity_id": "switch.office_fan" }
{ "domain": "cover", "service": "open_cover", "entity_id": "cover.garage_door" }
{ "domain": "cover", "service": "close_cover", "entity_id": "cover.garage_door" }
```

### Media players

```json
{ "domain": "media_player", "service": "media_play", "entity_id": "media_player.living_room" }
{ "domain": "media_player", "service": "media_pause", "entity_id": "media_player.living_room" }
{ "domain": "media_player", "service": "volume_set", "entity_id": "media_player.living_room", "data": { "volume_level": 0.5 } }
```

## Querying state

Use `mcp__home-assistant__ha_get_state` to read current values:

```json
{ "entity_id": "sensor.living_room_temperature" }
{ "entity_id": "light.bedroom_ceiling" }
{ "entity_id": "lock.front_door" }
```

## Workflow

1. **Search first** if you don't know the exact entity ID. The fuzzy search handles typos and partial names.
2. **Control** using the entity IDs returned by search.
3. **Verify** with `ha_get_state` if you need to confirm the action took effect.

## Room-scoped requests

When a user says "the lights" without specifying a room, check the message context for a room hint (e.g., voice requests include the originating room). Search for entities in that room:

```json
{ "search_query": "bedroom light", "entity_type": "light" }
```

## Bulk operations

For "turn off all lights", search broadly then call service for each:

```json
{ "search_query": "light", "entity_type": "light" }
```

Then call `turn_off` for each entity. Or use the `all` entity if available:

```json
{ "domain": "light", "service": "turn_off", "entity_id": "all" }
```

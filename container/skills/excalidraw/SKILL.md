---
name: excalidraw
description: Create diagrams, wireframes, flowcharts, architecture diagrams, and visual sketches using Excalidraw. Generates Excalidraw JSON files or uses the browser to draw interactively.
allowed-tools: Bash(agent-browser:*), Write, Read
---

# Excalidraw Diagramming

Create visual diagrams programmatically using Excalidraw's JSON format, or interactively via the browser.

---

## Method 1: JSON Files (Preferred — No Browser Needed)

Excalidraw files are JSON with `.excalidraw` extension. Generate them directly for maximum control.

### Minimal Template

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "nanoclaw",
  "elements": [],
  "appState": {
    "gridSize": 20,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

### Element Types

Every element shares these base properties:

```json
{
  "id": "unique-id",
  "type": "rectangle",
  "x": 100,
  "y": 100,
  "width": 200,
  "height": 80,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "#a5d8ff",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "roughness": 1,
  "opacity": 100,
  "roundness": { "type": 3 },
  "seed": 1234,
  "version": 1,
  "isDeleted": false,
  "boundElements": null,
  "link": null,
  "locked": false
}
```

Available types: `rectangle`, `ellipse`, `diamond`, `line`, `arrow`, `text`, `freedraw`, `image`, `frame`

### Text Element

```json
{
  "type": "text",
  "x": 150,
  "y": 120,
  "text": "My Label",
  "fontSize": 20,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "parent-element-id",
  "originalText": "My Label"
}
```

`fontFamily`: 1 = Virgil (hand-drawn), 2 = Helvetica, 3 = Cascadia (monospace)

### Arrow / Line

```json
{
  "type": "arrow",
  "x": 300,
  "y": 140,
  "width": 200,
  "height": 0,
  "points": [[0, 0], [200, 0]],
  "startArrowhead": null,
  "endArrowhead": "arrow",
  "startBinding": { "elementId": "source-id", "focus": 0, "gap": 5 },
  "endBinding": { "elementId": "target-id", "focus": 0, "gap": 5 }
}
```

### Binding Text to Shapes

To put text inside a rectangle:

1. Create the rectangle with `"boundElements": [{"id": "text-id", "type": "text"}]`
2. Create the text with `"containerId": "rectangle-id"`

### Color Palette (Excalidraw defaults)

| Color | Hex | Use |
|-------|-----|-----|
| Blue | `#a5d8ff` | Primary boxes |
| Green | `#b2f2bb` | Success, done |
| Yellow | `#ffec99` | Warning, pending |
| Red | `#ffc9c9` | Error, blocked |
| Purple | `#d0bfff` | External services |
| Gray | `#e9ecef` | Disabled, notes |
| Orange | `#ffd8a8` | Highlight |

---

## Method 2: Browser (Interactive)

Use `agent-browser` to draw on excalidraw.com when you need freeform sketching or to edit existing diagrams.

```bash
agent-browser open "https://excalidraw.com"
agent-browser snapshot -i
```

### Export from browser

```bash
# Screenshot the canvas
agent-browser screenshot diagram.png --full

# Export as .excalidraw JSON via keyboard shortcut
agent-browser press "Control+Shift+E"
```

### Import JSON into browser

1. Open excalidraw.com
2. Use the hamburger menu → "Open" to load a `.excalidraw` file

---

## Common Diagram Patterns

### Architecture Diagram

Layout pattern: services as rectangles, arrows for data flow, databases as cylinders (use ellipse + rectangle combo).

```
[Frontend] → [API Gateway] → [Auth Service]
                           → [Product Service] → [Database]
                           → [Billing Service] → [Stripe]
```

Grid spacing: 250px horizontal, 150px vertical between components.

### Flowchart

Layout pattern: diamond for decisions, rectangles for actions, arrows for flow.

- Start/End: ellipse with green/red background
- Process: rectangle with blue background
- Decision: diamond with yellow background
- Arrow labels: text elements bound to arrows

### Wireframe

- Use `roughness: 0` for cleaner lines
- Background: `#ffffff`
- Borders: `#868e96` (gray)
- Use frames to group sections (header, sidebar, content)
- Standard widths: Mobile 375px, Tablet 768px, Desktop 1440px

### ERD (Entity Relationship)

- Tables: rectangles with table name in bold text at top
- Fields: text elements inside, monospace font (`fontFamily: 3`)
- Relations: arrows with labels (1:1, 1:N, N:M)

---

## File Management

Save diagrams to the workspace:

```
{workspace}/docs/diagrams/           # Architecture, system diagrams
{workspace}/docs/wireframes/         # UI wireframes
{workspace}/docs/flowcharts/         # Process flows
```

Naming: `{topic}-{type}.excalidraw` (e.g., `auth-flow-architecture.excalidraw`)

---

## Tips

- **Seed**: Use `Math.floor(Math.random() * 100000)` for each element — seeds control the hand-drawn roughness variation
- **IDs**: Use descriptive IDs like `"auth-service"`, `"db-users"` — makes the JSON readable
- **Grouping**: Use `"groupIds": ["group-1"]` to group related elements
- **Locked**: Set `"locked": true` on background/frame elements to prevent accidental moves
- **Version**: Always increment `"version"` when updating an element

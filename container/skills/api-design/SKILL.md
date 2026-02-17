---
name: api-design
description: Design and build REST APIs with Next.js route handlers, Zod validation, error handling, pagination, and rate limiting. Covers OpenAPI spec generation and API client patterns.
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(node:*), Read, Write, Edit, Glob, Grep
---

# API Design — REST APIs for MicroSaaS

Build consistent, well-structured APIs using Next.js App Router.

---

## Route Handler Pattern

### Basic CRUD

```typescript
// app/api/projects/route.ts
import { auth } from "@/lib/auth";
import { getTenant } from "@/lib/tenant";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

// GET /api/projects — list
export async function GET(req: Request) {
  const tenant = await getTenant();
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const offset = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.project.findMany({ where: { tenantId: tenant.id }, skip: offset, take: limit, orderBy: { createdAt: "desc" } }),
    prisma.project.count({ where: { tenantId: tenant.id } }),
  ]);

  return Response.json({
    data: items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

// POST /api/projects — create
export async function POST(req: Request) {
  const tenant = await getTenant();
  const body = await req.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  await checkLimit(tenant.id, "projects");

  const project = await prisma.project.create({
    data: { ...parsed.data, tenantId: tenant.id },
  });

  return Response.json({ data: project }, { status: 201 });
}
```

### Single Resource

```typescript
// app/api/projects/[id]/route.ts

// GET /api/projects/:id
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const tenant = await getTenant();
  const project = await prisma.project.findFirst({
    where: { id: params.id, tenantId: tenant.id },  // always scope to tenant
  });

  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ data: project });
}

// PATCH /api/projects/:id
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const tenant = await getTenant();
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const project = await prisma.project.updateMany({
    where: { id: params.id, tenantId: tenant.id },
    data: parsed.data,
  });

  if (project.count === 0) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ data: await prisma.project.findUnique({ where: { id: params.id } }) });
}

// DELETE /api/projects/:id
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const tenant = await getTenant();
  const result = await prisma.project.deleteMany({
    where: { id: params.id, tenantId: tenant.id },
  });

  if (result.count === 0) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
```

---

## Error Handling

### Consistent Error Format

```typescript
// src/lib/api-error.ts
export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message, details: error.details }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: "Validation failed", details: error.flatten() }, { status: 400 });
  }
  console.error("Unhandled API error:", error);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
```

### Route Wrapper

```typescript
// src/lib/api-handler.ts
type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

export function apiHandler(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

// Usage:
export const GET = apiHandler(async (req, { params }) => {
  const project = await getProject(params.id);
  if (!project) throw new ApiError(404, "Project not found");
  return Response.json({ data: project });
});
```

---

## Validation Patterns

### Common Schemas

```typescript
// src/lib/schemas.ts
import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idSchema = z.object({
  id: z.string().uuid(),
});

export const searchSchema = paginationSchema.extend({
  q: z.string().max(200).optional(),
  sort: z.enum(["created", "updated", "name"]).default("created"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
```

### Parse Query Params

```typescript
function parseSearchParams(url: string) {
  const params = Object.fromEntries(new URL(url).searchParams);
  return searchSchema.parse(params);
}
```

---

## Rate Limiting

### Simple In-Memory (Single Server)

```typescript
// src/lib/rate-limit.ts
const requests = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = requests.get(key);

  if (!entry || now > entry.reset) {
    requests.set(key, { count: 1, reset: now + windowMs });
    return true;
  }

  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// Usage in route:
const ip = req.headers.get("x-forwarded-for") || "unknown";
if (!rateLimit(ip, 100, 60_000)) {
  return Response.json({ error: "Too many requests" }, { status: 429 });
}
```

---

## API Response Conventions

### Success

```json
{ "data": { "id": "abc", "name": "My Project" } }
{ "data": [...], "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 } }
```

### Error

```json
{ "error": "Not found" }
{ "error": "Validation failed", "details": { "fieldErrors": { "email": ["Invalid email"] } } }
```

### Status Codes

| Code | When |
|------|------|
| 200 | Success (GET, PATCH) |
| 201 | Created (POST) |
| 204 | Deleted (DELETE) |
| 400 | Validation error |
| 401 | Not authenticated |
| 403 | Not authorized (wrong tenant, insufficient plan) |
| 404 | Resource not found |
| 409 | Conflict (duplicate) |
| 429 | Rate limited |
| 500 | Server error |

---

## API Client (Frontend)

```typescript
// src/lib/api.ts
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl = "/api") {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Request failed" }));
      throw new ApiError(res.status, error.error, error.details);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  }

  // Projects
  listProjects(params?: { page?: number; limit?: number }) {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return this.request<{ data: Project[]; pagination: Pagination }>(`/projects?${qs}`);
  }

  getProject(id: string) {
    return this.request<{ data: Project }>(`/projects/${id}`);
  }

  createProject(data: CreateProjectInput) {
    return this.request<{ data: Project }>("/projects", { method: "POST", body: JSON.stringify(data) });
  }

  updateProject(id: string, data: Partial<CreateProjectInput>) {
    return this.request<{ data: Project }>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  }

  deleteProject(id: string) {
    return this.request<void>(`/projects/${id}`, { method: "DELETE" });
  }
}

export const api = new ApiClient();
```

---

## Webhooks (Outgoing)

For SaaS products that send webhooks to customers:

```typescript
// src/lib/webhooks.ts
import crypto from "crypto";

export async function sendWebhook(url: string, event: string, payload: unknown, secret: string) {
  const body = JSON.stringify({ event, data: payload, timestamp: Date.now() });
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  return { status: res.status, ok: res.ok };
}
```

---
name: deploy
description: Deploy microSaaS products to Vercel, Railway, or VPS. Covers CI/CD with GitHub Actions, environment variables, database migrations, domain setup, and monitoring.
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(node:*), Bash(git:*), Bash(docker:*), Bash(ssh:*), Bash(curl:*), Read, Write, Edit, Glob, Grep
---

# Deploy — Ship MicroSaaS to Production

Deploy patterns for Next.js microSaaS products.

---

## Platform Decision

| Platform | Best For | Cost | Complexity |
|----------|----------|------|------------|
| **Vercel** | Next.js apps, fast iteration | Free tier + $20/mo | Lowest |
| **Railway** | Full-stack (app + DB + workers) | Usage-based, ~$5-20/mo | Low |
| **VPS** (Hetzner/DigitalOcean) | Full control, cost efficiency | $4-20/mo fixed | Medium |
| **Docker + VPS** | Multi-product, self-hosted | $10-40/mo fixed | Higher |

**Recommendation**: Start with Vercel (frontend) + Railway (DB + workers). Migrate to VPS when costs justify.

---

## Vercel Deployment

### Setup

```bash
npm install -g vercel
vercel login
vercel link                 # Link to project
vercel env pull .env.local  # Pull env vars
```

### Deploy

```bash
vercel                      # Preview deployment
vercel --prod               # Production deployment
```

### Configuration

```json
// vercel.json
{
  "framework": "nextjs",
  "regions": ["gru1"],
  "crons": [
    { "path": "/api/cron/cleanup", "schedule": "0 2 * * *" }
  ]
}
```

### Environment Variables

```bash
vercel env add STRIPE_SECRET_KEY production
vercel env add DATABASE_URL production
vercel env add NEXTAUTH_SECRET production
```

---

## GitHub Actions CI/CD

### Basic Pipeline

```yaml
# .github/workflows/ci.yml
name: CI/CD
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm test

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: --prod
```

### Monorepo Pipeline

```yaml
# .github/workflows/ci.yml
name: CI/CD
on:
  push:
    branches: [main]
  pull_request:

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      product-a: ${{ steps.filter.outputs.product-a }}
      product-b: ${{ steps.filter.outputs.product-b }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            product-a: ['apps/product-a/**', 'packages/**']
            product-b: ['apps/product-b/**', 'packages/**']

  deploy-a:
    needs: changes
    if: needs.changes.outputs.product-a == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npx turbo build --filter=product-a
      # deploy product-a
```

---

## Database Migrations

### Prisma (Recommended for SaaS)

```bash
npm install prisma @prisma/client
npx prisma init
```

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  createdAt DateTime @default(now())
}
```

```bash
npx prisma migrate dev --name init    # Development: create + apply
npx prisma migrate deploy             # Production: apply pending
npx prisma generate                   # Regenerate client
```

### Migration in CI/CD

```yaml
deploy:
  steps:
    - run: npx prisma migrate deploy
      env:
        DATABASE_URL: ${{ secrets.DATABASE_URL }}
    - run: npx vercel --prod
```

---

## Docker Deployment (VPS)

### Dockerfile (Next.js)

```dockerfile
FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

### Docker Compose (Multi-Product)

```yaml
# docker-compose.yml
services:
  product-a:
    build: ./apps/product-a
    ports: ["3001:3000"]
    env_file: ./apps/product-a/.env.production
    restart: unless-stopped

  product-b:
    build: ./apps/product-b
    ports: ["3002:3000"]
    env_file: ./apps/product-b/.env.production
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    restart: unless-stopped

volumes:
  pgdata:
  caddy_data:
```

### Caddyfile (Reverse Proxy + Auto HTTPS)

```
product-a.example.com {
  reverse_proxy product-a:3000
}

product-b.example.com {
  reverse_proxy product-b:3000
}
```

---

## Domain Setup

### DNS Records

```
A     product-a.example.com    → server IP
A     product-b.example.com    → server IP
CNAME www.product-a.example.com → product-a.example.com
```

### Vercel Custom Domain

```bash
vercel domains add product-a.example.com
# Follow DNS instructions from Vercel
```

---

## Monitoring

### Health Check Endpoint

```typescript
// app/api/health/route.ts
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;  // DB check
    return Response.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    return Response.json({ status: "error", error: (error as Error).message }, { status: 503 });
  }
}
```

### Uptime Monitoring

Use free tier of UptimeRobot, Better Stack, or Checkly:
- Monitor `/api/health` every 5 minutes
- Alert via email/Telegram on failure

### Error Tracking

```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

---

## Deployment Checklist

Before deploying to production:

- [ ] All env vars set in production (no `.env` file on server)
- [ ] Database migrations applied
- [ ] HTTPS enabled (auto with Vercel/Caddy)
- [ ] Custom domain DNS propagated
- [ ] Health check endpoint responding
- [ ] Error tracking configured (Sentry)
- [ ] Uptime monitoring active
- [ ] Stripe webhook URL updated to production domain
- [ ] NextAuth `NEXTAUTH_URL` set to production URL
- [ ] Backups: database auto-backup enabled
- [ ] Logging: stdout/stderr captured (systemd journal or Docker logs)

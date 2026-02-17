---
name: saas-kit
description: Build microSaaS products with authentication, billing (Stripe), multi-tenancy, and common SaaS patterns. Covers user management, subscription tiers, onboarding flows, and multi-product architecture.
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(node:*), Read, Write, Edit, Glob, Grep
---

# SaaS Kit — MicroSaaS Product Patterns

Patterns and recipes for building multi-product microSaaS applications.

---

## Authentication

### NextAuth.js (Auth.js) Setup

```bash
npm install next-auth @auth/prisma-adapter
```

```typescript
// src/lib/auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({ clientId: process.env.GOOGLE_ID!, clientSecret: process.env.GOOGLE_SECRET! }),
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        // validate against DB
      },
    }),
  ],
  callbacks: {
    session: ({ session, user }) => ({ ...session, user: { ...session.user, id: user.id } }),
  },
});
```

### Middleware (Protected Routes)

```typescript
// middleware.ts
export { auth as middleware } from "@/lib/auth";
export const config = { matcher: ["/app/:path*", "/api/:path*"] };
```

### Auth Guard Component

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");
  return <>{children}</>;
}
```

---

## Stripe Billing

### Setup

```bash
npm install stripe @stripe/stripe-js
```

```typescript
// src/lib/stripe.ts
import Stripe from "stripe";
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

### Product/Price Model

Define tiers in a single config:

```typescript
// src/lib/plans.ts
export const PLANS = {
  free: { name: "Free", priceId: null, limits: { projects: 3, apiCalls: 1000 } },
  pro: { name: "Pro", priceId: "price_xxx", limits: { projects: 50, apiCalls: 50000 } },
  business: { name: "Business", priceId: "price_yyy", limits: { projects: -1, apiCalls: -1 } },
} as const;

export type PlanKey = keyof typeof PLANS;
```

### Checkout Session

```typescript
// app/api/checkout/route.ts
import { stripe } from "@/lib/stripe";
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { priceId } = await req.json();
  const checkout = await stripe.checkout.sessions.create({
    customer_email: session.user.email!,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    success_url: `${process.env.NEXT_PUBLIC_URL}/app/billing?success=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_URL}/app/billing`,
    metadata: { userId: session.user.id },
  });

  return Response.json({ url: checkout.url });
}
```

### Webhook Handler

```typescript
// app/api/webhooks/stripe/route.ts
import { stripe } from "@/lib/stripe";
import { headers } from "next/headers";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = headers().get("stripe-signature")!;
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      // Update user plan in DB
      break;
    }
    case "customer.subscription.deleted": {
      // Downgrade to free
      break;
    }
    case "invoice.payment_failed": {
      // Send warning email, grace period
      break;
    }
  }

  return Response.json({ received: true });
}
```

### Customer Portal

```typescript
export async function createPortalSession(customerId: string) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_URL}/app/billing`,
  });
  return session.url;
}
```

---

## Multi-Tenancy

### Schema Pattern (Shared DB, Tenant Column)

For microSaaS, use shared database with `tenantId` column (simplest, scales well up to ~1000 tenants).

```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  -- always filter by tenant_id!
);

CREATE INDEX idx_projects_tenant ON projects(tenant_id);
```

### Tenant Context

```typescript
// src/lib/tenant.ts
import { auth } from "@/lib/auth";
import { prisma } from "./db";

export async function getTenant() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const membership = await prisma.membership.findFirst({
    where: { userId: session.user.id },
    include: { tenant: true },
  });

  if (!membership) throw new Error("No tenant");
  return membership.tenant;
}
```

### Usage Limits

```typescript
// src/lib/limits.ts
import { PLANS } from "./plans";

export async function checkLimit(tenantId: string, resource: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const plan = PLANS[tenant.plan as PlanKey];
  const limit = plan.limits[resource as keyof typeof plan.limits];

  if (limit === -1) return; // unlimited

  const current = await countResource(tenantId, resource);
  if (current >= limit) {
    throw new Error(`Plan limit reached: ${resource} (${current}/${limit}). Upgrade to continue.`);
  }
}
```

---

## Multi-Product Architecture

For a multi-product microSaaS startup, structure as a monorepo with shared packages:

```
apps/
  product-a/          # Next.js app
  product-b/          # Next.js app
  landing/            # Marketing site
packages/
  ui/                 # Shared component library
  auth/               # Shared auth logic
  billing/            # Shared Stripe logic
  db/                 # Shared database client + schema
  config/             # Shared ESLint, TS config
```

### Turborepo Setup

```bash
npx create-turbo@latest
```

```json
// turbo.json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "persistent": true },
    "lint": {},
    "test": {}
  }
}
```

### Shared UI Package

```json
// packages/ui/package.json
{
  "name": "@company/ui",
  "exports": { ".": "./src/index.ts", "./button": "./src/button.tsx" }
}
```

Import in apps: `import { Button } from "@company/ui/button";`

---

## Onboarding Flow

Standard microSaaS onboarding:

1. **Sign up** → Create user + tenant
2. **Welcome** → Product tour / key feature highlight
3. **Setup** → Core configuration (team name, invite members, connect integrations)
4. **Activation** → Guide to first value moment (create first project, import data)

```tsx
// app/(app)/onboarding/page.tsx
const STEPS = ["welcome", "setup", "activate"] as const;

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const Component = { welcome: Welcome, setup: Setup, activate: Activate }[STEPS[step]];
  return (
    <div className="mx-auto max-w-lg py-12">
      <StepIndicator steps={STEPS} current={step} />
      <Component onNext={() => setStep(s => Math.min(s + 1, STEPS.length - 1))} />
    </div>
  );
}
```

---

## Environment Variables

```env
# Auth
GOOGLE_ID=
GOOGLE_SECRET=
NEXTAUTH_SECRET=          # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Database
DATABASE_URL=postgresql://...

# App
NEXT_PUBLIC_URL=http://localhost:3000
```

---

## SaaS Checklist

Before launch:

- [ ] Auth: signup, login, logout, password reset, email verification
- [ ] Billing: free tier, paid tiers, upgrade/downgrade, cancel
- [ ] Multi-tenancy: data isolation, tenant switching (if multi-workspace)
- [ ] Onboarding: first-run experience, activation metric
- [ ] Settings: profile, team members, billing, notifications
- [ ] Error handling: 404, 500, rate limits, grace periods
- [ ] Legal: terms, privacy policy, cookie consent
- [ ] Analytics: page views, feature usage, conversion events
- [ ] Email: transactional (welcome, invoice, alerts)
- [ ] SEO: meta tags, OG images, sitemap, robots.txt

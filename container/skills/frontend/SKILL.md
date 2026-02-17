---
name: frontend
description: Build React/Next.js frontends with Tailwind CSS. Covers project setup, component patterns, routing, state management, forms, and responsive design for microSaaS products.
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(node:*), Read, Write, Edit, Glob, Grep
---

# Frontend Development (React / Next.js / Tailwind)

Build production-quality frontends for microSaaS products.

---

## Project Scaffolding

### New Next.js App

```bash
npx create-next-app@latest {name} \
  --typescript --tailwind --eslint --app \
  --src-dir --import-alias "@/*" --no-turbopack
```

### Essential Dependencies

```bash
npm install zod react-hook-form @hookform/resolvers  # Forms + validation
npm install lucide-react                              # Icons
npm install clsx tailwind-merge                       # Class utilities
npm install sonner                                    # Toast notifications
```

### Recommended Structure

```
src/
  app/                    # Next.js App Router
    (marketing)/          # Public pages (landing, pricing)
    (app)/                # Authenticated app pages
      dashboard/
      settings/
    api/                  # API routes
    layout.tsx
  components/
    ui/                   # Reusable primitives (Button, Input, Card)
    features/             # Feature-specific (PricingTable, UserMenu)
    layouts/              # Shell, Sidebar, Header
  lib/
    utils.ts              # cn(), formatDate(), etc.
    api.ts                # API client functions
    constants.ts          # App-wide constants
  hooks/                  # Custom React hooks
  types/                  # TypeScript types/interfaces
```

---

## Component Patterns

### `cn()` Utility (Create First)

```typescript
// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Button Component

```tsx
import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          {
            primary: "bg-blue-600 text-white hover:bg-blue-700",
            secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
            ghost: "hover:bg-gray-100",
            danger: "bg-red-600 text-white hover:bg-red-700",
          }[variant],
          {
            sm: "h-8 px-3 text-sm",
            md: "h-10 px-4 text-sm",
            lg: "h-12 px-6 text-base",
          }[size],
          className
        )}
        {...props}
      >
        {loading && <Spinner className="mr-2 h-4 w-4" />}
        {children}
      </button>
    );
  }
);
```

### Form with Zod + React Hook Form

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Invalid email"),
  name: z.string().min(2, "Name too short"),
});

type FormData = z.infer<typeof schema>;

export function MyForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">Email</label>
        <input {...register("email")} className="mt-1 block w-full rounded-md border px-3 py-2" />
        {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
      </div>
      <Button type="submit" loading={isSubmitting}>Submit</Button>
    </form>
  );
}
```

---

## Tailwind Patterns

### Responsive Design

```
sm:  640px   (mobile landscape)
md:  768px   (tablet)
lg:  1024px  (desktop)
xl:  1280px  (wide desktop)
```

Mobile-first: write base styles for mobile, add breakpoints for larger screens.

### Common Layouts

**Centered Card:**
```html
<div class="flex min-h-screen items-center justify-center bg-gray-50">
  <div class="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
    <!-- content -->
  </div>
</div>
```

**App Shell (Sidebar + Content):**
```html
<div class="flex h-screen">
  <aside class="w-64 border-r bg-gray-50 p-4"><!-- sidebar --></aside>
  <main class="flex-1 overflow-y-auto p-6"><!-- content --></main>
</div>
```

**Dashboard Grid:**
```html
<div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
  <div class="rounded-lg border bg-white p-6"><!-- card --></div>
</div>
```

---

## Data Fetching

### Server Components (Default in App Router)

```tsx
// app/dashboard/page.tsx — runs on server, no "use client"
async function getData() {
  const res = await fetch("https://api.example.com/data", { next: { revalidate: 60 } });
  return res.json();
}

export default async function DashboardPage() {
  const data = await getData();
  return <div>{/* render data */}</div>;
}
```

### Client-Side with SWR

```tsx
"use client";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function UserList() {
  const { data, error, isLoading } = useSWR("/api/users", fetcher);
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorState />;
  return <ul>{data.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

### Server Actions (Forms)

```tsx
// app/actions.ts
"use server";

export async function createProduct(formData: FormData) {
  const name = formData.get("name") as string;
  // validate, save to DB, revalidate
  revalidatePath("/products");
}
```

---

## State Management

For microSaaS, keep it simple:

| Scope | Solution |
|-------|----------|
| Component-local | `useState`, `useReducer` |
| Shared UI state | React Context (theme, sidebar open) |
| Server state | SWR or React Query |
| URL state | `useSearchParams`, `usePathname` |
| Form state | React Hook Form |

Avoid Redux unless the app is very complex. Context + SWR covers most microSaaS needs.

---

## Performance Checklist

- [ ] Use `next/image` for all images (auto optimization)
- [ ] Use `next/link` for navigation (prefetching)
- [ ] Use `next/font` for fonts (no layout shift)
- [ ] Lazy load heavy components: `const Chart = dynamic(() => import("./Chart"), { ssr: false })`
- [ ] Keep client components small — push logic to server components
- [ ] Use `loading.tsx` for page-level loading states
- [ ] Use `Suspense` boundaries for granular loading

---

## Testing

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "jsdom", globals: true }
});
```

```tsx
// Button.test.tsx
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";

test("renders with text", () => {
  render(<Button>Click me</Button>);
  expect(screen.getByRole("button")).toHaveTextContent("Click me");
});
```

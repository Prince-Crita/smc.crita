# Project Structure

The project utilizes the Next.js 16 App Router architecture.

## Overview
```text
/src
 ├── app/               # Next.js App Router Pages & API Routes
 ├── components/        # Reusable React UI Components
 ├── lib/               # Utilities, Database, Auth Client helpers
 └── ...
/prisma
 └── schema.prisma      # Database Schema configuration
```

## Pages (`/src/app`)
- `/app/(dashboard)/admin/...`: Admin interface pages (Client management, Executive management, Analytics, Task config).
- `/app/(dashboard)/executive/...`: Executive interface pages (My Visits, Visit checklists).
- `/app/login/page.tsx`: Authentication entry point.

## Components (`/src/components`)
- `ui/Modal.tsx`: Shared modal wrapper for forms and confirmations.
- `ui/Skeleton.tsx`: Shared loading states for tables and cards.
- `ui/EmptyState.tsx`: Shared zero-state screens.

## API Routes (`/src/app/api`)
- `/api/auth/...`: Login and Logout logic.
- `/api/admin/...`: Protected endpoints for administrative actions (e.g., assigning clients, managing templates).
- `/api/visits/...`: Endpoint handling the lifecycle of visits and subtasks.

## Utilities (`/src/lib`)
- `/lib/utils/utils.ts`: Tailwind CSS class merger (`cn`).
- `/lib/db.ts`: Prisma client singleton.
- `/lib/auth.ts`: Server-side JWT validation helpers.

## Hooks (`/src/hooks` - if applicable)
- Custom hooks (if any are extracted) for shared React logic. Currently, state is mostly managed inline within complex `page.tsx` files.

## Middleware (`/src/middleware.ts`)
- Next.js edge middleware. Intercepts requests to `/admin` and `/executive` to validate the JWT cookie and ensure proper role-based access control.

## Database (`/prisma`)
- PostgreSQL connected via Prisma ORM.

## Authentication
- Custom implementation using HTTP-only cookies and JWT. No external auth provider (like NextAuth or Clerk) is used.

## Layouts
- `/app/layout.tsx`: Root layout, fonts, toaster configuration.
- `/app/(dashboard)/layout.tsx`: Sidebar navigation, header, and authenticated shell.

## Shared Components
- Extensively uses Tailwind utilities inline to enforce the custom design system rather than heavy CSS-in-JS libraries.

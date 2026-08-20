# Complete Technical Handoff Document

## 1. Project Overview

* **Project Name:** SMC Task Management (SMC Audit Services)
* **Purpose of the System:** To manage, track, and optimize field executive visits, operational tasks, and client audits.
* **Business Problem Solved:** Streamlines field audits by replacing manual tracking with a digital workflow. It handles complex subtask completion tracking, automated carry-forward of incomplete tasks to future visits, real-time progress monitoring, and automated summary generation.
* **Target Users:** 
  * **Admin Staff:** Manage clients, executives, task configurations, and monitor overall audit operations and progress.
  * **Field Executives:** Access assigned client visits, complete tasks/subtasks on the field, mark carry-forwards, and close visits.
* **High-Level Summary:** A responsive, mobile-first web application featuring role-based dashboards, complex task workflow management, audit timelines, and performance-optimized database queries.

---

## 2. Final Technology Stack

| Category | Technology | Description |
| :--- | :--- | :--- |
| **Frontend Framework** | Next.js 16 (App Router) | React framework for server-rendered UI and optimized routing. |
| **Backend Framework** | Next.js API Routes | Node.js backend logic integrated directly within the Next.js app. |
| **Language** | TypeScript | Strictly typed JavaScript for end-to-end type safety. |
| **UI Libraries** | Tailwind CSS, Radix UI, Lucide React | Utility-first CSS, accessible primitives, and SVG icons. |
| **Database** | Neon PostgreSQL | Serverless Postgres database. |
| **ORM** | Prisma | Type-safe database ORM and schema management. |
| **Authentication** | JWT (jose), bcryptjs | Stateless JSON Web Tokens stored in HTTP-only cookies; bcrypt for password hashing. |
| **Validation** | Zod, React Hook Form | Schema-based payload validation and form state management. |
| **State Management** | React Hooks | `useState`, `useMemo`, `useCallback` for local and derived state. |
| **Email Service** | Resend | Transactional email delivery for visit summaries (optional gracefully-degrading integration). |
| **Deployment** | Vercel (Recommended) | Native Next.js deployment platform. |

---

## 3. System Architecture

The system follows a modern Serverless Monolith architecture using Next.js.
* **Frontend Architecture:** Utilizes Next.js Server Components for initial data fetching and fast rendering, and Client Components for interactive elements (Modals, Forms).
* **Backend Architecture:** RESTful API route handlers (`src/app/api/...`) processing business logic securely on the server side.
* **Database Layer:** Prisma Client querying a Neon Serverless PostgreSQL database.
* **Authentication Layer:** Custom JWT-based middleware protecting routes and APIs. Tokens are issued via an `HttpOnly` cookie.
* **Email Layer:** Asynchronous Resend API integration that falls back to console logging if credentials are not provided.

```mermaid
architecture-beta
    group frontend(cloud)[Frontend (Next.js)]
    service ui(server)[UI Components] in frontend
    service pages(server)[Server Components] in frontend
    
    group backend(cloud)[Backend API (Next.js)]
    service auth(server)[Auth Middleware] in backend
    service api(server)[Route Handlers] in backend
    
    group db(database)[Database Layer]
    service prisma(database)[Prisma ORM] in db
    service neon(database)[Neon PostgreSQL] in db
    
    group external(cloud)[External Services]
    service resend(server)[Resend Email API] in external

    ui:R --> L:pages
    pages:R --> L:auth
    auth:R --> L:api
    api:R --> L:prisma
    prisma:R --> L:neon
    api:B --> T:resend
```

---

## 4. Final Folder Structure

```text
src/
├── app/
│   ├── (auth)/             # Login pages and auth layouts
│   ├── (dashboard)/        # Main app UI (admin & executive nested layouts)
│   │   ├── admin/          # Admin-only pages (Clients, Execs, Visits, Carry Forward)
│   │   └── executive/      # Executive-only pages (My Visits, Task execution)
│   ├── api/                # Backend API Route Handlers
│   │   ├── admin/          # Admin-secured APIs
│   │   ├── auth/           # Login/Logout APIs
│   │   ├── tasks/          # Task progression APIs
│   │   └── visits/         # Visit manipulation and closure APIs
│   ├── globals.css         # Global Tailwind styles and animations
│   └── layout.tsx          # Root layout
├── components/
│   ├── admin/              # Admin-specific UI components (Modals, Forms)
│   ├── layout/             # Shared layout components (Sidebar, BottomNav)
│   └── ui/                 # Reusable UI primitives (Portal-Modal, Skeleton, Badge, ProgressBar)
├── lib/
│   ├── auth/               # JWT token generation, verification, and middleware logic
│   ├── db/                 # Prisma client instantiation
│   ├── utils/              # Helper functions (cn, formatDate, progress math)
│   └── validations/        # Zod validation schemas
prisma/
├── schema.prisma           # Database schema definition
└── seed.ts                 # Database seed script for initial templates
```

---

## 5. Authentication & Authorization Flow

* **Login Flow:** User submits credentials -> Backend validates hash -> Generates JWT -> Sets `HttpOnly` cookie.
* **Session Handling:** Stateless JWT token. Expiration handled via token payload.
* **Role-based Access Control (RBAC):** Middleware checks `user.role`. Executive users trying to access `/admin` paths are blocked.
* **Route & API Protection:** `middleware.ts` guards page routes; `getAuthUser()` helper guards API routes.

```mermaid
sequenceDiagram
    participant User
    participant Client
    participant AuthAPI as API (/api/auth/login)
    participant Middleware
    participant ProtectedAPI as API (/api/admin/*)
    
    User->>Client: Enters Credentials
    Client->>AuthAPI: POST {email, password}
    AuthAPI->>AuthAPI: Verify bcrypt hash
    AuthAPI->>Client: 200 OK + Set-Cookie: token (HttpOnly)
    
    User->>Client: Navigates to /admin
    Client->>Middleware: Request page
    Middleware->>Middleware: Verify JWT & Role
    Middleware->>Client: Allow or Redirect
    
    Client->>ProtectedAPI: GET Request (includes cookie)
    ProtectedAPI->>ProtectedAPI: Verify JWT
    ProtectedAPI->>Client: JSON Response
```

---

## 6. Database Documentation

### Entity Relationship Diagram

```mermaid
erDiagram
    USER ||--o{ VISIT : "assigned to"
    USER ||--o{ CLIENT : "manages"
    USER ||--o{ ACTIVITY_LOG : "performs"
    CLIENT ||--o{ VISIT : "receives"
    VISIT ||--o{ TASK : "contains"
    VISIT ||--o{ ACTIVITY_LOG : "has"
    VISIT ||--o{ VISIT_REASSIGNMENT : "undergoes"
    TASK ||--o{ SUBTASK : "broken down into"
    SUBTASK ||--o| SUBTASK : "carried forward from"

    USER {
        String id PK
        String email UK
        String passwordHash
        Role role
        Boolean isActive
    }
    CLIENT {
        String id PK
        String code UK
        String name
        Boolean isArchived
    }
    VISIT {
        String id PK
        String visitNumber UK
        VisitStatus status
        Float progress
    }
    TASK {
        String id PK
        TaskType taskType
        TaskStatus status
    }
    SUBTASK {
        String id PK
        Boolean isCompleted
        Boolean isCarriedForward
    }
```

### Table Dictionary

* **User (`users`):** Stores Admins and Field Executives. Role distinguishes permissions.
* **Client (`clients`):** Stores client details and assigned default executive.
* **Visit (`visits`):** The core operational entity. A visit belongs to a client and is assigned to an executive. Tracks overall status and final JSON summary.
* **Task (`tasks`):** Broad categories of work within a visit (e.g., Operational Verification, MD Meeting).
* **Subtask (`subtasks`):** Granular checklist items. Tracks completion, incompletion reasons, and carry-forward lineage.
* **SubtaskTemplate (`subtask_templates`):** Admin-configurable master templates used to auto-generate tasks for new visits.
* **VisitReassignment (`visit_reassignments`):** Audit trail of visit transfers between executives.
* **ActivityLog (`activity_logs`):** System-wide audit trail recording user actions.

---

## 7. Module-wise Feature Documentation

### Authentication Module
* JWT-based login/logout.
* Password hashing with `bcryptjs`.
* Route-level and API-level protection.

### Admin Module
* **Dashboard:** Aggregated statistics, pending/in-progress/closed counts, recent executive activity.
* **Executives Management:** Add, edit, deactivate executives. Password reset capability.
* **Clients Management:** Add, edit, archive clients. Assign default executives. Configurable report recipients.
* **Task Configuration:** Dynamic UI to add/edit/disable subtask templates per task category.
* **All Visits:** Centralized grid view of all visits across the company.
* **Carry Forward:** Dedicated tracking page for unresolved tasks rolled over from previous visits.
* **Reassignment:** Ability to move visits between executives with required reason logging.

### Executive Module
* **Dashboard:** Drill-down modal metrics (Pending, In Progress, Closed).
* **My Visits:** Filterable view of assigned visits.
* **Visit Execution:** Interactive subtask toggling.
* **Carry-Forward Mechanism:** UI to mark tasks as impossible to complete, triggering automatic roll-over.
* **Visit Closure:** Intelligent summary generation upon completing all requirements.

### Notification & Email Module
* **Activity Logs:** Automatic background tracking of critical changes (e.g., VISIT_REASSIGNED, SUBTASK_COMPLETED).
* **Resend Integration:** Dispatches formatted HTML reports to client stakeholders upon visit closure. Fallback to terminal logging if API key absent.

---

## 8. Business Workflow Documentation

### Visit Lifecycle
```mermaid
stateDiagram-v2
    [*] --> PENDING: Created
    PENDING --> IN_PROGRESS: Executive toggles first subtask
    IN_PROGRESS --> CLOSED: 100% Tasks Completed & Summary Generated
    CLOSED --> [*]
```

### Carry-Forward Flow
```mermaid
stateDiagram-v2
    state "Executive marks Subtask as Carried Forward" as CF
    state "Require Reason Input" as R
    state "Save Status" as S
    state "Next Visit Creation" as NVC
    state "Copy Incomplete Subtasks" as COPY
    
    [*] --> CF
    CF --> R
    R --> S
    S --> NVC
    NVC --> COPY
    COPY --> [*]
```

---

## 9. Core Business Rules

1. **Visit Status Triggers:**
   * **Pending:** 0% progress.
   * **In Progress:** 1% to 99% progress.
   * **Closed:** 100% progress exactly, all tasks finished, MD Meeting fully answered.
2. **Carry-Forward Logic:**
   * A subtask marked as 'carried forward' does not block the current visit from reaching 100% (it is excluded from the required denominator).
   * When a new visit is scheduled for that client, all previously carried-forward subtasks are automatically injected into the new visit's tasks.
3. **Task Completion Rules:**
   * A Task is `COMPLETED` only when all its child Subtasks are `COMPLETED`.
   * The *MD Meeting* task specifically requires answering a boolean Yes/No question, not just a subtask checkbox.
4. **Data Isolation:**
   * Executives can ONLY read and update their explicitly assigned visits.
   * Admins have universal read/write access.

---

## 10. API Documentation

| Route | Method | Access | Purpose |
| :--- | :--- | :--- | :--- |
| `/api/auth/login` | POST | Public | Authenticate user, set HttpOnly JWT cookie. |
| `/api/auth/logout` | POST | Public | Clear JWT cookie. |
| `/api/admin/stats` | GET | Admin | Fetch aggregated dashboard counters. Optimized payload. |
| `/api/admin/executives` | GET/POST | Admin | List executives / Create new executive. |
| `/api/admin/executives/[id]` | GET/PATCH | Admin | Get detail / Edit executive profile. |
| `/api/admin/executives/[id]/reset-password` | POST | Admin | Reset executive login password. |
| `/api/admin/clients` | GET/POST | Admin | List clients / Create new client. |
| `/api/admin/clients/[id]` | GET/PATCH | Admin | Get detail / Update client. |
| `/api/admin/subtask-templates` | GET/POST | Admin | Manage task configuration templates. |
| `/api/admin/subtask-templates/[id]` | PATCH/DELETE | Admin | Update/Remove task template. |
| `/api/admin/visits` | GET | Admin | Fetch all system visits. |
| `/api/admin/visits/[id]/reassign` | POST | Admin | Reassign visit to new executive. |
| `/api/admin/carry-forward` | GET | Admin | Fetch global carry-forward metrics. |
| `/api/visits` | GET | Exec | Fetch executive's assigned visits. |
| `/api/visits/[id]` | GET | Exec | Fetch detailed visit payload (tasks, subtasks). |
| `/api/visits/[id]/close` | POST | Exec | Trigger final validation, generate summary, send email. |
| `/api/tasks/[id]/complete` | POST | Exec | Toggle subtask completion/carry-forward state. |

---

## 11. Advanced Features Implemented

* **Universal Portal Modal Architecture:** Solves iOS Safari and mobile layout bugs by utilizing `ReactDOM.createPortal`. Modals render outside of scroll-locked layout containers, ensuring perfect `fixed` centering and preventing bottom-nav clipping.
* **Optimized Prisma Payloads:** Refactored APIs use explicit `select` statements instead of wide `include` statements. Eliminates N+1 queries.
* **Optimistic UI Updates:** Toggle states and progress bars update instantly on the frontend before the server confirmation resolves.
* **Smart Summary Generation:** Backend aggregates completed tasks, skipped tasks, and reasons into a finalized JSON structure saved immutably on visit closure.
* **Resend Email Resilience:** Environment-aware email module. If `RESEND_API_KEY` is missing, the system gracefully degrades to logging the report to the console instead of throwing 500 errors.

---

## 12. Security Implementation

* **Data Rest:** Passwords hashed with `bcryptjs` (salt rounds = 12).
* **Data Transit:** JWT payload securely signed via `jose`. Tokens never exposed to JavaScript (`HttpOnly`, `Secure`, `SameSite=Strict`).
* **Input Validation:** Backend enforces strict payload structures using `Zod`.
* **Authorization Checks:** Every `/api/admin/*` route forcefully verifies the `ROLE === 'ADMIN'`. Every `/api/visits/*` route verifies ownership mapping between the authenticated `user.id` and the requested `visit.executiveId`.

---

## 13. Performance Optimizations

* **Render Efficiency:** Heavy components (`VisitCard`, `ExecutiveRow`, `TaskCard`) wrapped in `React.memo`.
* **Derived State Caching:** Aggregations (progress counts, filtered lists) cached via `useMemo`.
* **Layout Skeletons:** Implemented Next.js `loading.tsx` Suspense boundaries for immediate transition feedback.
* **API Payload Minimization:** Mobile API endpoints strip unused relation IDs and timestamps to dramatically reduce JSON payload size over cellular networks.
* **Per-visit subtask COUNTs, not subtask rows:** every list screen needs three numbers per visit (total / completed / carried-forward). These used to be produced by loading EVERY subtask row of every visit and counting them in JavaScript. `src/lib/utils/visit-aggregates.ts` asks PostgreSQL for the counts instead — one row per visit rather than one row per subtask — and `/api/admin/stats`, `/api/admin/visits`, `/api/admin/executives`, `/api/admin/executives/[id]`, `/api/calendar` and `/api/visits` all go through it. Use it for any new endpoint that needs visit progress; never re-add a `tasks: { select: { subtasks: ... } }` include to a list endpoint.
* **Lists no longer serialise the task tree:** the visit lists used to spread the whole Prisma row (including `tasks[].subtasks[]`) into the JSON response. They now return only the fields the UI reads.
* **One layout is built, not two:** the admin dashboard and admin visit list ship a desktop layout and a mobile layout in the same component and let CSS hide one. CSS hides — it does not skip — so both were being rendered on every device. `src/lib/hooks/useIsDesktop.ts` gates them on the same 768px breakpoint the classes use.
* **Database indexes:** `prisma/sql/performance-indexes.sql` (mirrored by the `@@index` declarations in `prisma/schema.prisma`). PostgreSQL does not index foreign keys automatically, so visit lookups by client/executive/date and every `activity_logs` lookup were sequential scans. **This file must be applied to any database that predates it** — see §16b.
* **No HTTP caching of API responses:** `next.config.ts` sets `Cache-Control: private, no-store` on `/api/*`. An earlier `s-maxage` + `stale-while-revalidate` header let a browser answer `/api/visits` from its own cache, so an executive could still see a visit an admin had just deleted. Admin ↔ Executive synchronisation depends on every API read reaching the server; do not reintroduce caching on these routes.

---

## 14. Environment Variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"

# Authentication
JWT_SECRET="your-super-secure-jwt-secret-key-min-32-chars"

# Email Configuration (Optional - will fallback to console if empty)
RESEND_API_KEY="re_123456789"
```

---

## 15. Installation & Setup Guide

**Prerequisites:** Node.js 18+, npm/yarn.

1. **Clone & Install:**
   ```bash
   git clone <repo-url>
   cd smc-task-management
   npm install
   ```
2. **Environment Setup:** Copy the `.env` variables as shown in Section 14.
3. **Database Sync & Seed:**
   ```bash
   npx prisma db push
   npm run prisma:seed
   ```
4. **Run Local Server:**
   ```bash
   npm run dev
   ```
   *Access `http://localhost:3000`.*
5. **Production Build:**
   ```bash
   npm run build
   npm start
   ```

---

## 16. Third-party Services

* **Neon PostgreSQL:** Serverless DB connection.
* **Resend:** Transactional email API for client reports.
* **Vercel (Target):** Optimized edge networking and Next.js hosting.

---

## 16a. Local development environment (which database am I using?)

**One rule: local development uses the local PostgreSQL server, and nothing else.**

### Where DATABASE_URL comes from

Next.js loads env files in this order for `npm run dev`, and the FIRST source to
define a key wins:

| Precedence | Source | Holds DATABASE_URL? |
|---|---|---|
| 1 (highest) | `DATABASE_URL` set in your **shell** | overrides everything |
| 2 | `.env.development.local` | **yes — the local PostgreSQL server** |
| 3 | `.env.local` | **no, deliberately** (shared config only) |

`.env.local` used to carry the production connection string. Because Next.js
loads it alongside `.env.development.local`, that was one renamed file away from
pointing local development at the live company database. The production URL now
lives only where it is actually needed:

* company / standalone build → `.env.build`
* Vercel → the Vercel project's environment variables (unchanged)

### The shell is the trap

A `DATABASE_URL` (or `NODE_ENV`, or `PORT`) left over in a PowerShell session
outranks every file above, and Next.js still prints
`Environments: .env.development.local, .env.local` regardless — the banner tells
you which files it *read*, not which value *won*. Check and clear them with:

```powershell
$env:DATABASE_URL          # should print nothing
$env:NODE_ENV              # should print nothing — Next sets it itself
$env:PORT                  # should print nothing
$env:DATABASE_URL = $null
```

### Two safety nets

1. **The dev server refuses to start against a remote database.**
   `src/instrumentation.ts` checks the target before the first request and
   exits with an explanation (`src/lib/db/database-target.ts`). Deliberately
   override with `ALLOW_REMOTE_DB=1`. The check keys off the npm script, not
   `NODE_ENV`, so a stale `NODE_ENV=production` cannot switch it off.

2. **Every non-production start prints its target**, secret-free:

   ```
   [db] development → host=localhost port=5432 db=smc_task_dev user=postgres
   ```

The Prisma CLI follows the same precedence (`prisma.config.ts`) and prints its
target too — `prisma db push` / `migrate` / `studio` / `seed` now default to the
LOCAL database instead of production.

### Verifying at runtime

Reading env files tells you what should happen. This tells you what did:

```
GET http://localhost:3000/api/dev/db-target
```

It reports environment, host, port, database name and role — never a password
or connection string — and is disabled (404) whenever `NODE_ENV=production`.

### Local URL and mount point

* Local development: **http://localhost:3000/**, `NEXT_PUBLIC_BASE_PATH` unset.
  (For a different port: `npm run dev -- -p 3100`.)
* Company deployment: built with `NEXT_PUBLIC_BASE_PATH=/client-trial/smc-task-management`,
  served under that prefix. A browser tab left open on the prefixed URL will
  request `/client-trial/…/_next/static/…` from a root-mounted dev server and
  get a 404 — reload at the root URL, or hard-refresh, rather than changing
  `basePath`.

---

## 16b. Database Index Migration (one-off, required)

The performance indexes added in `prisma/schema.prisma` exist in the schema but
must also be created on any database that was provisioned before them. They are
index-only: no table, column, type, constraint or row is changed, and they can be
applied to a live database.

```bash
# Preferred — builds concurrently, so the tables stay readable and writable.
psql "$DATABASE_URL" -f prisma/sql/performance-indexes.sql

# Alternative — Prisma creates them from schema.prisma instead.
npx prisma db push
```

Verify afterwards:

```sql
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE '%_idx' ORDER BY 1, 2;
```

---

## 17. Known Limitations

* **Offline Capability:** The app currently requires an active internet connection to save subtask progress. No IndexedDB/ServiceWorker offline queueing is currently implemented.
* **Push Notifications:** Updates and reassignments rely on polling/refreshing; no WebSocket or WebPush notifications are natively implemented.

---

## 18. Future Enhancements

* **Offline Sync:** Implement a PWA service worker to queue task updates while in dead cellular zones.
* **PDF Export:** Implement server-side PDF generation (e.g., using Puppeteer or react-pdf) for the visit summary reports.
* **Geo-Fencing:** Require executives to capture GPS coordinates proving physical presence at the client site before allowing visit closure.
* **Photo Attachments:** S3/Blob storage integration to allow photo evidence upload for subtask completion.


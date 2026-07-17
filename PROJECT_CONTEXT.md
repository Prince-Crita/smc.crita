# Project Context

## Project Name
SMC Task Management System

## Project Goal
A comprehensive platform to manage tasks and visits, enabling Administrators to oversee operations, manage clients, and assign tasks to Executives who execute and report on these visits.

## Business Overview
The application serves as an internal operational tool. Administrators create and manage profiles for Clients and Executives. Clients are assigned to Executives, generating Visit records. Executives log into their dashboards to view active visits, complete predefined or custom subtasks, and close out visits. The system tracks metrics, pending tasks, and completion statuses.

## Current Status
- **Production-Ready**: All TypeScript errors have been resolved. `npm run build` passes with zero errors.
- **UI Redesign Complete**: The application has been fully transitioned to a light, premium enterprise theme.
- **Fully Functional**: All business logic, workflows, and database interactions are operating correctly.

## Tech Stack
- **Framework**: Next.js 16 (App Router)
- **UI Library**: React
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database ORM**: Prisma
- **Database**: PostgreSQL
- **Authentication**: Custom JWT Authentication
- **API**: Next.js REST API Routes (`/app/api/...`)

## Folder Structure
- `/src/app`: Next.js App Router (pages, layouts, loading states)
  - `/(dashboard)`: Authenticated dashboard routes (`/admin`, `/executive`)
  - `/api`: REST API routes
- `/src/components`: Reusable UI components (Modals, Skeletons, Cards, etc.)
- `/src/lib`: Utilities, database clients, authentication helpers
- `/prisma`: Prisma schema and migrations

## Authentication Flow
Custom JWT-based authentication. Login is handled via `/api/auth/login`, which validates credentials against the database and sets an HTTP-only JWT cookie. Middleware protects the `/(dashboard)` routes.

## Database Overview
Relational schema using Prisma. Key models include:
- `User`: Admin and Executive accounts.
- `Client`: End clients being serviced.
- `Visit`: Represents an active task/visit assigned to an executive for a client.
- `Subtask`: Specific checklist items within a visit.
- `TaskTemplate`/`TaskConfig`: Global and client-specific subtask templates.

## API Architecture
RESTful API built with Next.js Route Handlers. Organized into domain-specific endpoints (e.g., `/api/admin/clients`, `/api/visits/[visitId]`). Strict type enforcement and validation on payloads.

## UI Theme
**Light Premium Enterprise Theme**
- Clean, minimal, modern aesthetic.
- Subtle glassmorphism and soft shadows.
- Smooth transitions and hover effects (micro-animations).

## Color Palette
- **Background**: `#f8f9fc` (page background), `#ffffff` (cards, modals)
- **Primary Action (Brand Blue)**: `#25488e`
- **Danger/Destructive (Brand Maroon)**: `#800040`
- **Accent (Orange)**: `#ff944d`
- **Text**: `#0f1829` (headings), `#4a5568` (body), `#8896a9` (muted)
- **Borders**: `#e2e7f0`, `#c8d2e0`

## Coding Standards
- Strict TypeScript: No implicit `any`, strict null checks.
- Functional React Components with Hooks.
- Tailwind CSS for all styling (utility-first).
- Optimistic UI updates to minimize loading states on interactions.

## Naming Conventions
- Components: `PascalCase.tsx`
- Functions/Variables: `camelCase`
- API Routes: `kebab-case` directories
- Types/Interfaces: `PascalCase`

## Important Business Rules
- Automatically create/assign active Visit records when Admin assigns a Client to an Executive.
- Subtasks are templated either globally or overridden per client.
- Executives can only close visits if all subtasks are completed.
- Pending counts and dashboard stats must update correctly based on visit status.

## Features Completed
- Custom JWT Authentication.
- Admin Dashboard (Stats, Client Management, Exec Management, Carry Forward, Task Config).
- Executive Dashboard (My Visits, Active Tasks, Visit Completion Flow).
- Optimistic UI state updates for subtasks.
- Complete Light Theme UI Modernization.

## Features Remaining
- Future enhancements (e.g., Reports, Calendar) as defined by the client.

## Deployment Information
- Target: **Vercel**
- The project relies on Vercel's serverless environment.
- Prisma generation must run during the build pipeline.

## Important Commands
- `npm run dev`: Start local development server.
- `npm run build`: Run production build (Next.js + TypeScript strict checks).
- `npx prisma generate`: Generate Prisma client.
- `npx prisma db push` / `npx prisma migrate dev`: Update database schema.

## Things AI should NEVER modify
- **Prisma Schema (`schema.prisma`)**: Unless explicitly requested and approved.
- **API Contracts**: Request/Response formats of existing endpoints.
- **Authentication Flow**: The JWT cookie creation and validation logic.
- **Routing Structure**: The Next.js App Router directory layout.
- **Business Logic**: E.g., Visit assignment rules, completion rules.

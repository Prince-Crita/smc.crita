# SMC Task Management Module

A production-quality audit task management system built with **Next.js 15**, **React 19**, **TypeScript**, **Tailwind CSS**, **Prisma ORM**, and **Neon PostgreSQL**.

---

## 🚀 Quick Start

### 1. Prerequisites

- Node.js 18+
- A [Neon PostgreSQL](https://neon.tech) account (free tier works)
- npm

### 2. Clone & Install

```bash
# The project is already scaffolded at:
cd smc-task-management

npm install
```

### 3. Configure Environment Variables

```bash
# Copy the example file
cp .env.example .env.local
```

Edit `.env.local` and set your values:

```env
# Get this from your Neon dashboard → Project → Connection String
DATABASE_URL="postgresql://neondb_owner:YOUR_PASS@YOUR_HOST.neon.tech/neondb?sslmode=require"

# Generate a strong random string
JWT_SECRET="your-32-plus-character-secret-here"
```

**To generate a JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Set Up the Database

```bash
# Push schema to Neon PostgreSQL
npx prisma db push

# Seed with realistic data
npx prisma db seed
```

### 5. Start the App

```bash
npm run dev
```

Visit **http://localhost:3000** → you'll be redirected to `/login`.

---

## 🔐 Login Credentials (Seeded)

| Role      | Email                          | Password     |
|-----------|-------------------------------|--------------|
| Admin     | prince@smcaudit.com           | Password@123 |
| Executive | alagarsamy@smcaudit.com       | Password@123 |
| Executive | logesh@smcaudit.com           | Password@123 |
| Executive | karthick@smcaudit.com         | Password@123 |

---

## 📋 Features

### Admin
- **Dashboard** — Stats cards, executive overview, recent visits
- **All Visits** — Filter by client, executive, status; search; progress bars
- **Visit Detail** — Read-only task & subtask view with activity log
- **Carry-Forward** — Full history grouped by destination visit

### Executive
- **Dashboard** — Open visits with live progress, stats overview
- **My Visits** — Filter by status, card-based layout
- **Visit Detail** — Open/close visits, complete subtasks, manage carry-forwards

### Task Workflow
- 6 fixed tasks per visit auto-created on seed
- Subtask checkboxes with mandatory reason for incomplete items
- MD Meeting YES/NO confirmation is a hard gate to close
- Progress tracker with per-task dot indicators
- Activity timeline with all actions logged
- Auto-generated visit summary on close
- Carry-forward automatically applied to next visit

---

## 🏗️ Architecture

```
src/
├── app/
│   ├── (auth)/login/          ← Login page
│   ├── (dashboard)/           ← Protected routes (JWT-verified layout)
│   │   ├── admin/             ← Admin pages (server-rendered)
│   │   └── executive/         ← Executive pages (client-rendered)
│   ├── api/                   ← REST API routes
│   │   ├── auth/              ← Login / Logout
│   │   ├── visits/            ← Visit CRUD + close
│   │   ├── tasks/             ← Task completion
│   │   └── admin/             ← Admin-only endpoints
│   └── middleware.ts           ← JWT route protection
├── components/
│   ├── auth/                  ← LoginForm
│   └── layout/                ← Sidebar, DashboardLayout
├── lib/
│   ├── auth/                  ← JWT utilities + middleware helpers
│   ├── db/                    ← Prisma client singleton
│   ├── validations/           ← Zod schemas
│   ├── constants/             ← Fixed task definitions
│   └── utils/                 ← carry-forward logic, summary generator
└── middleware.ts               ← Next.js route middleware
```

---

## 🔄 Business Rules

1. **Visit Open** → Executive opens visit, status changes to `OPEN`
2. **Task Completion** → Executive saves subtask states; incomplete subtasks require a reason
3. **MD Meeting** → YES/NO answer is mandatory before closing
4. **Visit Close**:
   - Validates MD Meeting answer
   - Validates all incomplete subtasks have reasons
   - Runs carry-forward logic (incomplete → next visit)
   - Generates summary JSON with rating
   - Logs activity

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Runtime | React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Components | Custom (Radix UI primitives) |
| Database | Neon PostgreSQL |
| ORM | Prisma 7 |
| Auth | JWT (jose library) |
| Validation | Zod |
| Forms | React Hook Form |
| Notifications | React Hot Toast |

---

## 📦 Useful Commands

```bash
# Development
npm run dev

# Database
npx prisma studio           # Visual DB browser
npx prisma db push          # Push schema changes
npx prisma db seed          # Re-seed database
npx prisma generate         # Regenerate client after schema changes

# Type checking
npx tsc --noEmit

# Production build
npm run build
```

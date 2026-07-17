# AI Session Handoff

**READ THIS FILE BEFORE STARTING WORK IN A NEW SESSION.**

## Current Project State
- **Status**: Production-Ready.
- **Build**: `npm run build` passes with zero TypeScript or environment errors. Deployable to Vercel immediately.
- **UI**: The entire application has been successfully migrated to a Premium Light Enterprise Theme.

## Current Module
- **Handoff Documentation**: Establishing persistent context files for seamless AI continuity.

## Next Task
- Wait for user instructions. The codebase is currently in a stable state.

## Important Decisions Made
- **UI/UX Transition**: Moved away from dark/slate mode entirely. The application now uses a clean, light interface. Primary Brand Blue is `#25488e`, Destructive Maroon is `#800040`, and Accent Orange is `#ff944d`. Backgrounds are `#f8f9fc` and `#ffffff`.
- **State Management**: For highly interactive pages like Visit Details, we use React local state (`setVisit`) to apply optimistic UI updates when subtasks are toggled, avoiding slow API re-fetches.
- **TypeScript**: Vercel enforces strict type checking. Implicit `any` errors that previously blocked builds have been resolved.

## Files Recently Modified
- `src/app/(dashboard)/admin/task-config/page.tsx` (Complete light theme overhaul)
- `src/app/(dashboard)/executive/visits/[visitId]/page.tsx` (Complete light theme overhaul and state update fix)
- All loading skeletons (`loading.tsx`) across admin and executive routes.
- `PROJECT_CONTEXT.md`, `AI_PROGRESS.md`, `AI_RULES.md`, `PROJECT_STRUCTURE.md`, `DEVELOPMENT_CHECKLIST.md`

## Things To Remember
- **Prisma**: Do not change the database schema unless requested. If you do, run `npx prisma db push` and `npx prisma generate`.
- **API Contracts**: The frontend relies heavily on the exact shape of current API responses. Do not alter them arbitrarily.
- **Styling**: Stick to Tailwind CSS. Do not introduce arbitrary CSS files.

## Open Issues
- None. Build is stable.

## Expected Next Steps
- Read `PROJECT_CONTEXT.md` to understand the domain.
- Read `AI_RULES.md` to understand the constraints.
- Begin processing the User's next request based on this stable checkpoint.

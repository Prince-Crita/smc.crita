# AI Development Rules

**CRITICAL: Follow these rules permanently during all future development sessions.**

1. **DO NOT change Prisma schema.**
   - Do not modify `schema.prisma` unless explicitly requested by the user.

2. **DO NOT modify API contracts.**
   - Do not change the expected request payloads or response formats of existing API endpoints.

3. **DO NOT break authentication.**
   - Leave the JWT issuance, validation, and middleware logic intact.

4. **DO NOT change routing.**
   - Stick to the existing Next.js App Router structure.

5. **DO NOT remove existing functionality.**
   - The application is feature-complete. Do not delete business logic, assignment rules, or status tracking features.

6. **Reuse existing components whenever possible.**
   - Do not create redundant Modals, Cards, or Inputs. Use the existing ones in `src/components/ui/`.

7. **Use Tailwind best practices.**
   - Use utility classes efficiently. Do not write custom CSS unless absolutely necessary.

8. **Keep components reusable.**
   - Abstract common patterns.

9. **Maintain mobile-first design.**
   - Ensure the UI is responsive across screen sizes using Tailwind's breakpoints (`sm:`, `md:`, `lg:`).

10. **Follow existing architecture.**
    - API logic goes in `/api`, frontend views go in `page.tsx`, reusable UI in `src/components`.
    - Continue to use the established optimistic UI update patterns (e.g., using React state to update UI immediately before API response).

11. **Write production-ready code.**
    - Strictly adhere to TypeScript typings.
    - No `any` types. Handle null/undefined checks defensively.

12. **Avoid unnecessary dependencies.**
    - Do not `npm install` new libraries unless there is no existing way to accomplish the task natively or with existing dependencies.

13. **Follow the UI Theme constraints.**
    - Use only the established Light Enterprise Palette (`#25488e` Brand Blue, `#800040` Maroon, `#ff944d` Orange, `#f8f9fc` Backgrounds). Do not introduce generic colors (plain red, blue, green).

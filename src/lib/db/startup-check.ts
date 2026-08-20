/**
 * Node-runtime startup check for the database target.
 *
 * Kept in its own module, imported dynamically by src/instrumentation.ts only
 * when NEXT_RUNTIME is "nodejs". Next.js compiles instrumentation for BOTH the
 * Node and Edge runtimes, and `process.exit` does not exist on the Edge — with
 * this code inline, Next warned about an unsupported Node API even though the
 * call site was already guarded at runtime. Loading it dynamically keeps it out
 * of the Edge bundle entirely.
 */
import { assertSafeDatabaseTarget, describeDatabaseTarget, formatDatabaseTarget, isLocalDevServer } from "@/lib/db/database-target";

export function runStartupDatabaseCheck(): void {
  if (!isLocalDevServer() && process.env.NODE_ENV === "production") return;

  const target = describeDatabaseTarget(process.env.DATABASE_URL);
  console.log(`[db] ${process.env.NODE_ENV ?? "unknown"} → ${formatDatabaseTarget(target)}`);

  try {
    assertSafeDatabaseTarget(process.env.DATABASE_URL);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    // "Refusing to start" has to mean it. A warning here would scroll past,
    // and the cost of missing it is a developer's machine reading and writing
    // the live database.
    process.exit(1);
  }
}

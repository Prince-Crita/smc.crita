/**
 * Next.js instrumentation hook — runs once when the server starts, before it
 * serves anything.
 *
 * Its only job here is to say which database this process is about to use, and
 * to stop a local development server that is aimed at a remote (i.e.
 * production) database.
 *
 * Why at boot rather than on first query: `DATABASE_URL` set in the shell
 * silently outranks every .env file, and Next.js's startup banner still prints
 * "Environments: .env.development.local, .env.local" regardless — so nothing on
 * screen tells you that local development just attached itself to the live
 * company database. It has to be said explicitly, before the first request
 * rather than after it.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime has (or needs) a database connection. The
  // check itself lives in a separate module so it is never bundled for the
  // Edge runtime, which has no `process.exit`.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runStartupDatabaseCheck } = await import("@/lib/db/startup-check");
  runStartupDatabaseCheck();
}

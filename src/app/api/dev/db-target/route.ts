import { NextResponse } from "next/server";
import { describeDatabaseTarget } from "@/lib/db/database-target";

/**
 * GET /api/dev/db-target — "which database is this process actually talking to?"
 *
 * Reading .env files tells you what *should* happen. This reports what IS
 * happening, from inside the running server, by asking the live connection
 * pool. Use it whenever local development behaves as though it is pointed
 * somewhere unexpected.
 *
 * Safety:
 *   • Disabled outright in production — a production deployment answers 404,
 *     so this can never become an information-disclosure endpoint on a real
 *     server.
 *   • Reports host / port / database name / user only. It never returns the
 *     password, the connection string, the JWT secret, or any other secret.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const target = describeDatabaseTarget(process.env.DATABASE_URL);

  let live: Record<string, unknown> = { reachable: false };
  try {
    // Imported lazily and inside the try: the Prisma singleton refuses to be
    // created when a development process is aimed at a remote database, and
    // this endpoint has to keep answering in exactly that situation — it is
    // the tool you reach for when the database target is what is wrong.
    const { prisma } = await import("@/lib/db/prisma");

    // Asked of the live pool, so it reflects the real connection rather than
    // the string we think we configured.
    const rows = await prisma.$queryRaw<
      { database: string; server_port: number | null; server_addr: string | null; db_user: string }[]
    >`SELECT current_database() AS database,
             inet_server_port()  AS server_port,
             host(coalesce(inet_server_addr(), '127.0.0.1'::inet)) AS server_addr,
             current_user        AS db_user`;
    const r = rows[0];
    live = {
      reachable: true,
      database: r.database,
      serverPort: r.server_port,
      serverAddress: r.server_addr,
      dbUser: r.db_user,
    };
  } catch (err) {
    live = { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({
    environment: process.env.NODE_ENV,
    configured: target,
    live,
    productionDatabaseConnected: target.isRemote,
    verdict: target.isRemote
      ? "WARNING — this process is connected to a NON-LOCAL database"
      : "OK — local database only",
  });
}

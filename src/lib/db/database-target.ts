/**
 * Describing (and guarding) the database a process is pointed at.
 *
 * Local development must use the local PostgreSQL server and nothing else.
 * The risk is not theoretical: `.env.local` carries the production connection
 * string for the deployed app, Next.js loads `.env.local` alongside
 * `.env.development.local`, and a single missing or renamed file is all it
 * takes for `npm run dev` to start reading and writing production data
 * without saying a word about it.
 *
 * Two pieces live here:
 *   describeDatabaseTarget() — host/port/database/user, never the password,
 *                              so it is always safe to log or return.
 *   assertSafeDatabaseTarget() — refuses to start a non-production process
 *                              against a remote database.
 */

export interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
  /** The connecting role. Not a secret; the password is never read out. */
  user: string;
  /** True when the host is NOT this machine — i.e. a hosted database. */
  isRemote: boolean;
  /** True when the host looks like a Neon-hosted database. */
  looksLikeNeon: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** Parse a connection string into its non-secret parts. Never throws. */
export function describeDatabaseTarget(connectionString: string | undefined): DatabaseTarget {
  if (!connectionString) {
    return { host: "<unset>", port: "-", database: "<unset>", user: "-", isRemote: false, looksLikeNeon: false };
  }
  try {
    const u = new URL(connectionString);
    const host = u.hostname;
    return {
      host,
      port: u.port || "5432",
      database: decodeURIComponent(u.pathname.replace(/^\//, "").split("?")[0]) || "<none>",
      user: decodeURIComponent(u.username) || "-",
      isRemote: !LOCAL_HOSTS.has(host),
      looksLikeNeon: /\bneon\.tech$/i.test(host),
    };
  } catch {
    return { host: "<unparseable>", port: "-", database: "<unparseable>", user: "-", isRemote: true, looksLikeNeon: false };
  }
}

/** One-line, secret-free summary suitable for a startup log. */
export function formatDatabaseTarget(t: DatabaseTarget): string {
  return `host=${t.host} port=${t.port} db=${t.database} user=${t.user}`;
}

/**
 * True when this process is the local development server.
 *
 * NODE_ENV alone is not trustworthy here. `NODE_ENV` set in the shell wins
 * over everything, so a value left behind from an earlier command — testing
 * the standalone production build, say — makes `next dev` run with
 * NODE_ENV=production. Next.js itself only warns about that ("non-standard
 * NODE_ENV value"), and a guard keyed on NODE_ENV would quietly switch
 * itself off in exactly that situation.
 *
 * `npm_lifecycle_event` is set by npm to the name of the script being run, so
 * `npm run dev` is identifiable no matter what NODE_ENV says.
 */
export function isLocalDevServer(): boolean {
  return process.env.npm_lifecycle_event === "dev";
}

/**
 * Refuse to run a development/test process against a remote database.
 *
 * Deliberately a hard failure rather than a warning: a warning scrolls past,
 * and the cost of missing it is writing to the live company database from a
 * developer's machine. A genuine deployment is unaffected — it is *supposed*
 * to use the hosted database.
 *
 * Escape hatch: set ALLOW_REMOTE_DB=1 to point a local process at a remote
 * database on purpose (e.g. inspecting a staging copy). Requiring an explicit
 * variable keeps it a deliberate act instead of an accident.
 */
export function assertSafeDatabaseTarget(connectionString: string | undefined): void {
  if (process.env.ALLOW_REMOTE_DB === "1") return;
  // `npm run dev` is always guarded, whatever NODE_ENV happens to say.
  if (!isLocalDevServer() && process.env.NODE_ENV === "production") return;

  const target = describeDatabaseTarget(connectionString);
  if (!target.isRemote) return;

  throw new Error(
    [
      "",
      "──────────────────────────────────────────────────────────────────────",
      " REFUSING TO START: local development is pointed at a REMOTE database.",
      "",
      `   NODE_ENV : ${process.env.NODE_ENV ?? "<unset>"}`,
      `   target   : ${formatDatabaseTarget(target)}`,
      process.env.NODE_ENV !== "development" && isLocalDevServer()
        ? `   NOTE: NODE_ENV is "${process.env.NODE_ENV}" — it is set in your shell and is
         overriding the development default. Clear it with:  $env:NODE_ENV=$null`
        : "",
      target.looksLikeNeon ? "   this is the hosted (Neon) database — very likely PRODUCTION" : "",
      "",
      " Local development must use the local PostgreSQL server. Check that",
      " .env.development.local exists and sets DATABASE_URL to localhost, and",
      " that DATABASE_URL is not set in your shell (it outranks every .env file).",
      "",
      " If you genuinely mean to use a remote database, set ALLOW_REMOTE_DB=1.",
      "──────────────────────────────────────────────────────────────────────",
      "",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

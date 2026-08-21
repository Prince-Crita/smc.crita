/**
 * dev-proxy — a stand-in for the company reverse proxy, for local testing.
 *
 * WHY THIS EXISTS
 * ---------------
 * The single most common way a sub-path deployment breaks is the proxy
 * STRIPPING the path prefix before forwarding. The app is built expecting to
 * receive the full URL including /client-trial/smc-task-management, and it
 * removes the prefix itself. If the proxy removes it too, every asset 404s and
 * you get an unstyled page — the classic symptom.
 *
 * This script forwards the request URI UNCHANGED, which is exactly what
 * DEPLOYMENT_REVERSE_PROXY.md §4.1 requires of the real proxy. It lets you see
 * the finished behaviour before touching the company server.
 *
 * In nginx the equivalent correct configuration is:
 *
 *     location /client-trial/smc-task-management/ {
 *         proxy_pass http://127.0.0.1:3000;      # NO trailing URI — this is the point
 *         proxy_http_version 1.1;
 *         proxy_set_header Host              $host;
 *         proxy_set_header X-Real-IP         $remote_addr;
 *         proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
 *         proxy_set_header X-Forwarded-Proto $scheme;
 *         proxy_set_header Upgrade           $http_upgrade;
 *         proxy_set_header Connection        "upgrade";
 *     }
 *
 * Writing `proxy_pass http://127.0.0.1:3000/;` (with the trailing slash) is
 * what strips the prefix and breaks everything.
 *
 * USAGE
 *   npm run proxy:simulate                       # listens on 8080 → 3000
 *   npm run proxy:simulate -- --port 8080 --target 3000 --strip
 *
 * --strip deliberately reproduces the MISCONFIGURED proxy, so you can see the
 * failure for yourself and recognise it if it happens tomorrow.
 */
import http from "node:http";

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(argOf("--port", 8080));
const TARGET = Number(argOf("--target", 3000));
const PREFIX = argOf("--prefix", "/client-trial/smc-task-management").replace(/\/$/, "");
const STRIP = argv.includes("--strip");

let requests = 0, errors = 0;
const codes = new Map();

const server = http.createServer((req, res) => {
  // A correct proxy passes the URI through untouched. --strip removes the
  // prefix, reproducing the misconfiguration for demonstration.
  const path = STRIP && req.url.startsWith(PREFIX) ? (req.url.slice(PREFIX.length) || "/") : req.url;

  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: TARGET,
      method: req.method,
      path,
      headers: {
        ...req.headers,
        host: `localhost:${PORT}`,            // the public Host, as a real proxy sends
        "x-forwarded-host": `localhost:${PORT}`,
        "x-forwarded-proto": "http",           // real proxy sends https
        "x-forwarded-for": req.socket.remoteAddress ?? "",
      },
    },
    (up) => {
      requests++;
      codes.set(up.statusCode, (codes.get(up.statusCode) ?? 0) + 1);
      if (up.statusCode >= 400) {
        errors++;
        console.log(`  \x1b[31m${up.statusCode}\x1b[0m ${req.method} ${req.url}`);
      }
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res, { end: true });
    }
  );

  upstream.on("error", (err) => {
    errors++;
    console.log(`  \x1b[31mERR\x1b[0m ${req.method} ${req.url} — ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`proxy: cannot reach 127.0.0.1:${TARGET} — is the app running?\n`);
  });

  req.pipe(upstream, { end: true });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("\n" + "═".repeat(70));
  console.log(" reverse-proxy simulation");
  console.log("═".repeat(70));
  console.log(`  listening      http://localhost:${PORT}`);
  console.log(`  forwarding to  http://127.0.0.1:${TARGET}`);
  console.log(`  prefix         ${PREFIX}`);
  console.log(`  URI handling   ${STRIP ? "\x1b[31mSTRIPPED (deliberately wrong)\x1b[0m" : "\x1b[32mUNCHANGED (correct)\x1b[0m"}`);
  console.log("");
  console.log(`  open  http://localhost:${PORT}${PREFIX}/login`);
  console.log("");
  console.log("  4xx/5xx responses are printed below; silence means everything is fine.");
  console.log("═".repeat(70) + "\n");
});

const summary = () => {
  console.log(`\n  ${requests} request(s), ${errors} error(s)`);
  for (const [c, n] of [...codes].sort()) console.log(`    ${c}: ${n}`);
};
process.on("SIGINT", () => { summary(); process.exit(errors ? 1 : 0); });
process.on("SIGTERM", () => { summary(); process.exit(0); });

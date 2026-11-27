import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type ApiRequest = IncomingMessage & {
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type ApiResponse = ServerResponse;

const root = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(root, "dist");
const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function queryObject(url: URL) {
  const query: ApiRequest["query"] = {};
  for (const [key, value] of url.searchParams) {
    const current = query[key];
    query[key] = current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
  }
  return query;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType.includes("application/json")) {
    try { return JSON.parse(raw); } catch { throw new Error("Invalid JSON body"); }
  }
  return raw;
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

async function serveApi(req: ApiRequest, res: ApiResponse, url: URL) {
  const path = url.pathname;
  if (path === "/api/auth" || path.startsWith("/api/auth/")) {
    const [{ toNodeHandler }, { auth }] = await Promise.all([
      import("better-auth/node"),
      import("./src/lib/auth.js"),
    ]);
    return toNodeHandler(auth)(req, res);
  }

  let handler: ((req: ApiRequest, res: ApiResponse) => unknown) | null = null;
  const query = req.query;

  if (path === "/api/admin/management-bot") {
    handler = (await import("./api/admin/management-bot.js")).default;
  } else if (path === "/api/admin" || path === "/api/admin/users" || path === "/api/admin/licenses" || path === "/api/admin/license-plans") {
    if (path.endsWith("/users")) query.resource = "users";
    if (path.endsWith("/licenses")) query.resource = "licenses";
    if (path.endsWith("/license-plans")) query.resource = "license-plans";
    handler = (await import("./api/admin/index.js")).default;
  } else if (path === "/api/bots" || path === "/api/bots/start-link" || /^\/api\/bots\/[^/]+$/.test(path)) {
    if (path === "/api/bots/start-link") query.resource = "start-link";
    const detail = path.match(/^\/api\/bots\/([^/]+)$/);
    if (detail) {
      query.resource = "detail";
      query.botId = decodeURIComponent(detail[1]);
    }
    handler = (await import("./api/bots/index.js")).default;
  } else if (path === "/api/bot-menus") {
    query.resource = "menus";
    handler = (await import("./api/bots/index.js")).default;
  } else if (path === "/api/bot-menu-appearance") {
    query.resource = "menu-appearance";
    handler = (await import("./api/bots/index.js")).default;
  } else if (path === "/api/conversations" || /^\/api\/conversations\/[^/]+\/messages$/.test(path)) {
    const messages = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messages) {
      query.resource = "messages";
      query.conversationId = decodeURIComponent(messages[1]);
    }
    handler = (await import("./api/conversations/index.js")).default;
  } else if (path === "/api/dashboard" || path === "/api/visitors") {
    if (path === "/api/visitors") query.resource = "visitors";
    handler = (await import("./api/dashboard.js")).default;
  } else if (path === "/api/auto-replies") {
    handler = (await import("./api/auto-replies.js")).default;
  } else if (path === "/api/telegram/webhook") {
    handler = (await import("./api/telegram/webhook.js")).default;
  } else if (path === "/api/telegram/management-webhook") {
    handler = (await import("./api/telegram/management-webhook.js")).default;
  } else if (path === "/api/telegram/management-webhook-setup") {
    handler = (await import("./api/telegram/management-webhook-setup.js")).default;
  } else if (path === "/api/telegram/link-challenge") {
    handler = (await import("./api/telegram/link-challenge.js")).default;
  } else if (path === "/api/cron/license-reminders") {
    handler = (await import("./api/cron/license-reminders.js")).default;
  }

  if (!handler) return sendJson(res, 404, { error: "API route not found" });
  return handler(req, res);
}

function serveStatic(pathname: string, res: ServerResponse) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidate = resolve(distDir, relative);
  if (candidate !== distDir && !candidate.startsWith(distDir + sep)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : resolve(distDir, "index.html");
  if (!existsSync(file)) {
    res.statusCode = 503;
    return res.end("Frontend build is not available");
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", mimeTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
}

const server = createServer(async (incoming, res) => {
  const url = new URL(incoming.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true }));
  }

  if (url.pathname.startsWith("/api/")) {
    const req = incoming as ApiRequest;
    req.query = queryObject(url);
    try {
      // Better Auth must receive the original, unread request stream.
      if (!(url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/"))) {
        req.body = await readBody(req);
      }
      await serveApi(req, res, url);
    } catch (error) {
      console.error("http_request_error", error);
      const status = error instanceof Error && error.message === "Request body too large"
        ? 413
        : error instanceof Error && error.message === "Invalid JSON body"
          ? 400
          : 500;
      sendJson(res, status, {
        error: error instanceof Error ? error.message : "Request failed",
      });
    }
    return;
  }

  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }
  return serveStatic(url.pathname, res);
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`telegram-bot-saas listening on 0.0.0.0:${port}`);
});

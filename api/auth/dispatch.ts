import { toNodeHandler } from "better-auth/node";
import { auth } from "../../../src/lib/auth.js";

const authHandler = toNodeHandler(auth);

type AuthRequest = Parameters<typeof authHandler>[0] & {
  query: Record<string, string | string[] | undefined>;
};

export default function handler(
  req: AuthRequest,
  res: Parameters<typeof authHandler>[1],
) {
  const rawPath = req.query.__authPath;
  const authPath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;

  if (!authPath || typeof authPath !== "string") {
    res.statusCode = 400;
    res.end("Missing authentication route");
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  url.searchParams.delete("__authPath");
  req.url = `/api/auth/${authPath}${url.searchParams.size ? `?${url.searchParams.toString()}` : ""}`;

  return authHandler(req, res);
}

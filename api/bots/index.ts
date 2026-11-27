import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import botListHandler from "../_lib/routes/bots-index.js";
import botDetailHandler from "../_lib/routes/bots-detail.js";
import botStartLinkHandler from "../_lib/routes/bots-start-link.js";

export default function handler(req: ApiRequest, res: ApiResponse) {
  const rawResource = req.query.resource;
  const resource = Array.isArray(rawResource) ? rawResource[0] : rawResource;
  if (resource === "detail") return botDetailHandler(req, res);
  if (resource === "start-link") return botStartLinkHandler(req, res);
  return botListHandler(req, res);
}

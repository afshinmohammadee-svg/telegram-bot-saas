import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import conversationsListHandler from "../_lib/routes/conversations-list.js";
import conversationMessagesHandler from "../_lib/routes/conversation-messages.js";

export default function handler(req: ApiRequest, res: ApiResponse) {
  const rawResource = req.query.resource;
  const resource = Array.isArray(rawResource) ? rawResource[0] : rawResource;
  if (resource === "messages") return conversationMessagesHandler(req, res);
  return conversationsListHandler(req, res);
}

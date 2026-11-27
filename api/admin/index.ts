import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { json } from "../_lib/server.js";
import usersHandler from "../_lib/routes/admin-users.js";
import licensesHandler from "../_lib/routes/admin-licenses.js";
import licensePlansHandler from "../_lib/routes/admin-license-plans.js";

export default function handler(req: ApiRequest, res: ApiResponse) {
  const rawResource = req.query.resource;
  const resource = Array.isArray(rawResource) ? rawResource[0] : rawResource;
  if (resource === "users") return usersHandler(req, res);
  if (resource === "licenses") return licensesHandler(req, res);
  if (resource === "license-plans") return licensePlansHandler(req, res);
  return json(res, 404, { error: "Unknown admin resource" });
}

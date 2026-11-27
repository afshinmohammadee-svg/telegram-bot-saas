import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { authAccess, authRoles } from "./auth-permissions";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : undefined,
  plugins: [
    adminClient({
      ac: authAccess,
      roles: authRoles,
    }),
  ],
});

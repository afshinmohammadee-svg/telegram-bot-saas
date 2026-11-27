import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access";

export const authAccess = createAccessControl(defaultStatements);
export const superAdminRole = authAccess.newRole({
  ...adminAc.statements,
});
export const regularUserRole = authAccess.newRole({});
export const authRoles = {
  super_admin: superAdminRole,
  user: regularUserRole,
};

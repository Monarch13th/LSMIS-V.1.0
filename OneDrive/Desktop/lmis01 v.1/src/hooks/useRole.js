// Role helper hook
import { ROLES, ROLE_LABELS } from "../utils/constants";
import { useAuth } from "./useAuth";

export const useRole = () => {
  const { role } = useAuth();
  return {
    role,
    roleLabel: role ? ROLE_LABELS[role] : "",
    isAdmin: role === ROLES.ADMIN,
    isVet: role === ROLES.VET,
    isStaff: role === ROLES.STAFF,
    hasRole: (...roles) => !!role && roles.includes(role),
  };
};

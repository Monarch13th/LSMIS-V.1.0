// All mock datasets permanently eliminated for Owner Portal.
// Connected exclusively to live Supabase database tables.
import { TABLES } from "./constants.js";

export const DEFAULT_OWNER_PROFILE = null;
export const DEFAULT_PENDING_OWNER_PROFILE = null;
export const DEFAULT_OWNER_LIVESTOCK = [];
export const DEFAULT_OWNER_ANTE_MORTEM = [];
export const DEFAULT_OWNER_POST_MORTEM = [];
export const DEFAULT_OWNER_CONDEMNATIONS = [];
export const DEFAULT_OWNER_CARCASS = [];
export const DEFAULT_OWNER_PAYMENTS = [];
export const DEFAULT_OWNER_DISPATCH = [];
export const DEFAULT_OWNER_NOTIFICATIONS = [];

/**
 * Purges any legacy mock data from localStorage
 */
export const ensureOwnerMockSeeded = () => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("lmis_db_mock_") || key.startsWith("lmis_mock_"))) {
        localStorage.removeItem(key);
      }
    }
  } catch (err) {}
};

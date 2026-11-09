// Auth hook — single source of truth for the current session
import { authStore, useAuthStore } from "../store/authStore";
import { authService } from "../services/authService";

export const useAuth = () => {
  const session = useAuthStore((s) => s?.session);
  const loading = useAuthStore((s) => s?.loading);
  const isInitialized = useAuthStore((s) => s?.isInitialized);
  const mfaRequired = useAuthStore((s) => Boolean(s?.mfaRequired));

  const signIn = async (role, username, password) => {
    const { data, error } = await authService.signIn(role, username, password);
    if (data) authStore.set({ session: data, loading: false, isInitialized: true, mfaRequired: false });
    return { data, error };
  };

  const signOut = async () => {
    await authService.signOut();
    authStore.set({ session: null, loading: false, isInitialized: true, mfaRequired: false });
  };

  return {
    session,
    isAuthenticated: !!session && !mfaRequired,
    mfaRequired,
    role: session?.role || null,
    userName: session?.name || "",
    username: session?.username || "",
    ownerId: session?.owner_id || null,
    loading: !!loading,
    isInitialized: !!isInitialized,
    signIn,
    signOut,
  };
};


import { supabase } from "./supabaseClient";
import { authService } from "./authService";
import { logActivity } from "./activityService";

export const verifyAdminPassword = async (password, actionContext = {}) => {
  const cleanPassword = (password || "").trim();
  if (!cleanPassword) {
    return { success: false, error: "Password confirmation is required." };
  }

  const session = authService.getSession();
  const userEmail = session?.email || session?.username || "admin1@gmail.com";

  try {
    let authSuccess = false;
    let authErrorMsg = null;

    if (userEmail && userEmail.includes("@")) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: cleanPassword,
      });

      if (!error && data?.session) {
        authSuccess = true;
      } else if (error) {
        authErrorMsg = error.message || "Invalid password.";
      }
    }

    if (!authSuccess) {
      await logActivity({
        action: `Failed password re-authentication for action: ${actionContext.action || "Sensitive Admin Action"}`,
        module: actionContext.module || "Security",
        security_event: "Failed Admin Password Confirmation",
        severity: "danger",
        user: session?.name || session?.full_name || userEmail,
        role: session?.role || "admin",
      });

      return {
        success: false,
        error: authErrorMsg || "Incorrect password. Verification failed.",
      };
    }

    return { success: true };
  } catch (err) {
    console.error("verifyAdminPassword error:", err);
    return {
      success: false,
      error: err.message || "An error occurred during password verification.",
    };
  }
};

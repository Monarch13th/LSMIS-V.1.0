import { supabase } from "./supabaseClient";

/**
 * Service for Two-Factor Authentication (2FA) powered natively by Supabase Auth MFA (TOTP).
 * Enforces TOTP standard for apps such as Google Authenticator, Microsoft Authenticator, and 2FAS.
 */
export const mfaService = {
  /**
   * List all MFA factors enrolled for the currently authenticated Supabase user.
   */
  async listFactors() {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        return { factors: [], verifiedFactor: null, unverifiedFactor: null, is2FAEnabled: false, error };
      }

      const all = Array.isArray(data?.all) ? data.all : [];
      const totp = Array.isArray(data?.totp) ? data.totp : [];
      const combined = [...totp];
      all.forEach((f) => {
        if (!combined.some((item) => item.id === f.id)) combined.push(f);
      });

      const totpFactors = combined.filter((f) => f.factor_type === "totp" || f.type === "totp");
      const verifiedFactor = totpFactors.find((f) => f.status === "verified") || null;
      const unverifiedFactor = totpFactors.find((f) => f.status === "unverified") || null;

      return {
        factors: totpFactors,
        verifiedFactor,
        unverifiedFactor,
        is2FAEnabled: Boolean(verifiedFactor),
        error: null,
      };
    } catch (err) {
      console.warn("mfaService.listFactors exception:", err);
      return { factors: [], verifiedFactor: null, unverifiedFactor: null, is2FAEnabled: false, error: err };
    }
  },

  /**
   * Get the current Authenticator Assurance Level (AAL) for the active session.
   * - currentLevel: 'aal1' (password/oauth only) | 'aal2' (MFA verified)
   * - nextLevel: 'aal2' indicates that the user has a verified factor and MUST satisfy MFA.
   */
  async getAssuranceLevel() {
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) {
        return { currentLevel: null, nextLevel: null, needsMfa: false, error };
      }

      const currentLevel = data?.currentLevel || null;
      const nextLevel = data?.nextLevel || null;
      const needsMfa = nextLevel === "aal2" && currentLevel !== "aal2";

      return {
        currentLevel,
        nextLevel,
        currentAuthenticationMethods: data?.currentAuthenticationMethods || [],
        needsMfa,
        error: null,
      };
    } catch (err) {
      console.warn("mfaService.getAssuranceLevel exception:", err);
      return { currentLevel: null, nextLevel: null, needsMfa: false, error: err };
    }
  },

  /**
   * Begin TOTP factor enrollment.
   * Automatically cleans up any previously abandoned unverified factors.
   * Returns QR code (SVG data URL), secret key, and factor ID.
   */
  async startEnrollment(friendlyName = "LSMIS Authenticator") {
    try {
      // 1. Clean up stale unverified factors from both all and totp
      const { data: existingList } = await supabase.auth.mfa.listFactors();
      const allExisting = [
        ...(Array.isArray(existingList?.all) ? existingList.all : []),
        ...(Array.isArray(existingList?.totp) ? existingList.totp : []),
      ];
      const unverified = allExisting.filter((f) => f.status === "unverified");
      const cleanedIds = new Set();
      for (const uf of unverified) {
        if (uf.id && !cleanedIds.has(uf.id)) {
          cleanedIds.add(uf.id);
          try {
            await supabase.auth.mfa.unenroll({ factorId: uf.id });
          } catch (_) {}
        }
      }

      // 2. Enroll new TOTP factor
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName,
        issuer: "LSMIS Naga City",
      });

      if (error) {
        return { data: null, error };
      }

      return {
        data: {
          factorId: data.id,
          type: data.type,
          qrCode: data.totp?.qr_code || null,
          secret: data.totp?.secret || null,
          uri: data.totp?.uri || null,
        },
        error: null,
      };
    } catch (err) {
      console.error("mfaService.startEnrollment exception:", err);
      return { data: null, error: err };
    }
  },

  /**
   * Verify an enrolled TOTP factor with a 6-digit code to complete activation.
   * Two-Factor Authentication is NOT active until this verification succeeds.
   */
  async verifyEnrollment({ factorId, code }) {
    const cleanCode = String(code || "").trim();
    if (!factorId) {
      return { data: null, error: new Error("Missing factor ID for enrollment verification.") };
    }
    if (!cleanCode || cleanCode.length !== 6) {
      return { data: null, error: new Error("Please enter a valid 6-digit verification code.") };
    }

    try {
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: cleanCode,
      });

      if (error) {
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error("mfaService.verifyEnrollment exception:", err);
      return { data: null, error: err };
    }
  },

  /**
   * Generates secure recovery backup codes and their SHA-256 hashes.
   * Format: XXXX-XXXX-XXXX (Base32 unambiguous uppercase characters).
   */
  async generateRecoveryCodes(count = 6) {
    const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const plainCodes = [];
    const hashes = [];

    for (let i = 0; i < count; i++) {
      let code = "";
      for (let j = 0; j < 12; j++) {
        if (j > 0 && j % 4 === 0) code += "-";
        const randIndex = Math.floor(Math.random() * chars.length);
        code += chars[randIndex];
      }
      plainCodes.push(code);

      const msgBuffer = new TextEncoder().encode(code.trim().toUpperCase());
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      hashes.push(hashHex);
    }

    return { plainCodes, hashes };
  },

  /**
   * Hashes a recovery code with SHA-256 for validation against stored hashes.
   */
  async hashRecoveryCode(code) {
    const clean = String(code || "").trim().toUpperCase();
    const msgBuffer = new TextEncoder().encode(clean);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  },

  /**
   * Disable 2FA by unenrolling the user's verified TOTP factor.
   * Requires re-authentication (password if available) and/or current 6-digit OTP from authenticator.
   */
  async disable2FA({ factorId = null, password = null, email = null, otpCode = null } = {}) {
    try {
      // 1. If password provided, verify reauthentication
      if (password && email) {
        const { error: authErr } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (authErr) {
          return {
            data: null,
            error: new Error("Password re-authentication failed. Please enter your correct password."),
          };
        }
      }

      // 2. Identify factor to unenroll
      let targetFactorId = factorId;
      if (!targetFactorId) {
        const { verifiedFactor } = await this.listFactors();
        if (!verifiedFactor) {
          return { data: null, error: new Error("No active Two-Factor Authentication factor found.") };
        }
        targetFactorId = verifiedFactor.id;
      }

      // 3. If OTP code provided, verify challenge against factor
      if (otpCode) {
        const cleanOtp = String(otpCode || "").trim();
        if (cleanOtp.length !== 6) {
          return { data: null, error: new Error("Verification code must be exactly 6 digits.") };
        }
        const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
          factorId: targetFactorId,
          code: cleanOtp,
        });
        if (verifyErr) {
          return {
            data: null,
            error: new Error("Invalid authenticator code. Please enter the current 6-digit code from your authenticator app to authorize disabling 2FA."),
          };
        }
      }

      // 4. Unenroll factor from Supabase Auth
      const { data, error } = await supabase.auth.mfa.unenroll({
        factorId: targetFactorId,
      });

      if (error) {
        return { data: null, error };
      }

      // 5. Clean up user metadata
      try {
        await supabase.auth.updateUser({
          data: {
            two_factor_enabled: false,
            recovery_code_hashes: [],
          },
        });
      } catch (_) {}

      return { data, error: null };
    } catch (err) {
      console.error("mfaService.disable2FA exception:", err);
      return { data: null, error: err };
    }
  },

  /**
   * Create an MFA challenge for login verification.
   */
  async createChallenge({ factorId }) {
    if (!factorId) {
      return { data: null, error: new Error("Missing factor ID for challenge.") };
    }
    try {
      const { data, error } = await supabase.auth.mfa.challenge({ factorId });
      return { data, error };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  /**
   * Verify an existing MFA challenge with an OTP code during login.
   * Upgrades the session to AAL2 on success.
   */
  async verifyChallenge({ factorId, challengeId, code }) {
    const cleanCode = String(code || "").trim();
    if (!factorId || !challengeId) {
      return { data: null, error: new Error("Missing challenge parameters.") };
    }
    if (!cleanCode || cleanCode.length !== 6) {
      return { data: null, error: new Error("Verification code must be exactly 6 digits.") };
    }

    try {
      const { data, error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: cleanCode,
      });
      return { data, error };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  /**
   * Create a challenge and verify in a single step during login.
   */
  async challengeAndVerify({ factorId, code }) {
    const cleanCode = String(code || "").trim();
    if (!factorId) {
      return { data: null, error: new Error("Missing factor ID.") };
    }
    if (!cleanCode || cleanCode.length !== 6) {
      return { data: null, error: new Error("Verification code must be exactly 6 digits.") };
    }

    try {
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: cleanCode,
      });
      return { data, error };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  /**
   * Fast check to enforce AAL2 on protected routes.
   * Returns { allowed: false, reason: 'MFA_REQUIRED' } if user has enabled 2FA but current session is only AAL1.
   */
  async checkAalAccess() {
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!error && data?.nextLevel === "aal2" && data?.currentLevel !== "aal2") {
        return { allowed: false, reason: "MFA_REQUIRED" };
      }
      return { allowed: true, reason: null };
    } catch {
      return { allowed: true, reason: null };
    }
  },
};

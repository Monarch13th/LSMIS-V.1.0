import { supabase } from "./supabaseClient";

export const mfaService = {
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

  async startEnrollment(friendlyName = "LSMIS Authenticator") {
    try {
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

  async hashRecoveryCode(code) {
    const clean = String(code || "").trim().toUpperCase();
    const msgBuffer = new TextEncoder().encode(clean);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  },

  async disable2FA({ factorId = null, password = null, email = null, otpCode = null } = {}) {
    try {
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

      let targetFactorId = factorId;
      if (!targetFactorId) {
        const { verifiedFactor } = await this.listFactors();
        if (!verifiedFactor) {
          return { data: null, error: new Error("No active Two-Factor Authentication factor found.") };
        }
        targetFactorId = verifiedFactor.id;
      }

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

      const { data, error } = await supabase.auth.mfa.unenroll({
        factorId: targetFactorId,
      });

      if (error) {
        return { data: null, error };
      }

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

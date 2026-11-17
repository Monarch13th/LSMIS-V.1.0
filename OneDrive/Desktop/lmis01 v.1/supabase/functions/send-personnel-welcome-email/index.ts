import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const escapeHtml = (str: string): string =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const normalizePersonnelRole = (rawRole: string): "Veterinarian" | "Slaughterhouse Staff" | null => {
  const r = String(rawRole || "").trim().toLowerCase();
  if (r === "vet" || r === "veterinarian" || r.includes("veterinarian")) {
    return "Veterinarian";
  }
  if (r === "staff" || r === "slaughterhouse staff" || r === "meat_inspector" || r.includes("staff")) {
    return "Slaughterhouse Staff";
  }
  return null;
};

const buildEmailContent = ({
  personnelName,
  recipientEmail,
  assignedRole,
  loginUrl,
}: {
  personnelName: string;
  recipientEmail: string;
  assignedRole: "Veterinarian" | "Slaughterhouse Staff";
  loginUrl: string;
}) => {
  const subject = "Welcome to LSMIS! Your Personnel Account Has Been Created";

  const text = `Dear ${personnelName},

Welcome to the Livestock Slaughter and Meat Inspection Management System (LSMIS)!

We are pleased to inform you that the Administrator has successfully created your personnel account. You are now part of the LSMIS team.

Your role as ${assignedRole} is an important part of helping us maintain an organized, efficient, and reliable livestock slaughter and meat inspection process.

We look forward to having you contribute your knowledge, dedication, and skills to our system. Every effort you make helps us improve our services and fulfill our responsibility to the community.

Your Account Information
- Name: ${personnelName}
- Email: ${recipientEmail}
- Assigned Role: ${assignedRole}
- Account Status: Active

You are now welcome to access your account using your assigned login credentials.

Login to LSMIS: ${loginUrl}

Thank you for becoming part of the LSMIS team. We wish you success in your responsibilities and look forward to working with you.

Warm regards,

LSMIS Administration Team
Livestock Slaughter and Meat Inspection Management System`;

  const safeName = escapeHtml(personnelName);
  const safeEmail = escapeHtml(recipientEmail);
  const safeRole = escapeHtml(assignedRole);
  const safeLoginUrl = escapeHtml(loginUrl);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a201c;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f7f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d9e2dc;box-shadow:0 4px 16px rgba(24,122,86,0.08);">
          <tr>
            <td style="background-color:#187A56;padding:24px 28px;text-align:left;">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#d1fae5;margin-bottom:4px;">
                LSMIS Administration
              </div>
              <h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;color:#ffffff;">
                Welcome to LSMIS! Your Personnel Account Has Been Created
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-size:14.5px;line-height:1.65;color:#27312b;">
              <p style="margin:0 0 16px;">Dear <strong>${safeName}</strong>,</p>
              <p style="margin:0 0 16px;">
                Welcome to the <strong>Livestock Slaughter and Meat Inspection Management System (LSMIS)</strong>!
              </p>
              <p style="margin:0 0 16px;">
                We are pleased to inform you that the Administrator has successfully created your personnel account. You are now part of the LSMIS team.
              </p>
              <p style="margin:0 0 16px;">
                Your role as <strong>${safeRole}</strong> is an important part of helping us maintain an organized, efficient, and reliable livestock slaughter and meat inspection process.
              </p>
              <p style="margin:0 0 22px;">
                We look forward to having you contribute your knowledge, dedication, and skills to our system. Every effort you make helps us improve our services and fulfill our responsibility to the community.
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f8fbf9;border:1px solid #d3e4da;border-radius:8px;margin-bottom:22px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-size:13px;font-weight:700;color:#187A56;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:10px;">
                      Your Account Information
                    </div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;color:#1a201c;">
                      <tr>
                        <td style="padding:4px 0;width:130px;color:#5d6660;font-weight:600;">Name:</td>
                        <td style="padding:4px 0;font-weight:600;">${safeName}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#5d6660;font-weight:600;">Email:</td>
                        <td style="padding:4px 0;">${safeEmail}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#5d6660;font-weight:600;">Assigned Role:</td>
                        <td style="padding:4px 0;font-weight:600;color:#187A56;">${safeRole}</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#5d6660;font-weight:600;">Account Status:</td>
                        <td style="padding:4px 0;"><span style="display:inline-block;background-color:#dcfce7;color:#166534;font-weight:700;font-size:12px;padding:2px 8px;border-radius:999px;">Active</span></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 18px;">
                You are now welcome to access your account using your assigned login credentials.
              </p>

              <div style="margin:0 0 22px;">
                <a href="${safeLoginUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#187A56;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;">
                  Login to LSMIS
                </a>
                <div style="margin-top:8px;font-size:12.5px;color:#5d6660;word-break:break-all;">
                  Official Login URL: <a href="${safeLoginUrl}" style="color:#187A56;">${safeLoginUrl}</a>
                </div>
              </div>

              <p style="margin:0 0 20px;">
                Thank you for becoming part of the LSMIS team. We wish you success in your responsibilities and look forward to working with you.
              </p>

              <p style="margin:0;color:#27312b;">
                Warm regards,<br /><br />
                <strong>LSMIS Administration Team</strong><br />
                <span style="color:#5d6660;font-size:13px;">Livestock Slaughter and Meat Inspection Management System</span>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "Missing authorization token." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      return jsonResponse({ success: false, error: "Unauthorized caller." }, 401);
    }

    const adminClient = supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey)
      : userClient;

    const { data: callerProfile } = await adminClient
      .from("users")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();

    const callerRole = String(
      callerProfile?.role || authData.user.user_metadata?.role || ""
    )
      .trim()
      .toLowerCase();

    if (callerRole !== "admin" && !callerRole.includes("admin")) {
      return jsonResponse(
        { success: false, error: "Only Administrators can dispatch personnel welcome emails." },
        403
      );
    }

    const body = await req.json();
    const recipientEmail = String(body?.recipient_email || "").trim().toLowerCase();
    const personnelName = String(body?.full_name || "").trim() || recipientEmail;
    const assignedRole = normalizePersonnelRole(body?.role || "");
    const loginUrl = String(body?.login_url || "https://lsmis.vercel.app/login").trim();

    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return jsonResponse({ success: false, error: "Invalid recipient email address." }, 400);
    }

    if (!assignedRole) {
      return jsonResponse(
        { success: false, error: "Role must be Veterinarian or Slaughterhouse Staff." },
        400
      );
    }

    const { subject, text, html } = buildEmailContent({
      personnelName,
      recipientEmail,
      assignedRole,
      loginUrl,
    });

    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");

    if (smtpHost && smtpUser && smtpPass) {
      const smtpPort = Number(Deno.env.get("SMTP_PORT") || "465");
      const smtpFrom =
        Deno.env.get("SMTP_FROM") || `LSMIS Administration Team <${smtpUser}>`;

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const info = await transporter.sendMail({
        from: smtpFrom,
        to: recipientEmail,
        subject,
        text,
        html,
      });

      return jsonResponse({
        success: true,
        provider: "smtp",
        messageId: info?.messageId || null,
        recipient: recipientEmail,
        role: assignedRole,
      });
    }

    return jsonResponse(
      {
        success: false,
        error:
          "SMTP email delivery is not configured on the server (missing SMTP_HOST, SMTP_USER, or SMTP_PASS secrets).",
      },
      503
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error sending welcome email.";
    return jsonResponse({ success: false, error: message }, 500);
  }
});

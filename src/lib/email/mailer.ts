/**
 * Email mailer — uses Resend if configured, falls back to console logging in dev
 * Set RESEND_API_KEY in .env.local to enable real email sending
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

const isDev = process.env.NODE_ENV !== "production";
const hasResend = !!process.env.RESEND_API_KEY;

export async function sendEmail(payload: EmailPayload): Promise<{ success: boolean; error?: string }> {
  // Dev console fallback
  if (!hasResend) {
    if (isDev) {
      console.log("\n📧 [EMAIL — DEV MODE — Resend not configured]");
      console.log("  To:", Array.isArray(payload.to) ? payload.to.join(", ") : payload.to);
      console.log("  Subject:", payload.subject);
      console.log("  HTML length:", payload.html.length, "chars");
      console.log("  [Set RESEND_API_KEY in .env.local to send real emails]\n");
    }
    return { success: true };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const fromEmail = process.env.RESEND_FROM_EMAIL || "SMC Audit <noreply@smcaudit.com>";
    const toAddresses = Array.isArray(payload.to) ? payload.to : [payload.to];

    const { error } = await resend.emails.send({
      from: fromEmail,
      to: toAddresses,
      subject: payload.subject,
      html: payload.html,
      replyTo: payload.replyTo,
    });

    if (error) {
      console.error("Resend error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Email send failed:", msg);
    return { success: false, error: msg };
  }
}

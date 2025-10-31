import nodemailer from "nodemailer";
// Brevo (Sendinblue) HTTP API client – used when BREVO_API_KEY is set
let BrevoApi: any = null;
try {
  // Lazy import to avoid runtime error if package is not installed yet
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  BrevoApi = require('sib-api-v3-sdk');
} catch {}

export type SendMailOptions = {
  to: string;
  subject: string;
  html: string;
};

let transporter: nodemailer.Transporter | null = null;
let brevoClient: any | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const debug = process.env.EMAIL_DEBUG === "1";

  if (!host || !user || !pass) {
    throw new Error("SMTP env vars missing (SMTP_HOST, SMTP_USER, SMTP_PASS)");
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    logger: debug,
    debug,
  });
  return transporter;
}

export async function verifySmtp() {
  try {
    // Brevo HTTP API kullanılıyorsa SMTP verify'i atla
    if (process.env.BREVO_API_KEY) {
      return;
    }
    // SMTP ayarları yoksa skip et
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log("SMTP not configured, skipping verification");
      return;
    }
    
    const t = getTransporter();
    await t.verify();
    if (process.env.EMAIL_DEBUG === "1") {
      // Log only in debug
    }
  } catch (err) {
    console.error("SMTP verify failed:", err);
  }
}

export async function sendMail({ to, subject, html }: SendMailOptions) {
  // Prefer Brevo HTTP API if configured (avoids blocked SMTP ports on PaaS like Render)
  if (process.env.BREVO_API_KEY && BrevoApi) {
    try {
      if (!brevoClient) {
        const defaultClient = BrevoApi.ApiClient.instance;
        const apiKey = defaultClient.authentications['api-key'];
        apiKey.apiKey = process.env.BREVO_API_KEY as string;
        brevoClient = new BrevoApi.TransactionalEmailsApi();
      }
      const fromRaw = process.env.MAIL_FROM || "Glorta <no-reply@glorta.io>";
      const match = fromRaw.match(/^(.*)\s*<([^>]+)>\s*$/);
      const sender = match ? { name: match[1].trim(), email: match[2].trim() } : { name: "Glorta", email: fromRaw };
      const sendSmtpEmail = {
        sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
      } as any;
      const res = await brevoClient.sendTransacEmail(sendSmtpEmail);
      return { messageId: res?.messageId || res?.messageId || 'brevo' };
    } catch (e) {
      console.error('Brevo send error:', e);
      throw e;
    }
  }

  // Fallback to SMTP (works only if your provider/network allows it)
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`Email would be sent to ${to}: ${subject}`);
    return { messageId: "mock-id" };
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@example.com";
  const t = getTransporter();
  return t.sendMail({ from, to, subject, html });
}



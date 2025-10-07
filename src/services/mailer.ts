import nodemailer from "nodemailer";

export type SendMailOptions = {
  to: string;
  subject: string;
  html: string;
};

let transporter: nodemailer.Transporter | null = null;

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
    const t = getTransporter();
    await t.verify();
    if (process.env.EMAIL_DEBUG === "1") {
      // Log only in debug
      console.log("SMTP verify: OK (", process.env.SMTP_HOST, ")");
    }
  } catch (err) {
    console.error("SMTP verify failed:", err);
  }
}

export async function sendMail({ to, subject, html }: SendMailOptions) {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@example.com";
  const t = getTransporter();
  if (process.env.EMAIL_DEBUG === "1") {
    console.log("Sending mail:", { from, to, subject });
  }
  await t.sendMail({ from, to, subject, html });
}



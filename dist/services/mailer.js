"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySmtp = verifySmtp;
exports.sendMail = sendMail;
const nodemailer_1 = __importDefault(require("nodemailer"));
let transporter = null;
function getTransporter() {
    if (transporter)
        return transporter;
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const debug = process.env.EMAIL_DEBUG === "1";
    if (!host || !user || !pass) {
        throw new Error("SMTP env vars missing (SMTP_HOST, SMTP_USER, SMTP_PASS)");
    }
    transporter = nodemailer_1.default.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        logger: debug,
        debug,
    });
    return transporter;
}
async function verifySmtp() {
    try {
        const t = getTransporter();
        await t.verify();
        if (process.env.EMAIL_DEBUG === "1") {
            // Log only in debug
            console.log("SMTP verify: OK (", process.env.SMTP_HOST, ")");
        }
    }
    catch (err) {
        console.error("SMTP verify failed:", err);
    }
}
async function sendMail({ to, subject, html }) {
    const from = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@example.com";
    const t = getTransporter();
    if (process.env.EMAIL_DEBUG === "1") {
        console.log("Sending mail:", { from, to, subject });
    }
    await t.sendMail({ from, to, subject, html });
}

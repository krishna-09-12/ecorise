import nodemailer from 'nodemailer';
import { APP_NAME } from '@/lib/brand';

function trimEnv(value: string | undefined) {
  return value?.trim().replace(/^["']|["']$/g, '') || '';
}

async function sendViaResend(to: string, subject: string, text: string): Promise<boolean> {
  const key = trimEnv(process.env.RESEND_API_KEY);
  if (!key) return false;

  // const from = trimEnv(process.env.RESEND_FROM_EMAIL) || `${APP_NAME} <onboarding@resend.dev>`;
 const from = "onboarding@resend.dev";
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });

  if (!res.ok) {
    console.error('Resend error:', await res.text());
    return false;
  }
  return true;
}

async function sendViaSmtp(to: string, subject: string, text: string): Promise<boolean> {
  const host = trimEnv(process.env.SMTP_HOST);
  const user = trimEnv(process.env.SMTP_USER);
  const pass = trimEnv(process.env.SMTP_PASS);
  if (!host || !user || !pass) return false;

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: trimEnv(process.env.SMTP_FROM) || user,
    to,
    subject,
    text,
  });
  return true;
}

export async function sendAuthEmail(to: string, text: string): Promise<boolean> {
  const subject = `Your ${APP_NAME} sign-in code`;
  if (await sendViaResend(to, subject, text)) return true;
  if (await sendViaSmtp(to, subject, text)) return true;
  return false;
}

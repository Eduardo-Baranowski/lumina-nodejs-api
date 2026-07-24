import nodemailer from "nodemailer";

const PASSWORD_RESET_EMAIL_ENABLED = process.env.PASSWORD_RESET_EMAIL_ENABLED === "1";
const EMAIL_SMTP_HOST = process.env.EMAIL_SMTP_HOST?.trim() ?? "";
const EMAIL_SMTP_PORT = Number(process.env.EMAIL_SMTP_PORT ?? "587");
const EMAIL_SMTP_SECURE = process.env.EMAIL_SMTP_SECURE === "1";
const EMAIL_SMTP_USER = process.env.EMAIL_SMTP_USER?.trim() ?? "";
const EMAIL_SMTP_PASS = process.env.EMAIL_SMTP_PASS?.trim() ?? "";
const EMAIL_FROM = process.env.EMAIL_FROM?.trim() ?? `no-reply@${process.env.BASE_URL?.replace(/^https?:\/\//, "") ?? "localhost"}`;

const isSmtpConfigured = (): boolean => {
  return (
    EMAIL_SMTP_HOST.length > 0 &&
    EMAIL_SMTP_PORT > 0 &&
    EMAIL_SMTP_USER.length > 0 &&
    EMAIL_SMTP_PASS.length > 0 &&
    EMAIL_FROM.length > 0
  );
};

const transporter = isSmtpConfigured()
  ? nodemailer.createTransport({
      host: EMAIL_SMTP_HOST,
      port: EMAIL_SMTP_PORT,
      secure: EMAIL_SMTP_SECURE,
      auth: {
        user: EMAIL_SMTP_USER,
        pass: EMAIL_SMTP_PASS,
      },
    })
  : null;

export const isPasswordResetEmailEnabled = (): boolean => {
  return PASSWORD_RESET_EMAIL_ENABLED && transporter !== null;
};

export const hasPasswordResetEmailConfiguration = (): boolean => {
  return isSmtpConfigured();
};

export const sendPasswordResetEmail = async (to: string, token: string): Promise<void> => {
  if (!transporter) {
    throw new Error("SMTP não configurado para envio de email de reset de senha.");
  }

  const text = `Olá!\n\nRecebemos uma solicitação para redefinir sua senha no Lumina.\n\nUse o código abaixo no aplicativo para redefinir sua senha:\n\n${token}\n\nSe você não solicitou essa alteração, apenas ignore esta mensagem.`;
  const html = `
    <p>Olá!</p>
    <p>Recebemos uma solicitação para redefinir sua senha no <strong>Lumina</strong>.</p>
    <p>Use o código abaixo no aplicativo para redefinir sua senha:</p>
    <pre style="background:#f4f4f4;padding:12px;border-radius:8px;white-space:pre-wrap;">${token}</pre>
    <p>Se você não solicitou essa alteração, apenas ignore esta mensagem.</p>
  `;

  await transporter.sendMail({
    from: EMAIL_FROM,
    to,
    subject: "Redefinição de senha — Lumina",
    text,
    html,
  });
};

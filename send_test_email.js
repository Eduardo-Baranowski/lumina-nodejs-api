import nodemailer from "nodemailer";
import dotenv from "dotenv";

// Carrega variáveis de ambiente do arquivo .env local (se existir).
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SMTP_HOST,
  port: Number(process.env.EMAIL_SMTP_PORT || 587),
  secure: process.env.EMAIL_SMTP_SECURE === "1",
  auth: {
    user: process.env.EMAIL_SMTP_USER,
    pass: process.env.EMAIL_SMTP_PASS,
  },
});

async function main() {
  try {
    // Verifica a conexão/credenciais sem enviar email
    await transporter.verify();
    console.log("SMTP conectado com sucesso. Preparando para enviar teste...");

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.SEND_TEST_TO || process.env.EMAIL_FROM,
      subject: "Teste SendGrid — Lumina",
      text: "Este é um email de teste gerado via SMTP SendGrid.",
    });

    console.log("Mensagem enviada. messageId=", info.messageId || info.response);
  } catch (err) {
    console.error("Falha ao verificar/enviar email:", err);
    process.exitCode = 1;
  }
}

main();

import nodemailer from 'nodemailer';

/**
 * Shared mail transport for OneRecon.
 * Gmail SMTP via EMAIL_USER / EMAIL_PASS (an app password) from backend/.env.
 * Single lazy transporter so OTPs and report deliveries reuse one connection.
 */
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER || 'dharan.mj05@gmail.com',
        pass: process.env.EMAIL_PASS || 'srux euuq zuup ywvw',
      },
    });
  }
  return transporter;
}

const fromAddress = () => `OneRecon <${process.env.EMAIL_USER || 'dharan.mj05@gmail.com'}>`;

/**
 * Send a plain mail. Resolves with nodemailer's accepted message info.
 */
export async function sendMail({ to, subject, text, html, attachments = [] }) {
  const t = getTransporter();
  return t.sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
    attachments,
  });
}

/**
 * Send a generated report document as an email attachment.
 * @param {object} opts
 * @param {string|string[]} opts.to            recipient email(s)
 * @param {string} opts.subject                email subject
 * @param {string} [opts.message]              body text (plain)
 * @param {string} opts.filePath               absolute path of the document to attach
 * @param {string} opts.fileName               attachment filename
 */
export async function sendReportEmail({ to, subject, message = '', filePath, fileName }) {
  const body = message || 'Please find the OneRecon report attached. Final decisions rest with authorized personnel.';
  return sendMail({
    to,
    subject,
    text: body,
    html: `<p>${String(body).replace(/\n/g, '<br/>')}</p>`,
    attachments: [{ filename: fileName, path: filePath }],
  });
}
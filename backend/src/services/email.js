/**
 * ZenPass Email Service
 * 使用 Nodemailer 發送電郵
 * 需要設定 SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 */
const nodemailer = require('nodemailer');

const smtpHost = process.env.SMTP_HOST || '';
const smtpPort = parseInt(process.env.SMTP_PORT || '587');
const smtpUser = process.env.SMTP_USER || '';
const smtpPass = process.env.SMTP_PASS || '';
const fromAddress = process.env.EMAIL_FROM || 'noreply@zenpass.hk';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!smtpHost || !smtpUser) {
    console.log('📧 SMTP not configured — emails will be logged to console');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
  return transporter;
}

/**
 * 發送電郵
 */
async function sendEmail(to, subject, html) {
  const t = getTransporter();
  if (!t) {
    console.log(`📧 [DEV EMAIL]\n━━━━━━━━━━━━━━━━━━━\nTo: ${to}\nSubject: ${subject}\n${html}\n━━━━━━━━━━━━━━━━━━━`);
    console.log('⚠️ SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS to enable real emails');
    return { sent: false, error: 'SMTP not configured' };
  }
  try {
    const info = await t.sendMail({
      from: `"ZenPass 禪流" <${fromAddress}>`,
      to,
      subject,
      html,
    });
    console.log(`📧 Email sent to ${to}: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('📧 Email failed:', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * 發送預約確認電郵
 */
async function sendBookingConfirmation(userEmail, userName, className, date, time, venue) {
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <div style="background:#c94420;color:white;padding:20px;text-align:center;border-radius:12px 12px 0 0">
        <h2 style="margin:0">ZenPass 禪流</h2>
      </div>
      <div style="background:white;padding:24px;border:1px solid #e5e7eb">
        <h3 style="margin:0 0 12px">✅ 預約確認</h3>
        <p>你好 <strong>${userName}</strong>，</p>
        <p>你的課程預約已確認！</p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0">
          <tr><td style="padding:8px;font-weight:600">課程</td><td>${className}</td></tr>
          <tr><td style="padding:8px;font-weight:600">日期</td><td>${date}</td></tr>
          <tr><td style="padding:8px;font-weight:600">時間</td><td>${time}</td></tr>
          <tr><td style="padding:8px;font-weight:600">地點</td><td>${venue}</td></tr>
        </table>
        <p style="font-size:12px;color:#6b7280;margin-top:16px">取消預約請登入 ZenPass 帳戶操作</p>
      </div>
    </div>
  `;
  return sendEmail(userEmail, `✅ 預約確認 — ${className}`, html);
}

module.exports = { sendEmail, sendBookingConfirmation };

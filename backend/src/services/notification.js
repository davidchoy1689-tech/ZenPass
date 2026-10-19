// @ts-check
const { getDb } = require("./database");

/**
 * ZenPass Notification Service
 * 支援：站內通知（DB）、Telegram Bot、Email (SMTP)
 *
 * 配置：透過 .env 設定
 * - NOTIFICATION_TYPES=db,telegram,email （啟用邊啲 channel）
 * - TELEGRAM_BOT_TOKEN=xxx
 * - TELEGRAM_CHAT_ID=xxx
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 */

const { sendPushNotification } = require("./push");

// ===== 1. 站內通知（持久化到 DB）=====
function dbNotification(recipientId, type, title, message, data = {}) {
  try {
    const db = getDb();
    const { v4: uuidv4 } = require("uuid");

    // recipient 必須存在（避免 FOREIGN KEY constraint failed 洗版）
    const exists = db.prepare("SELECT 1 FROM users WHERE id = ?").get(recipientId);
    if (!exists) {
      console.warn(`[NOTIF] skip ${type}: recipient ${recipientId} 不存在`);
      return false;
    }

    db.prepare(
      `
      INSERT INTO notifications (id, user_id, type, title, message, data, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `,
    ).run(uuidv4(), recipientId, type, title, message, JSON.stringify(data));

    return true;
  } catch (err) {
    console.error("DB notification error:", err.message);
    return false;
  }
}

// ===== 2. Telegram 通知 =====
async function telegramNotification(message, targetChatId) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = targetChatId || process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log(
      "⚠️ Telegram not configured - set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID",
    );
    return false;
  }

  try {
    const fetch = require("node-fetch");
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
        }),
      },
    );
    const data = await res.json();
    if (!data.ok) {
      console.error("Telegram send error:", data.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Telegram notification error:", err.message);
    return false;
  }
}

/**
 * sendTelegramAlert — 發送 Telegram 通知給管理員（+ console.log fallback）
 * 開發環境冇 Telegram 時會用 console.log 顯示
 */
async function sendTelegramAlert(message) {
  const sent = await telegramNotification(message);
  if (!sent) {
    console.log(`
🔔 [TELEGRAM ADMIN ALERT]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${message}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
    console.log(
      "ℹ️ 要啟用真實 Telegram 通知，請設定 TELEGRAM_BOT_TOKEN 同 TELEGRAM_CHAT_ID",
    );
  }
  return sent;
}

// ===== 3. WhatsApp 通知 (Twilio) =====
async function whatsappNotification(message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const to = process.env.TWILIO_WHATSAPP_TO;

  if (!accountSid || !authToken || !from || !to) {
    console.log(
      "⚠️ WhatsApp not configured - set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, TWILIO_WHATSAPP_TO",
    );
    return false;
  }

  try {
    const client = require("twilio")(accountSid, authToken);
    await client.messages.create({
      from: `whatsapp:${from}`,
      to: `whatsapp:${to}`,
      body: message,
    });
    return true;
  } catch (err) {
    console.error("WhatsApp notification error:", err.message);
    return false;
  }
}

// ===== 4. Email 通知 (SMTP) =====
async function emailNotification(to, subject, html) {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // Dev mode: log email content to console
    console.log(`
📧 [DEV EMAIL]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To: ${to}
Subject: ${subject}
Body:
${html}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
    console.log(
      "⚠️ SMTP not configured - email logged to console",
    );
    return true;
  }

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: user,
      to,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error("Email notification error:", err.message);
    return false;
  }
}

// ===== 5. 統一發送介面 =====
async function sendNotification(type, payload) {
  const types = (process.env.NOTIFICATION_TYPES || "db").split(",");
  const results = {};

  const { recipient, data } = payload;

  // 決定通知內容
  let title, message, html;
  switch (type) {
    case "booking.confirmed":
      title = "預約確認";
      message = `✅ 預約成功！\n課程：${data?.class_title || "—"}\n日期：${data?.date || "—"} ${data?.time || "—"}\n場地：${data?.venue || "—"}\n教練：${data?.coach_name || "—"}`;
      html = `<h2>✅ 預約確認</h2><p><b>課程：</b>${data?.class_title || "—"}<br><b>日期：</b>${data?.date || "—"} ${data?.time || "—"}<br><b>場地：</b>${data?.venue || "—"}<br><b>教練：</b>${data?.coach_name || "—"}</p>`;
      break;
    case "class.vacancy":
      title = "📢 有位喇！";
      message = data?.message || `「${data?.class_title || "課程"}」有名額釋放，快啲預約！`;
      html = `<h2>📢 有位喇！</h2><p>${data?.message || `「${data?.class_title || "課程"}」有名額釋放，快啲預約！`}</p>`;
      break;
    case "booking.cancelled":
      title = "預約取消";
      message = `❌ 預約已取消\n課程：${data?.class_title || "—"}\n日期：${data?.date || "—"}`;
      html = `<h2>❌ 預約取消</h2><p><b>課程：</b>${data?.class_title || "—"}<br><b>日期：</b>${data?.date || "—"}</p>`;
      break;
    case "coach.new_booking":
      title = "新預約通知";
      message = `📅 有新預約！\n學生：${data?.student_name || "—"}\n課程：${data?.class_title || "—"}\n日期：${data?.date || "—"} ${data?.time || "—"}\n金額：$${data?.amount || "—"}`;
      html = `<h2>📅 新預約通知</h2><p><b>學生：</b>${data?.student_name || "—"}<br><b>課程：</b>${data?.class_title || "—"}<br><b>日期：</b>${data?.date || "—"} ${data?.time || "—"}<br><b>金額：</b>$${data?.amount || "—"}</p>`;
      break;
    case "payment.received":
      title = "付款成功";
      message = `💰 付款成功！\n金額：$${data?.amount || "—"}\n方式：${data?.method || "—"}\n參考：${data?.reference || "—"}`;
      html = `<h2>💰 付款成功</h2><p><b>金額：</b>$${data?.amount || "—"}<br><b>方式：</b>${data?.method || "—"}<br><b>參考：</b>${data?.reference || "—"}</p>`;
      break;
    case "payment.new_fps_payme":
      title = "新 FPS/PayMe 付款通知";
      message = `🆕 有新付款待確認！\n用戶：${data?.user_name || "—"}\n金額：$${data?.amount || "—"}\n方式：${data?.method || "—"}\n參考：${data?.reference || "—"}\n課程：${data?.class_title || "—"}\n⏰ ${data?.submitted_at || ""}`;
      html = `<h2>🆕 新付款通知</h2><p><b>用戶：</b>${data?.user_name || "—"}<br><b>金額：</b>$${data?.amount || "—"}<br><b>方式：</b>${data?.method || "—"}<br><b>參考：</b>${data?.reference || "—"}<br><b>課程：</b>${data?.class_title || "—"}<br><b>提交時間：</b>${data?.submitted_at || ""}</p>`;
      break;
    case "payment.admin_confirmed":
      title = "管理員已確認付款";
      message = `✅ 管理員已確認付款！\n金額：$${data?.amount || "—"}\n方式：${data?.method || "—"}\n課程：${data?.class_title || "—"}\n管理員備註：${data?.notes || "—"}`;
      html = `<h2>✅ 付款已確認</h2><p><b>金額：</b>$${data?.amount || "—"}<br><b>方式：</b>${data?.method || "—"}<br><b>課程：</b>${data?.class_title || "—"}</p>`;
      break;
    case "payment.admin_rejected":
      title = "管理員已拒絕付款";
      message = `❌ 管理員已拒絕付款！\n金額：$${data?.amount || "—"}\n方式：${data?.method || "—"}\n課程：${data?.class_title || "—"}\n原因：${data?.reason || "請聯絡管理員查詢"}`;
      html = `<h2>❌ 付款被拒絕</h2><p><b>金額：</b>$${data?.amount || "—"}<br><b>方式：</b>${data?.method || "—"}<br><b>課程：</b>${data?.class_title || "—"}<br><b>原因：</b>${data?.reason || "請聯絡管理員查詢"}</p>`;
      break;
    case "topup.auto_completed":
      title = "Auto Top-up 完成";
      message = `🤖 已自動加購 ${data?.bundle_label || ""}！
新增 ${data?.credits_added || 0} Credits
金額：HK$${data?.amount_paid || 0}
現有 Credits：${data?.new_balance || 0}`;
      html = `<h2>🤖 Auto Top-up 完成</h2><p><b>已加購：</b>${data?.bundle_label || ""}<br><b>新增：</b>${data?.credits_added || 0} Credits<br><b>金額：</b>HK$${data?.amount_paid || 0}<br><b>現有 Credits：</b>${data?.new_balance || 0}</p>`;
      break;
    case "consultation.requested":
      title = "🧑‍⚕️ 新健康諮詢申請";
      message = `會員：${data?.user_name || "—"}\n類型：${data?.kind_label || "—"}\n希望時間：${data?.preferred_time || "未指定"}\n備註：${data?.notes || "—"}\n請去 Admin → 健康諮詢 安排。`;
      html = `<h2>🧑‍⚕️ 新健康諮詢申請</h2><p><b>會員：</b>${data?.user_name || "—"}<br><b>類型：</b>${data?.kind_label || "—"}<br><b>希望時間：</b>${data?.preferred_time || "未指定"}<br><b>備註：</b>${data?.notes || "—"}</p>`;
      break;
    case "consultation.scheduled":
      title = "📅 健康諮詢已安排";
      message = `你嘅${data?.kind_label || "健康諮詢"}已安排：${data?.scheduled_at || "—"}${data?.admin_note ? `\n備註：${data.admin_note}` : ""}`;
      html = `<h2>📅 健康諮詢已安排</h2><p>你嘅 <b>${data?.kind_label || "健康諮詢"}</b> 已安排：<b>${data?.scheduled_at || "—"}</b>${data?.admin_note ? `<br><b>備註：</b>${data.admin_note}` : ""}</p>`;
      break;
    case "consultation.completed":
      title = "✅ 健康諮詢已完成";
      message = `多謝你完成今次${data?.kind_label || "健康諮詢"}！有意見可以喺 App 內反映。`;
      html = `<h2>✅ 健康諮詢已完成</h2><p>多謝你完成今次${data?.kind_label || "健康諮詢"}！</p>`;
      break;
    case "consultation.cancelled":
      title = "健康諮詢申請已取消";
      message = `你嘅${data?.kind_label || "健康諮詢"}申請已取消${data?.admin_note ? `（原因：${data.admin_note}）` : ""}。名額已退回，可以重新申請。`;
      html = `<h2>健康諮詢申請已取消</h2><p>你嘅${data?.kind_label || "健康諮詢"}申請已取消${data?.admin_note ? `（原因：${data.admin_note}）` : ""}。</p>`;
      break;
    case "booking.reminder_1d":
      title = "📅 明日課堂提醒";
      message = `你聽日有堂！\n課程：${data?.class_title || "—"}\n日期：${data?.date || "—"} ${data?.time || "—"}\n場地：${data?.venue || "—"}\n記得準時出席，並喺現場簽到。`;
      html = `<h2>📅 明日課堂提醒</h2><p><b>課程：</b>${data?.class_title || "—"}<br><b>日期：</b>${data?.date || "—"} ${data?.time || "—"}<br><b>場地：</b>${data?.venue || "—"}</p>`;
      break;
    case "booking.reminder_1h":
      title = "⏰ 一小時後上堂";
      message = `你嘅課堂一小時後開始！\n課程：${data?.class_title || "—"}\n時間：${data?.date || ""} ${data?.time || ""}\n場地：${data?.venue || "—"}`;
      html = `<h2>⏰ 一小時後上堂</h2><p><b>課程：</b>${data?.class_title || "—"}<br><b>時間：</b>${data?.date || ""} ${data?.time || ""}<br><b>場地：</b>${data?.venue || "—"}</p>`;
      break;
    case "coach.approved":
      title = "✅ 教練申請已獲批";
      message = data?.message || "✅ 教練申請已獲批！你而家可以開班授課啦。";
      html = `<h2>✅ 教練申請已獲批</h2><p>${data?.message || "你而家可以開班授課啦。"}</p>`;
      break;
    case "coach.rejected":
      title = "教練申請結果";
      message = data?.message || "❌ 教練申請未獲批，如有疑問請聯絡我們。";
      html = `<h2>教練申請結果</h2><p>${data?.message || "教練申請未獲批，如有疑問請聯絡我們。"}</p>`;
      break;
    case "school.inquiry":
      title = "🏫 新學校查詢";
      message = `學校：${data?.school_name || "—"}\n聯絡：${data?.contact_name || "—"}（${data?.contact_email || "—"}）\n電話：${data?.contact_phone || "—"}\n項目：${data?.sports_of_interest || "未指定"}\n備註：${data?.message || "—"}`;
      html = `<h2>🏫 新學校查詢</h2><p><b>學校：</b>${data?.school_name || "—"}<br><b>聯絡：</b>${data?.contact_name || "—"}（${data?.contact_email || "—"}）<br><b>電話：</b>${data?.contact_phone || "—"}<br><b>項目：</b>${data?.sports_of_interest || "未指定"}<br><b>備註：</b>${data?.message || "—"}</p>`;
      break;
    case "corporate.inquiry":
      title = "🏢 新企業查詢";
      message = `公司：${data?.company_name || "—"}\n聯絡：${data?.contact_name || "—"}（${data?.contact_email || "—"}）\n電話：${data?.contact_phone || "—"}\n活動：${data?.activities || "未指定"}\n備註：${data?.message || "—"}`;
      html = `<h2>🏢 新企業查詢</h2><p><b>公司：</b>${data?.company_name || "—"}<br><b>聯絡：</b>${data?.contact_name || "—"}（${data?.contact_email || "—"}）<br><b>電話：</b>${data?.contact_phone || "—"}<br><b>活動：</b>${data?.activities || "未指定"}<br><b>備註：</b>${data?.message || "—"}</p>`;
      break;
    case "coach.referral":
      title = "🧑‍🏫 新教練推薦";
      message = `推薦人：${data?.referred_by || "—"}\n教練：${data?.name || "—"}\n電郵：${data?.email || "—"}\n電話：${data?.phone || "—"}`;
      html = `<h2>🧑‍🏫 新教練推薦</h2><p><b>推薦人：</b>${data?.referred_by || "—"}<br><b>教練：</b>${data?.name || "—"}<br><b>電郵：</b>${data?.email || "—"}<br><b>電話：</b>${data?.phone || "—"}</p>`;
      break;
    case "membership.confirmed":
      title = "🎉 會籍已開通";
      message = `會籍：${data?.plan || "—"}\n已加：${data?.credits || 0} Credits\n到期日：${data?.expires || "—"}`;
      html = `<h2>🎉 會籍已開通</h2><p><b>會籍：</b>${data?.plan || "—"}<br><b>已加：</b>${data?.credits || 0} Credits<br><b>到期日：</b>${data?.expires || "—"}</p>`;
      break;
    case "booking.refunded":
      title = "💸 退款已處理";
      message = `金額：HK$${data?.amount || 0}\n預約：${data?.booking_reference || ""}\n原因：${data?.reason || "—"}\n退款會按原付款方式處理。`;
      html = `<h2>💸 退款已處理</h2><p><b>金額：</b>HK$${data?.amount || 0}<br><b>預約：</b>${data?.booking_reference || ""}<br><b>原因：</b>${data?.reason || "—"}</p>`;
      break;
    case "payment.approved":
      title = "✅ 付款已確認";
      message = `金額：HK$${data?.amount || 0}\n課程：${data?.class_name || data?.class_title || "—"}\n付款已確認，預約正式生效。`;
      html = `<h2>✅ 付款已確認</h2><p><b>金額：</b>HK$${data?.amount || 0}<br><b>課程：</b>${data?.class_name || data?.class_title || "—"}</p>`;
      break;
    case "payment.rejected":
      title = "❌ 付款未獲確認";
      message = `金額：HK$${data?.amount || 0}\n課程：${data?.class_title || "—"}\n原因：${data?.reason || "請聯絡管理員查詢"}`;
      html = `<h2>❌ 付款未獲確認</h2><p><b>金額：</b>HK$${data?.amount || 0}<br><b>課程：</b>${data?.class_title || "—"}<br><b>原因：</b>${data?.reason || "請聯絡管理員查詢"}</p>`;
      break;
    case "waitlist.opened":
      title = "📢 候補有位！";
      message = `「${data?.class_title || "課程"}」而家有位，快啲去預約啦！`;
      html = `<h2>📢 候補有位！</h2><p>「${data?.class_title || "課程"}」而家有位，快啲去預約啦！</p>`;
      break;
    case "waitlist.promoted":
      title = "🎉 你已補上候補";
      message = `「${data?.class_title || "課程"}」${data?.date || ""} ${data?.time || ""} — 你已由候補補上，記得準時出席。`;
      html = `<h2>🎉 你已補上候補</h2><p>「${data?.class_title || "課程"}」${data?.date || ""} ${data?.time || ""}</p>`;
      break;
    case "waiver.submitted":
      title = "📋 新健康申報";
      message = `會員：${data?.user_name || "—"}\n姓名：${data?.name || "—"}\n健康狀況：${data?.conditions || "無"}`;
      html = `<h2>📋 新健康申報</h2><p><b>會員：</b>${data?.user_name || "—"}<br><b>姓名：</b>${data?.name || "—"}<br><b>健康狀況：</b>${data?.conditions || "無"}</p>`;
      break;
    case "credits.topup_request":
      title = "⏳ 增值單已提交";
      message = `金額：HK$${data?.amount || 0}${data?.discount_percent ? `（會員 -${data.discount_percent}%）` : ""}\n方式：${String(data?.method || "").toUpperCase()}\n管理員核對收款後會即刻加點。`;
      html = `<h2>⏳ 增值單已提交</h2><p><b>金額：</b>HK$${data?.amount || 0}<br><b>方式：</b>${String(data?.method || "").toUpperCase()}</p>`;
      break;
    case "credits.topup_confirmed":
      title = "✅ Credits 已入帳";
      message = `已加 ${data?.credits || 0} Credits（HK$${data?.amount || 0}）`;
      html = `<h2>✅ Credits 已入帳</h2><p>已加 <b>${data?.credits || 0}</b> Credits（HK$${data?.amount || 0}）</p>`;
      break;
    case "marketing.welcome":
      title = data?.title || "歡迎加入 ZenPass";
      message = data?.message || "歡迎加入 ZenPass！";
      html = `<h2>${data?.title || "歡迎加入 ZenPass"}</h2><p>${data?.message || ""}</p>`;
      break;
    case "marketing.winback":
      title = data?.title || "我哋好掛住你！";
      message = data?.message || data?.body || "返嚟 ZenPass 睇吓新課程啦！";
      html = `<h2>${data?.title || "我哋好掛住你！"}</h2><p>${data?.message || data?.body || ""}</p>`;
      break;
    case "coach.payout_processed":
      title = "提現處理結果";
      message = `${data?.status === "approved" ? "✅ 提現已批准" : "❌ 提現未獲批"}\n金額：HK$${data?.amount || 0}${data?.eta ? `\n預計到賬：${data.eta}` : ""}${data?.reason ? `\n備註：${data.reason}` : ""}`;
      html = `<h2>提現處理結果</h2><p>${data?.status === "approved" ? "✅ 提現已批准" : "❌ 提現未獲批"}</p><p><b>金額：</b>HK$${data?.amount || 0}${data?.eta ? `<br><b>預計到賬：</b>${data.eta}` : ""}${data?.reason ? `<br><b>備註：</b>${data.reason}` : ""}</p>`;
      break;
    case "payout.requested":
      title = "💰 新提現申請";
      message = `教練：${data?.coach_name || "—"}\n金額：HK$${data?.amount || 0}\n請去 Admin → 出糧 處理。`;
      html = `<h2>💰 新提現申請</h2><p><b>教練：</b>${data?.coach_name || "—"}<br><b>金額：</b>HK$${data?.amount || 0}</p>`;
      break;
    case "wallet.mismatch":
      title = "⚠️ 錢包對帳不一致";
      message = `發現 ${data?.count || 0} 個用戶 wallet_balance 同 pending_payout 不一致（${data?.date || ""}）\n${data?.sample || ""}`;
      html = `<h2>⚠️ 錢包對帳不一致</h2><p>發現 <b>${data?.count || 0}</b> 個用戶帳目不一致。</p><pre>${data?.sample || ""}</pre>`;
      break;
    case "points.adjusted":
      title = "積分已調整";
      message = `🏅 你嘅積分已調整 ${data?.delta > 0 ? "+" : ""}${data?.delta || 0} 分${data?.reason ? `（${data.reason}）` : ""}\n最新餘額：${data?.balance ?? "—"} 分`;
      html = `<h2>🏅 積分已調整</h2><p>調整：<b>${data?.delta > 0 ? "+" : ""}${data?.delta || 0}</b> 分${data?.reason ? `<br><b>原因：</b>${data.reason}` : ""}<br><b>最新餘額：</b>${data?.balance ?? "—"} 分</p>`;
      break;
    case "points.expiry_soon":
      title = "積分即將到期";
      message = `⏳ 你嘅 ${data?.points || 0} 積分將於 ${data?.expires_on || "30 日內"} 到期（連續 12 個月無積分活動）。快啲去積分頁兌換啦！`;
      html = `<h2>⏳ 積分即將到期</h2><p>你嘅 <b>${data?.points || 0}</b> 積分將於 <b>${data?.expires_on || "30 日內"}</b> 到期。</p><p>快啲去積分頁兌換啦！</p>`;
      break;
    case "membership.paused":
      title = "會籍已暫停";
      message = `⏸️ 你嘅會籍已暫停 ${data?.days || 0} 日，會籍到期日已順延至 ${data?.end_date || "—"}。暫停期間仍可睇課程，但不能預約。`;
      html = `<h2>⏸️ 會籍已暫停</h2><p>你嘅會籍已暫停 <b>${data?.days || 0}</b> 日，到期日已順延至 <b>${data?.end_date || "—"}</b>。</p>`;
      break;
    case "membership.resume":
      title = "會籍已恢復";
      message = `🔁 你嘅會籍已自動恢復！暫停期已結束，可以繼續預約課程。`;
      html = `<h2>🔁 會籍已恢復</h2><p>暫停期已結束，可以繼續預約課程。</p>`;
      break;
    case "membership.expiring":
      title = "會籍即將到期";
      message = `⏰ 你嘅會籍將於 ${data?.end_date || "—"} 到期（剩 ${data?.days_left ?? "—"} 日）。到期後每月 Credits 及會員權益會停止，記得續會啦！`;
      html = `<h2>⏰ 會籍即將到期</h2><p>你嘅會籍將於 <b>${data?.end_date || "—"}</b> 到期（剩 <b>${data?.days_left ?? "—"}</b> 日）。</p><p>到期後每月 Credits 及會員權益會停止，記得續會啦！</p>`;
      break;
    case "credit_expiring":
      title = "Credits 即將到期";
      message = `⏰ 你嘅 ${data?.plan_name || "月費"} Plan 將於 ${data?.expiry_date || "下月 1 日"} 重置，剩餘 ${data?.remaining_credits || 0} Credits 將歸零。快啲用埋佢啦！`;
      html = `<h2>⏰ Credits 即將到期</h2><p>你嘅 <b>${data?.plan_name || "月費"}</b> Plan 將於 <b>${data?.expiry_date || "下月 1 日"}</b> 重置，剩餘 <b>${data?.remaining_credits || 0}</b> Credits 將歸零。</p><p>快啲用埋佢啦！</p>`;
      break;
    case "venue.vacancy":
      title = "📉 有空置時段";
      message =
        `${data?.venue_name || "場地"} 有 ${data?.count || 0} 個時段仲有位！\n` +
        ((data?.slots || [])
          .map((s) => `• ${s.title || "課程"} ${String(s.start_time || "").slice(0, 16).replace("T", " ")}（減 ${s.discount_pct || 0}%）`)
          .join("\n") || "") +
        "\n快啲去商戶／課程頁睇吓啦～";
      html =
        `<h2>📉 有空置時段</h2><p><b>${data?.venue_name || "場地"}</b> 有 ${data?.count || 0} 個時段仲有位：</p><ul>` +
        (data?.slots || [])
          .map((s) => `<li>${s.title || "課程"} — ${String(s.start_time || "").slice(0, 16).replace("T", " ")}（減 ${s.discount_pct || 0}%）</li>`)
          .join("") +
        "</ul>";
      break;
    case "marketing.broadcast":
      title = data?.title || "ZenPass 通知";
      message = data?.message || "";
      html = `<h2>${data?.title || "ZenPass 通知"}</h2><p>${String(data?.message || "").replace(/\n/g, "<br>")}</p>`;
      break;
    case "booking.refund_pending":
      title = "💸 退款處理中";
      message = `我哋已收到你嘅退款申請（${data?.booking_reference || ""}）。\n退款金額：HK$${data?.amount || 0}\n方式：${String(data?.method || "fps").toUpperCase()}\n管理員會盡快人手轉賬，完成後會再通知你。`;
      html = `<h2>💸 退款處理中</h2><p><b>預約：</b>${data?.booking_reference || ""}<br><b>金額：</b>HK$${data?.amount || 0}<br><b>方式：</b>${String(data?.method || "fps").toUpperCase()}</p><p>管理員會盡快人手轉賬，完成後會再通知你。</p>`;
      break;
    case "partner.rental_price_request":
      title = "🏷️ 商戶租金申請";
      message = `場地：${data?.venue_name || "—"}\n申請租金：HK$${data?.requested_price || 0}/小時\n原因：${data?.reason || "（未填）"}\n請去 Admin → 商戶 審批。`;
      html = `<h2>🏷️ 商戶租金申請</h2><p><b>場地：</b>${data?.venue_name || "—"}<br><b>申請租金：</b>HK$${data?.requested_price || 0}/小時<br><b>原因：</b>${data?.reason || "（未填）"}</p>`;
      break;
    case "partner.rental_price_result":
      title = data?.status === "approved" ? "✅ 租金申請已批准" : "❌ 租金申請未獲批";
      message = `場地：${data?.venue_name || "—"}\n申請租金：HK$${data?.requested_price || 0}/小時${data?.note ? `\n備註：${data.note}` : ""}`;
      html = `<h2>${data?.status === "approved" ? "✅ 租金申請已批准" : "❌ 租金申請未獲批"}</h2><p><b>場地：</b>${data?.venue_name || "—"}<br><b>申請租金：</b>HK$${data?.requested_price || 0}/小時${data?.note ? `<br><b>備註：</b>${data.note}` : ""}</p>`;
      break;
    default:
      title = type;
      message = data?.message || "你有一則新通知";
      html = `<p>${data?.message || "你有一則新通知"}</p>`;
  }

  // Send to each enabled channel
  for (const t of types) {
    switch (t.trim()) {
      case "db":
        if (recipient) {
          results.db = dbNotification(recipient, type, title, message, data);
        }
        // Also send push notification
        if (results.db !== false) {
          sendPushNotification(recipient, title, message, { url: data?.url || "/my.html" });
        }
        break;
      case "telegram":
        results.telegram = await telegramNotification(message);
        break;
      case "email":
        // 自動查找 recipient 嘅 email（如果 data.email 冇提供）
        let emailTo = data?.email;
        if (!emailTo && recipient) {
          try {
            const db = getDb();
            const user = userDb
              .prepare("SELECT email FROM users WHERE id = ? OR email = ?")
              .get(recipient, recipient);
            if (user?.email) emailTo = user.email;
          } catch (e) {
            /* silent */
          }
        }
        if (emailTo) {
          results.email = await emailNotification(
            emailTo,
            `[ZenPass] ${title}`,
            html,
          );
        } else {
          console.log("⚠️ Email notification skipped: no recipient email");
        }
        break;
      case "whatsapp":
        results.whatsapp = await whatsappNotification(message);
        break;
      case "whatsapp_free":
        results.whatsapp_free = await whatsappFreeNotification(message);
        break;
    }
  }

  return results;
}

// ===== 5. 通知列表查詢（供 routes/notifications.js 使用）=====

function getNotifications(
  userId,
  { page = 1, limit = 50, unreadOnly = false } = {},
) {
  try {
    const db = getDb();
    const offset = (page - 1) * limit;

    let whereClause = "WHERE user_id = ?";
    const params = [userId];
    if (unreadOnly) {
      whereClause += " AND is_read = 0";
    }

    const total = db
      .prepare(`SELECT COUNT(*) as count FROM notifications ${whereClause}`)
      .get(...params);
    const rows = db
      .prepare(
        `SELECT * FROM notifications ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    return {
      notifications: rows,
      total: total.count,
      page,
      limit,
      totalPages: Math.ceil(total.count / limit),
    };
  } catch (err) {
    console.error("getNotifications error:", err.message);
    return { notifications: [], total: 0, page, limit, totalPages: 0 };
  }
}

function getUnreadCount(userId) {
  try {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0",
      )
      .get(userId);

    return row.count;
  } catch (err) {
    console.error("getUnreadCount error:", err.message);
    return 0;
  }
}

function markAsRead(id, userId) {
  try {
    const db = getDb();
    const result = db
      .prepare(
        "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
      )
      .run(id, userId);

    return result.changes > 0;
  } catch (err) {
    console.error("markAsRead error:", err.message);
    return false;
  }
}

function markAllAsRead(userId) {
  try {
    const db = getDb();
    const result = db
      .prepare(
        "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
      )
      .run(userId);

    return result.changes;
  } catch (err) {
    console.error("markAllAsRead error:", err.message);
    return 0;
  }
}

// ===== 3b. WhatsApp 通知 (CallMeBot - 免費，唔使 account) =====
async function whatsappFreeNotification(message, phone, apiKeyIn) {
  const apiKey = apiKeyIn || process.env.WHATSAPP_CALLMEBOT_KEY;
  const to = phone || process.env.WHATSAPP_CALLMEBOT_TO;

  if (!apiKey || !to) {
    console.log(
      "⚠️ WhatsApp (CallMeBot) not configured - set WHATSAPP_CALLMEBOT_KEY and WHATSAPP_CALLMEBOT_TO",
    );
    return false;
  }

  try {
    const fetch = require("node-fetch");
    const url = `https://api.callmebot.com/whatsapp.php?phone=${to}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
    const res = await fetch(url);
    const text = await res.text();
    if (text.includes("sent") || res.ok) return true;
    console.error("WhatsApp send error:", text);
    return false;
  } catch (err) {
    console.error("WhatsApp notification error:", err.message);
    return false;
  }
}

module.exports = {
  sendNotification,
  dbNotification,
  telegramNotification,
  sendTelegramAlert,
  emailNotification,
  whatsappFreeNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  sendPushNotification,
};

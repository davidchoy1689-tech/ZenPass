/**
 * 子女報平安：優先用 Web Push，冇訂閱就回退 wa.me 連結。
 */
const { sendPushNotification } = require("./push");

async function notifySponsor({ userId, parentName, text, bookingId, coachName }) {
  if (process.env.SPONSOR_PUSH_ENABLED === "0") return { sent: 0, disabled: true };
  try {
    const r = await sendPushNotification(userId, "【ZenPass 課堂報平安】", text, {
      booking_id: bookingId,
      parent_name: parentName,
      coach_name: coachName || "",
      url: "/my-bookings.html",
    });
    return r || { sent: 0 };
  } catch (e) {
    return { sent: 0, error: e.message };
  }
}

module.exports = { notifySponsor };

/**
 * 工單七 — 推廣來源（UTM）記錄
 * 只接受 [a-z0-9_-]，最長 40 字；唔會覆寫已有值（首次接觸歸因）。
 */
function clean(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z0-9_-]{1,40}$/.test(s)) return null;
  return s;
}

function recordAttribution(db, bookingIds, source, campaign) {
  const s = clean(source), c = clean(campaign);
  if (!s && !c) return 0;
  const ids = (Array.isArray(bookingIds) ? bookingIds : [bookingIds]).filter(Boolean);
  if (!ids.length) return 0;
  const st = db.prepare(
    "UPDATE bookings SET utm_source=COALESCE(utm_source, ?), utm_campaign=COALESCE(utm_campaign, ?) WHERE id=?",
  );
  let n = 0;
  for (const id of ids) {
    try {
      n += st.run(s, c, id).changes;
    } catch (e) {
      console.warn("[UTM] skip", id, e.message);
    }
  }
  return n;
}

module.exports = { clean, recordAttribution };

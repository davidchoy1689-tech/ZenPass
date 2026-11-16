/**
 * test-tz-series.js — 時區安全測試（系列改期）
 * 重點：無論伺服器 TZ 係 UTC、HK 定 America/Los_Angeles，結果都要一樣。
 * 用 child process 改 TZ 逐個跑（Node 會 cache timezone，所以要分 process）。
 */
const { execFileSync } = require("child_process");

const ZONES = ["UTC", "Asia/Hong_Kong", "America/Los_Angeles"];

function runInner() {
  const tz = require("../src/utils/tz");
  const out = [];
  let pass = 0, bad = 0;
  const ok = (cond, label, got) => {
    if (cond) { pass++; out.push("  ✅ " + label); }
    else { bad++; out.push("  ❌ " + label + (got !== undefined ? `（實際 ${JSON.stringify(got)}）` : "")); }
  };

  const TZ = process.env.TZ || "(unset)";
  out.push(`\n🧪 TZ=${TZ}`);

  // 1) 本地 12:00 → UTC 04:00
  const u = tz.zonedLocalToUtc("2027-01-05", "12:00");
  ok(u.toISOString() === "2027-01-05T04:00:00.000Z", "HK 12:00 → 04:00Z", u.toISOString());

  // 2) 反向：04:00Z → HK 12:00，且日期正確
  const p = tz.localPartsOf(new Date("2027-01-05T04:00:00.000Z"));
  ok(p.date === "2027-01-05" && p.time === "12:00", "04:00Z → 2027-01-05 12:00", p);

  // 3) 日曆日差（跨年）
  ok(tz.isoDayDelta("2026-12-29", "2027-01-05") === 7, "跨年日差 = 7 日", tz.isoDayDelta("2026-12-29", "2027-01-05"));

  // 4) UTC 邊界：23:30Z = 翌日 07:30 HKT
  const late = tz.localPartsOf(new Date("2027-01-05T23:30:00.000Z"));
  ok(late.date === "2027-01-06" && late.time === "07:30", "23:30Z → 翌日 07:30", late);

  // 5) addDaysISO 跨月／跨年
  ok(tz.addDaysISO("2027-01-29", 7) === "2027-02-05", "01-29 +7 = 02-05", tz.addDaysISO("2027-01-29", 7));
  ok(tz.addDaysISO("2026-12-29", 7) === "2027-01-05", "12-29 +7 = 2027-01-05", tz.addDaysISO("2026-12-29", 7));

  // 6) 模擬 series following：3 堂（本地 12:00 / 19:00 / 09:30）整體 +7 日
  const series = ["2027-01-05T04:00:00.000Z", "2027-01-12T11:00:00.000Z", "2027-01-19T01:30:00.000Z"];
  const deltaDays = 7;
  const shifted = series.map((iso) => {
    const lp = tz.localPartsOf(new Date(iso));
    return {
      from: lp,
      to: tz.localPartsOf(tz.zonedLocalToUtc(tz.addDaysISO(lp.date, deltaDays), lp.time)).date +
        " " + tz.localPartsOf(tz.zonedLocalToUtc(tz.addDaysISO(lp.date, deltaDays), lp.time)).time,
    };
  });
  ok(shifted[0].to === "2027-01-12 12:00", "第1堂 +7 日 12:00", shifted[0].to);
  ok(shifted[1].to === "2027-01-19 19:00", "第2堂 +7 日 19:00（保留原鐘數）", shifted[1].to);
  ok(shifted[2].to === "2027-01-26 09:30", "第3堂 +7 日 09:30（跨 UTC 日界）", shifted[2].to);

  // 7) 非 HK 時區要 409
  let threw = null;
  try { tz.zonedLocalToUtc("2027-01-05", "12:00", "America/New_York"); } catch (e) { threw = e; }
  ok(threw && threw.code === "TZ_UNSUPPORTED", "非 HK 時區 → TZ_UNSUPPORTED", threw && threw.code);

  out.push(`  結果：${pass} passed / ${bad} failed`);
  return { pass, bad, text: out.join("\n") };
}

if (process.env.TZ_CHILD === "1") {
  const r = runInner();
  console.log(r.text);
  process.exit(r.bad === 0 ? 0 : 1);
}

let failed = 0;
for (const zone of ZONES) {
  try {
    const out = execFileSync(process.execPath, [__filename], {
      env: { ...process.env, TZ: zone, TZ_CHILD: "1" },
      encoding: "utf8",
    });
    process.stdout.write(out);
  } catch (e) {
    failed++;
    process.stdout.write(String(e.stdout || "") + String(e.stderr || ""));
    console.log(`❌ TZ=${zone} 失敗`);
  }
}
console.log(`\n${failed === 0 ? "✅ 三個時區全部一致（TZ 安全）" : `❌ ${failed} 個時區失敗`}`);
process.exit(failed === 0 ? 0 : 1);

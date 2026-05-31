#!/usr/bin/env node
/**
 * 將所有 reference 編號改為順序格式：前綴-0001, 前綴-0002 ...
 * 執行：node backend/scripts/migrate-references.js
 */
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/zenpass.db");
const db = new Database(DB_PATH);

const tables = {
  users: { ref: "user_reference", prefix: "US" },
  classes: { ref: "class_reference", prefix: "CL" },
  bookings: { ref: "booking_reference", prefix: "ZP" },
  memberships: { ref: "membership_reference", prefix: "MB" },
  coach_applications: { ref: "application_reference", prefix: "CA" },
};

for (const [table, cfg] of Object.entries(tables)) {
  const rows = db
    .prepare(`SELECT rowid, id, ${cfg.ref} FROM ${table} ORDER BY rowid ASC`)
    .all();
  let seq = 1;
  let updated = 0;
  for (const row of rows) {
    const newRef = `${cfg.prefix}-${String(seq).padStart(4, "0")}`;
    if (row[cfg.ref] !== newRef) {
      db.prepare(`UPDATE ${table} SET ${cfg.ref} = ? WHERE id = ?`).run(
        newRef,
        row.id,
      );
      updated++;
    }
    seq++;
  }
  console.log(`✅ ${table}: ${updated} updated, next seq = ${seq}`);
}

db.close();
console.log("\n🎉 全部 reference 已轉為順序編號！");

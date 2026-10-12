#!/usr/bin/env node
/**
 * ZenPass 禪流 — 測試帳戶 Seed（CI / 本地）
 *
 * 目的：為 CI `test` job 及本地測試提供穩定嘅登入帳戶，
 *       令依賴 admin token 嘅測試（points / waiver / improvements）唔再因
 *       「無 seed 用戶」而整批 401 失敗。
 *
 * 特性：
 *  - 冪等（idempotent）：重複執行安全，會更新現有帳戶而非重複插入
 *  - 自帶 schema 初始化（呼叫 init-db，本身亦冪等）
 *  - 只影響測試 DB（DB_PATH 環境變數）
 *
 * 用法:
 *   DB_PATH=./data/test.db node tests/seed-test-users.js
 */

const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const initDatabase = require("../src/config/init-db");
const updateDatabase = require("../src/config/update-db");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

// 確保 schema 存在（兩者皆冪等）
//  - init-db：基礎表 + points_rewards / badges
//  - update-db：遷移（audit_log / ledger / partner_venues …）
initDatabase();
updateDatabase();

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const users = [
  {
    id: "admin-001",
    ref: "US-0001",
    email: "admin@zenpass.hk",
    password: "admin123",
    name: "Admin",
    role: "admin",
    is_coach: 0,
    credits: 0,
  },
  {
    id: "coach-001",
    ref: "US-0002",
    email: "coach@zenpass.hk",
    password: "coach123",
    name: "Coach",
    role: "coach",
    is_coach: 1,
    credits: 0,
  },
  {
    id: "student-001",
    ref: "US-0003",
    email: "student@zenpass.hk",
    password: "student123",
    name: "Student",
    role: "user",
    is_coach: 0,
    credits: 200,
  },
];

const insert = db.prepare(`
  INSERT INTO users
    (id, user_reference, email, password_hash, name, auth_provider, role,
     is_coach, credits, email_verified, agree_terms, penalty_consent, updated_at)
  VALUES
    (@id, @ref, @email, @hash, @name, 'email', @role,
     @is_coach, @credits, 1, 1, 1, datetime('now'))
  ON CONFLICT(email) DO UPDATE SET
    password_hash = excluded.password_hash,
    name          = excluded.name,
    role          = excluded.role,
    is_coach      = excluded.is_coach,
    credits       = excluded.credits,
    email_verified = 1,
    updated_at    = datetime('now')
`);

let count = 0;
for (const u of users) {
  insert.run({
    id: u.id,
    ref: u.ref,
    email: u.email,
    hash: bcrypt.hashSync(u.password, 10),
    name: u.name,
    role: u.role,
    is_coach: u.is_coach,
    credits: u.credits,
  });
  count++;
}

// 覆核登入可用性
const admin = db
  .prepare("SELECT id, email, role, password_hash FROM users WHERE email = ?")
  .get("admin@zenpass.hk");
const ok = admin && bcrypt.compareSync("admin123", admin.password_hash);

console.log(`✅ Seeded ${count} test users into ${path.resolve(DB_PATH)}`);
console.log(
  `   admin@zenpass.hk / admin123  →  ${ok ? "驗證通過 ✅" : "驗證失敗 ❌"}`,
);

db.close();

if (!ok) {
  process.exit(1);
}

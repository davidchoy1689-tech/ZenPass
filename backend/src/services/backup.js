/**
 * ZenPass 備份與還原服務
 * 支援 SQLite (本地) + Supabase (PostgreSQL)
 *
 * 功能：
 * 1. SQLite 檔案快照備份 (JSON dump)
 * 2. Supabase 備份 (PostgREST)
 * 3. 自動每日備份排程
 * 4. 一鍵還原
 * 5. 資料庫完整性檢查
 */
const { getDb } = require("./database");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const logger = require("./logger");
const { getSupabase } = require("./supabase");

const DB_PATH = process.env.DB_PATH || "./data/zenpass.db";

const BACKUP_DIR = path.join(__dirname, "..", "..", "backups");
const MAX_BACKUPS = 30; // Keep 30 days of backups
const DAILY_BACKUP_HOUR = 3; // 3 AM daily

// Tables to include in backup
const BACKUP_TABLES = [
  "users",
  "classes",
  "class_schedules",
  "bookings",
  "memberships",
  "transactions",
  "coach_earnings",
  "coach_payouts",
  "private_income",
  "course_contents",
  "locations",
  "sales",
  "notifications",
  "points_transactions",
  "points_rewards",
  "points_redemptions",
  "badges",
  "user_badges",
  "reviews",
  "referral_codes",
  "referral_redemptions",
  "student_notes",
  "push_subscriptions",
  "waitlist",
  "venue_rentals",
  "pricing_config",
  "partner_venues",
  "partner_members",
  "partner_payouts",
  // IPO audit — do NOT back up from separate journal
  // "audit_log", "ledger", "wallet_transactions" — kept live only
];

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Open a read-only connection for backup (avoids lock contention)
 */
function openReadOnlyDb() {
  const db = getDb();
  db.pragma("journal_mode = WAL");
  return db;
}

// ===========================
// SQLite Backup
// ===========================

async function createSqliteBackup(name, description = "") {
  const backupId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `zenpass-backup-${timestamp}-${backupId.slice(0, 8)}.json`;
  const filepath = path.join(BACKUP_DIR, filename);

  const db = openReadOnlyDb();
  try {
    const snapshot = {};
    let totalSize = 0;
    let totalRows = 0;

    // Verify database integrity first
    const integrity = db.prepare("PRAGMA integrity_check").get();
    if (integrity && integrity.integrity_check !== "ok") {
      throw new Error(
        `Database integrity check failed: ${integrity.integrity_check}`,
      );
    }

    for (const table of BACKUP_TABLES) {
      try {
        // Check if table exists
        const exists = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table);
        if (!exists) continue;

        const rows = db.prepare(`SELECT * FROM "${table}"`).all();
        snapshot[table] = rows;
        totalRows += rows.length;
        totalSize += JSON.stringify(rows).length;
      } catch (err) {
        logger.warn(`Backup skip ${table}: ${err.message}`);
        snapshot[table] = [];
      }
    }

    // Get DB file size
    const dbStat = fs.statSync(DB_PATH);

    const manifest = {
      id: backupId,
      name: name || `備份 ${new Date().toLocaleString("zh-HK")}`,
      description,
      created_at: new Date().toISOString(),
      version: "1.0",
      engine: "sqlite",
      tables_count: Object.keys(snapshot).filter((t) => snapshot[t].length > 0)
        .length,
      total_rows: totalRows,
      size_bytes: totalSize,
      db_file_size: dbStat.size,
      db_path: DB_PATH,
      md5: "",
    };

    const backupData = { manifest, snapshot };

    // Write atomically
    const tmpPath = filepath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(backupData, null, 0));
    fs.renameSync(tmpPath, filepath);

    // Calculate MD5 after write
    const fileContent = fs.readFileSync(filepath);
    const md5 = crypto.createHash("md5").update(fileContent).digest("hex");
    manifest.md5 = md5;

    // Update manifest in file
    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 0));

    // Clean old backups
    cleanupOldBackups();

    logger.info(
      `✅ SQLite backup created: ${name} (${totalRows} rows, ${(totalSize / 1024).toFixed(1)} KB)`,
    );
    return backupId;
  } finally {

  }
}

async function listSqliteBackups(limit = 20) {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("zenpass-backup-") && f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map((filename) => {
    const filepath = path.join(BACKUP_DIR, filename);
    try {
      const raw = JSON.parse(fs.readFileSync(filepath, "utf-8"));
      return {
        id: raw.manifest.id,
        name: raw.manifest.name,
        description: raw.manifest.description,
        created_at: raw.manifest.created_at,
        engine: raw.manifest.engine || "sqlite",
        size_bytes: raw.manifest.size_bytes || fs.statSync(filepath).size,
        total_rows: raw.manifest.total_rows,
        tables_count: raw.manifest.tables_count,
        filename,
        filepath,
      };
    } catch {
      return {
        id: filename.replace(/\.json$/, ""),
        name: filename,
        created_at: fs.statSync(filepath).mtime.toISOString(),
        engine: "sqlite",
        size_bytes: fs.statSync(filepath).size,
        filename,
        filepath,
      };
    }
  });
}

async function restoreSqliteBackup(backupId) {
  const backups = await listSqliteBackups(MAX_BACKUPS);
  const target = backups.find(
    (b) => b.id === backupId || b.filename.includes(backupId),
  );
  if (!target) throw new Error("找不到備份檔案");

  logger.warn(`⚠️ Starting restore from: ${target.name}`);

  // Auto-backup current state before restore
  await createSqliteBackup("自動備份（還原前）", "還原操作前自動創建");

  const raw = JSON.parse(fs.readFileSync(target.filepath, "utf-8"));
  const { manifest, snapshot } = raw;

  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("備份資料已損毀");
  }

  // Verify MD5
  const fileContent = fs.readFileSync(target.filepath);
  const md5 = crypto.createHash("md5").update(fileContent).digest("hex");
  if (manifest.md5 && manifest.md5 !== md5) {
    throw new Error("備份檔案 checksum 不符 — 可能已損毀");
  }

  const db = getDb();
  writeDb.pragma("journal_mode = WAL");
  writeDb.pragma("foreign_keys = OFF");
  try {
    for (const table of BACKUP_TABLES) {
      const rows = snapshot[table];
      if (!rows || !Array.isArray(rows) || rows.length === 0) continue;

      // Check table exists
      const exists = writeDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      if (!exists) continue;

      // Delete existing data
      writeDb.prepare(`DELETE FROM "${table}"`).run();

      // Batch insert
      const insertMany = writeDb.transaction((rows) => {
        for (const row of rows) {
          const keys = Object.keys(row);
          const placeholders = keys.map(() => "?").join(",");
          const values = keys.map((k) => row[k]);
          try {
            writeDb
              .prepare(
                `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${placeholders})`,
              )
              .run(...values);
          } catch (err) {
            logger.warn(`  ${table}: skip row — ${err.message}`);
          }
        }
      });
      insertMany(rows);
      logger.info(`  ✅ ${table}: ${rows.length} rows restored`);
    }

    logger.info(`✅ Restore complete: ${manifest.name}`);
    return {
      restored: true,
      backupName: manifest.name,
      tables: manifest.tables_count,
    };
  } finally {
    writeDb.pragma("foreign_keys = ON");

  }
}

async function deleteSqliteBackup(backupId) {
  const backups = await listSqliteBackups(MAX_BACKUPS);
  const target = backups.find(
    (b) => b.id === backupId || b.filename.includes(backupId),
  );
  if (!target) throw new Error("找不到備份");

  fs.unlinkSync(target.filepath);
  logger.info(`🗑️ Backup deleted: ${target.name}`);
  return { deleted: true };
}

function cleanupOldBackups() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("zenpass-backup-") && f.endsWith(".json"))
    .sort();

  while (files.length > MAX_BACKUPS) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(BACKUP_DIR, oldest));
    logger.info(`🗑️ Cleaned old backup: ${oldest}`);
  }
}

// ===========================
// Supabase Backup (legacy)
// ===========================

const SUPABASE_BACKUP_TABLES = [
  "courses",
  "course_sessions",
  "bookings",
  "coaches",
  "students",
  "profiles",
  "users",
  "membership_plans",
  "user_memberships",
  "transactions",
  "settlements",
  "course_categories",
  "system_config",
];

async function createSupabaseBackup(name, description = "") {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase 未連接");

  const backupId = crypto.randomUUID();
  const snapshot = {};
  let totalSize = 0;

  for (const table of SUPABASE_BACKUP_TABLES) {
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw error;
      snapshot[table] = data || [];
      totalSize += JSON.stringify(data || []).length;
    } catch (err) {
      logger.warn(`Supabase backup skip ${table}: ${err.message}`);
      snapshot[table] = [];
    }
  }

  const { data: config } = await supabase.from("system_config").select("*");

  const { error } = await supabase.from("system_backups").insert({
    id: backupId,
    name: name || `備份 ${new Date().toLocaleString("zh-HK")}`,
    description,
    snapshot,
    config_snapshot: config || [],
    created_at: new Date().toISOString(),
    size_bytes: totalSize,
  });

  if (error) throw error;

  logger.info(
    `✅ Supabase backup created: ${name} (${(totalSize / 1024).toFixed(1)} KB)`,
  );
  return backupId;
}

async function listSupabaseBackups(limit = 20) {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("system_backups")
    .select("id, name, description, created_at, restored_at, size_bytes")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

async function restoreSupabaseBackup(backupId) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase 未連接");

  await createSupabaseBackup("自動備份（還原前）", "還原操作前自動創建");

  const { data: backup, error: fetchError } = await supabase
    .from("system_backups")
    .select("*")
    .eq("id", backupId)
    .single();

  if (fetchError || !backup) throw new Error("找不到備份記錄");
  if (!backup.snapshot) throw new Error("備份資料已損毀");

  const snapshot = backup.snapshot;

  for (const table of SUPABASE_BACKUP_TABLES) {
    const records = snapshot[table];
    if (!records || !Array.isArray(records)) continue;

    try {
      await supabase
        .from(table)
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");

      for (let i = 0; i < records.length; i += 50) {
        const batch = records.slice(i, i + 50);
        const { error } = await supabase.from(table).insert(batch);
        if (error) logger.warn(`${table} batch ${i}: ${error.message}`);
      }
      logger.info(`  ✅ ${table}: ${records.length} restored`);
    } catch (err) {
      logger.error(`  ❌ ${table} restore failed: ${err.message}`);
    }
  }

  if (backup.config_snapshot && Array.isArray(backup.config_snapshot)) {
    for (const cfg of backup.config_snapshot) {
      await supabase
        .from("system_config")
        .upsert({ key: cfg.key, value: cfg.value }, { onConflict: "key" });
    }
  }

  await supabase
    .from("system_backups")
    .update({ restored_at: new Date().toISOString() })
    .eq("id", backupId);

  logger.info(`✅ Supabase restored to: ${backup.name}`);
  return { restored: true, backupName: backup.name };
}

async function deleteSupabaseBackup(backupId) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase 未連接");

  const { error } = await supabase
    .from("system_backups")
    .delete()
    .eq("id", backupId);
  if (error) throw error;
  return { deleted: true };
}

// ===========================
// Unified API
// ===========================

function isSqliteMode() {
  return !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY;
}

async function createBackup(name, description = "") {
  if (isSqliteMode()) {
    return await createSqliteBackup(name, description);
  }
  return await createSupabaseBackup(name, description);
}

async function listBackups(limit = 20) {
  if (isSqliteMode()) {
    return await listSqliteBackups(limit);
  }
  return await listSupabaseBackups(limit);
}

async function restoreBackup(backupId) {
  if (isSqliteMode()) {
    return await restoreSqliteBackup(backupId);
  }
  return await restoreSupabaseBackup(backupId);
}

async function deleteBackup(backupId) {
  if (isSqliteMode()) {
    return deleteSqliteBackup(backupId);
  }
  return await deleteSupabaseBackup(backupId);
}

// ===========================
// Database Integrity Check
// ===========================

async function checkIntegrity() {
  const results = { status: "ok", checks: [] };

  try {
    const db = getDb();

    // 1. SQLite integrity
    const integrity = db.prepare("PRAGMA integrity_check").get();
    results.checks.push({
      name: "sqlite_integrity",
      status: integrity?.integrity_check === "ok" ? "ok" : "fail",
      detail: integrity?.integrity_check || "unknown",
    });

    // 2. Foreign key integrity
    db.pragma("foreign_keys = ON");
    const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
    results.checks.push({
      name: "foreign_keys",
      status: fkCheck.length === 0 ? "ok" : "warn",
      detail:
        fkCheck.length === 0 ? "all ok" : `${fkCheck.length} violations found`,
      violations: fkCheck,
    });

    // 3. Table row counts
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();

    const tableStats = {};
    for (const t of tables) {
      try {
        const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
        tableStats[t.name] = count.c;
      } catch {
        tableStats[t.name] = -1;
      }
    }
    results.checks.push({
      name: "table_counts",
      status: "ok",
      detail: `${Object.keys(tableStats).length} tables, ${Object.values(tableStats).reduce((a, b) => a + b, 0)} total rows`,
      tables: tableStats,
    });

    // 4. WAL mode status
    const journal = db.prepare("PRAGMA journal_mode").get();
    results.checks.push({
      name: "journal_mode",
      status: journal?.journal_mode === "wal" ? "ok" : "warn",
      detail: journal?.journal_mode || "unknown",
    });

    // 5. DB file size
    const dbStat = fs.statSync(DB_PATH);
    results.checks.push({
      name: "db_file_size",
      status: "ok",
      detail: `${(dbStat.size / 1024).toFixed(1)} KB`,
    });

    // 6. Page count + page size
    const pageCount = db.prepare("PRAGMA page_count").get();
    const pageSize = db.prepare("PRAGMA page_size").get();
    results.checks.push({
      name: "db_pages",
      status: "ok",
      detail: `${pageCount?.page_count || 0} pages × ${pageSize?.page_size || 0} bytes`,
    });

    // 7. Backup availability
    const backupList = await listSqliteBackups(999);
    const backupCount = Array.isArray(backupList) ? backupList.length : 0;
    results.checks.push({
      name: "backups",
      status: backupCount > 0 ? "ok" : "warn",
      detail: `${backupCount} backups available`,
    });

    // Overall status
    const failures = results.checks.filter((c) => c.status === "fail");
    const warnings = results.checks.filter((c) => c.status === "warn");
    if (failures.length > 0) results.status = "fail";
    else if (warnings.length > 0) results.status = "warn";

    results.failures = failures.length;
    results.warnings = warnings.length;
    results.passed = results.checks.length - failures.length - warnings.length;
  } catch (err) {
    results.status = "error";
    results.error = err.message;
  }

  return results;
}

/**
 * Auto-backup on server startup (if last backup > 24h)
 */
async function autoBackupOnStartup() {
  try {
    const backups = await listSqliteBackups(1);
    if (!backups || backups.length === 0) {
      logger.info("🔄 No previous backup found — creating initial backup...");
      createSqliteBackup("初始自動備份", "開機自動創建").catch((err) =>
        logger.error("Initial backup failed:", err.message),
      );
    } else {
      const lastBackup = new Date(backups[0].created_at);
      const hoursAgo = (Date.now() - lastBackup.getTime()) / (1000 * 60 * 60);
      if (hoursAgo > 24) {
        logger.info(
          `🔄 Last backup ${hoursAgo.toFixed(0)}h ago — creating daily backup...`,
        );
        createSqliteBackup("每日自動備份", "每日備份自動排程").catch((err) =>
          logger.error("Daily backup failed:", err.message),
        );
      } else {
        logger.info(`✅ Last backup ${hoursAgo.toFixed(0)}h ago — skipping`);
      }
    }
  } catch (err) {
    logger.error("Auto-backup check failed:", err.message);
  }
}

/**
 * Schedule daily backups using setInterval
 */
function scheduleDailyBackup() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(DAILY_BACKUP_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const msUntilNext = next.getTime() - now.getTime();
  logger.info(`⏰ Daily backup scheduled: ${next.toLocaleString("zh-HK")}`);

  setTimeout(() => {
    createSqliteBackup("每日自動備份", "每日備份自動排程").catch((err) =>
      logger.error("Scheduled backup failed:", err.message),
    );
    // Reschedule for next day
    setInterval(
      () => {
        createSqliteBackup("每日自動備份", "每日備份自動排程").catch((err) =>
          logger.error("Scheduled backup failed:", err.message),
        );
      },
      24 * 60 * 60 * 1000,
    );
  }, msUntilNext);
}

module.exports = {
  // Unified API (auto-detects SQLite vs Supabase)
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,

  // Integrity
  checkIntegrity,

  // Scheduling
  autoBackupOnStartup,
  scheduleDailyBackup,
};

/**
 * ZenPass 系統備份與還原服務
 * 
 * 功能：
 * 1. 創建完整數據快照（所有主要表）
 * 2. 一鍵還原至前一個快照
 * 3. 列出所有可用備份
 * 4. 自動在重大操作前創建備份
 */
const { getSupabase } = require("./supabase");
const logger = require("./logger");

const BACKUP_TABLES = [
  "courses", "course_sessions", "bookings", "coaches",
  "students", "profiles", "users", "membership_plans",
  "user_memberships", "transactions", "settlements",
  "course_categories", "system_config",
];

/**
 * 創建完整系統備份
 */
async function createBackup(name, description = "") {
  const supabase = getSupabase();
  if (!supabase) throw new Error("資料庫連接失敗");

  const backupId = crypto.randomUUID();
  const snapshot = {};
  let totalSize = 0;

  for (const table of BACKUP_TABLES) {
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw error;
      snapshot[table] = data || [];
      totalSize += JSON.stringify(data || []).length;
    } catch (err) {
      logger.warn(`備份跳過 ${table}: ${err.message}`);
      snapshot[table] = [];
    }
  }

  // Also save current system config
  const { data: config } = await supabase
    .from("system_config")
    .select("*");

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

  logger.info(`✅ 備份已創建: ${name} (${(totalSize / 1024).toFixed(1)} KB)`);
  return backupId;
}

/**
 * 從快照還原系統
 */
async function restoreBackup(backupId) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("資料庫連接失敗");

  // 1. 先保存當前狀態作為還原前的備份
  await createBackup(
    "自動備份（還原前）",
    `在還原備份 ${backupId} 之前自動創建`
  );

  // 2. 獲取目標備份
  const { data: backup, error: fetchError } = await supabase
    .from("system_backups")
    .select("*")
    .eq("id", backupId)
    .single();

  if (fetchError || !backup) throw new Error("找不到備份記錄");
  if (!backup.snapshot) throw new Error("備份資料已損毀");

  const snapshot = backup.snapshot;

  // 3. 逐表還原（先刪除再插入）
  for (const table of BACKUP_TABLES) {
    const records = snapshot[table];
    if (!records || !Array.isArray(records)) continue;

    try {
      // 清空該表（保留結構）
      await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      
      // 分批插入（避免 payload 過大）
      for (let i = 0; i < records.length; i += 50) {
        const batch = records.slice(i, i + 50);
        const { error } = await supabase.from(table).insert(batch);
        if (error) {
          // 允許某些表有約束衝突，記錄警告
          logger.warn(`${table} 批次 ${i}: ${error.message}`);
        }
      }
      logger.info(`  ✅ ${table}: ${records.length} 條還原`);
    } catch (err) {
      logger.error(`  ❌ ${table} 還原失敗: ${err.message}`);
    }
  }

  // 4. 恢復系統配置
  if (backup.config_snapshot && Array.isArray(backup.config_snapshot)) {
    for (const cfg of backup.config_snapshot) {
      await supabase
        .from("system_config")
        .upsert({ key: cfg.key, value: cfg.value }, { onConflict: "key" });
    }
  }

  // 5. 標記備份已還原
  await supabase
    .from("system_backups")
    .update({ restored_at: new Date().toISOString() })
    .eq("id", backupId);

  logger.info(`✅ 系統已還原至備份: ${backup.name}`);
  return { restored: true, backupName: backup.name };
}

/**
 * 獲取備份列表
 */
async function listBackups(limit = 20) {
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

/**
 * 刪除備份
 */
async function deleteBackup(backupId) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("資料庫連接失敗");

  const { error } = await supabase
    .from("system_backups")
    .delete()
    .eq("id", backupId);

  if (error) throw error;
  return { deleted: true };
}

/**
 * 自動備份（在重大操作前調用）
 * 例如：更新系統配置、大量數據導入、審批教練等
 */
async function autoBackup(operation) {
  const name = `🔄 [自動] ${operation}`;
  return await createBackup(name, `操作前自動備份: ${operation}`);
}

module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  deleteBackup,
  autoBackup,
};

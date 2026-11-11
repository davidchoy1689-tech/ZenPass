/**
 * family.js — 家庭共享錢包 API
 *  GET  /api/family/my
 *  POST /api/family/groups { group_name, members:[{phone, relation_title, can_consume_pass}] }
 *  POST /api/family/groups/:id/members { phone, relation_title, can_consume_pass }
 */
const express = require("express");
const crypto = require("crypto");
const { getDb } = require("../services/database");
const { authenticateToken } = require("../middleware/auth");
const { audit } = require("../services/audit");
const familyWallet = require("../services/family-wallet");

const router = express.Router();
const RELATIONS = ["self", "spouse", "father", "mother", "child", "sibling", "other"];

function findUserByPhone(db, phone) {
  const p = String(phone || "").replace(/\D/g, "").replace(/^852/, "");
  if (!/^[4-9]\d{7}$/.test(p)) return null;
  return db.prepare("SELECT id, name, phone FROM users WHERE phone=? ORDER BY created_at LIMIT 1").get(p) || null;
}

router.get("/my", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    familyWallet.ensureSchema(db);
    const groups = db
      .prepare(
        `SELECT fg.*, u.name AS owner_name,
                (SELECT COUNT(*) FROM family_members fm WHERE fm.family_group_id=fg.id) AS member_count
           FROM family_groups fg JOIN users u ON u.id=fg.owner_user_id
          WHERE fg.owner_user_id=? OR fg.id IN (SELECT family_group_id FROM family_members WHERE member_user_id=?)
          ORDER BY datetime(fg.created_at) DESC`,
      )
      .all(req.user.id, req.user.id);
    const out = groups.map((g) => ({
      ...g,
      members: db
        .prepare(
          `SELECT fm.*, u.name, u.phone FROM family_members fm JOIN users u ON u.id=fm.member_user_id WHERE fm.family_group_id=?`,
        )
        .all(g.id)
        .map((m) => ({ ...m, phone_masked: m.phone ? String(m.phone).replace(/^(\d{4})\d{4}$/, "$1****") : "" })),
      passes: db
        .prepare("SELECT * FROM user_passes WHERE family_group_id=? AND status='active' AND remaining_credits>0")
        .all(g.id)
        .map((p) => ({ id: p.id, remaining_credits: p.remaining_credits, total_credits: p.total_credits, expires_at: p.expires_at })),
    }));
    res.json({ success: true, data: out });
  } catch (e) {
    console.error("[FAMILY] my:", e.message);
    res.status(500).json({ success: false, error: "讀取家庭錢包失敗" });
  }
});

router.post("/groups", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    familyWallet.ensureSchema(db);
    const b = req.body || {};
    const name = String(b.group_name || "").trim();
    if (name.length < 2) return res.status(400).json({ success: false, error: "請輸入家庭名稱（至少 2 字）" });
    const members = Array.isArray(b.members) ? b.members : [];
    if (members.length > 6) return res.status(400).json({ success: false, error: "家庭成員上限 6 人" });

    const groupId = "fam_" + crypto.randomBytes(8).toString("hex");
    db.transaction(() => {
      db.prepare("INSERT INTO family_groups (id, owner_user_id, group_name) VALUES (?,?,?)").run(groupId, req.user.id, name);
      db.prepare(
        "INSERT INTO family_members (id, family_group_id, member_user_id, relation_title, can_consume_pass) VALUES (?,?,?,'self',1)",
      ).run("fm_" + crypto.randomBytes(6).toString("hex"), groupId, req.user.id);
      for (const m of members) {
        const u = findUserByPhone(db, m.phone);
        if (!u || u.id === req.user.id) continue;
        const rel = RELATIONS.includes(String(m.relation_title)) ? m.relation_title : "other";
        db.prepare(
          "INSERT OR IGNORE INTO family_members (id, family_group_id, member_user_id, relation_title, can_consume_pass) VALUES (?,?,?,?,?)",
        ).run("fm_" + crypto.randomBytes(6).toString("hex"), groupId, u.id, rel, m.can_consume_pass === 0 || m.can_consume_pass === false ? 0 : 1);
      }
      audit({
        actionType: "family.group_created",
        entityType: "family_group",
        entityId: groupId,
        userId: req.user.id,
        newValues: { group_name: name, member_count: members.length + 1 },
        description: "建立家庭共享錢包",
      });
    })();
    res.status(201).json({ success: true, data: { id: groupId } });
  } catch (e) {
    console.error("[FAMILY] create:", e.message);
    res.status(500).json({ success: false, error: "建立家庭錢包失敗" });
  }
});

router.post("/groups/:id/members", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    familyWallet.ensureSchema(db);
    const g = db.prepare("SELECT * FROM family_groups WHERE id=?").get(req.params.id);
    if (!g) return res.status(404).json({ success: false, error: "找不到家庭群組" });
    if (g.owner_user_id !== req.user.id) return res.status(403).json({ success: false, error: "只有付款人可新增成員" });
    const b = req.body || {};
    const u = findUserByPhone(db, b.phone);
    if (!u) return res.status(404).json({ success: false, error: "此電話未註冊 ZenPass，請先邀請對方登記" });
    const rel = RELATIONS.includes(String(b.relation_title)) ? b.relation_title : "other";
    db.prepare(
      "INSERT OR IGNORE INTO family_members (id, family_group_id, member_user_id, relation_title, can_consume_pass) VALUES (?,?,?,?,?)",
    ).run("fm_" + crypto.randomBytes(6).toString("hex"), g.id, u.id, rel, b.can_consume_pass === 0 || b.can_consume_pass === false ? 0 : 1);
    try {
      audit({
        actionType: "family.member_added",
        entityType: "family_group",
        entityId: g.id,
        userId: req.user.id,
        newValues: { member_user_id: u.id, relation_title: rel },
        description: "新增家庭成員",
      });
    } catch (e) {}
    res.status(201).json({ success: true, data: { member_user_id: u.id, name: u.name } });
  } catch (e) {
    console.error("[FAMILY] add member:", e.message);
    res.status(500).json({ success: false, error: "新增成員失敗" });
  }
});

// 將自己名下有效的 Pass 加入家庭群組（付款人限定）
router.post("/groups/:id/passes/:passId", authenticateToken, (req, res) => {
  try {
    const db = getDb();
    familyWallet.ensureSchema(db);
    const g = db.prepare("SELECT * FROM family_groups WHERE id=?").get(req.params.id);
    if (!g) return res.status(404).json({ success: false, error: "找不到家庭群組" });
    if (g.owner_user_id !== req.user.id) return res.status(403).json({ success: false, error: "只有付款人可加入 Pass" });
    const p = db.prepare("SELECT * FROM user_passes WHERE id=?").get(req.params.passId);
    if (!p) return res.status(404).json({ success: false, error: "找不到 Pass" });
    if (p.user_id !== req.user.id) return res.status(403).json({ success: false, error: "只可加入自己名下 Pass" });
    if (p.status !== "active" || Number(p.remaining_credits) <= 0) {
      return res.status(400).json({ success: false, error: "此 Pass 已用完或已失效" });
    }
    db.prepare("UPDATE user_passes SET family_group_id=?, owner_user_id=?, updated_at=datetime('now') WHERE id=?").run(
      g.id,
      g.owner_user_id,
      p.id,
    );
    try {
      audit({
        actionType: "family.pass_attached",
        entityType: "user_pass",
        entityId: p.id,
        userId: req.user.id,
        newValues: { family_group_id: g.id, remaining_credits: p.remaining_credits },
        description: "Pass 加入家庭共享錢包",
      });
    } catch (e) {}
    res.json({ success: true, data: { group_id: g.id, pass_id: p.id } });
  } catch (e) {
    console.error("[FAMILY] attach pass:", e.message);
    res.status(500).json({ success: false, error: "加入家庭 Pass 失敗" });
  }
});

module.exports = router;

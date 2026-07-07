/**
 * Turso 数据库操作模块（BEpusdt 兼容）
 */

const { createClient } = require("@libsql/client");

const db = createClient({
  url: process.env.TURSO_URL || "libsql://bepusdt-const.aws-ap-northeast-1.turso.io",
  authToken: process.env.TURSO_TOKEN || "TURSO_TOKEN_REDACTED",
});

const crypto = require("crypto");

// ==================== 订单操作 ====================

/**
 * 创建订单
 */
async function createOrder(data) {
  const tradeId = crypto.randomUUID();
  const now = new Date();
  const expiredAt = new Date(now.getTime() + (data.timeout || 600) * 1000);

  await db.execute({
    sql: `INSERT INTO orders (
      trade_id, order_id, amount, actual_amount, token, status,
      notify_url, redirect_url, fiat, trade_type, currency, network,
      name, timeout, rate, reselect, address_exclusive, expired_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      tradeId,
      data.order_id,
      data.amount ? String(data.amount) : null,
      data.actual_amount ? String(data.actual_amount) : null,
      data.token || null,
      data.notify_url,
      data.redirect_url,
      data.fiat || "CNY",
      data.trade_type || "usdt.bep20",
      data.currency || "USDT",
      data.network || "bsc",
      data.name || "",
      data.timeout || 600,
      data.rate || null,
      data.reselect ? 1 : 0,
      data.address_exclusive ? 1 : 0,
      expiredAt.toISOString(),
    ],
  });

  return getOrder(tradeId);
}

/**
 * 获取订单
 */
async function getOrder(tradeId) {
  const result = await db.execute({
    sql: "SELECT * FROM orders WHERE trade_id = ?",
    args: [tradeId],
  });
  return result.rows[0] || null;
}

/**
 * 获取待处理订单（状态 1=等待支付, 5=确认中）
 */
async function getPendingOrders() {
  const result = await db.execute(
    "SELECT * FROM orders WHERE status IN (1, 5) ORDER BY created_at ASC"
  );
  return result.rows;
}

/**
 * 更新订单状态
 */
async function updateOrderStatus(tradeId, status, extra = {}) {
  const sets = ["status = ?"];
  const args = [status];

  if (extra.tx_hash) { sets.push("tx_hash = ?"); args.push(extra.tx_hash); }
  if (extra.block_number !== undefined) { sets.push("block_number = ?"); args.push(extra.block_number); }
  if (extra.actual_amount) { sets.push("actual_amount = ?"); args.push(String(extra.actual_amount)); }
  if (status === 2) { sets.push("confirmed_at = datetime('now')"); }
  if (status === 2 || status === 3) {
    sets.push("next_notify_at = datetime('now')");
    sets.push("notify_status = 0");
  }

  args.push(tradeId);
  await db.execute({
    sql: `UPDATE orders SET ${sets.join(", ")} WHERE trade_id = ?`,
    args,
  });
}

/**
 * 更新订单付款方式
 */
async function updateOrderPayment(tradeId, data) {
  const sets = [];
  const args = [];

  if (data.token) { sets.push("token = ?"); args.push(data.token); }
  if (data.actual_amount) { sets.push("actual_amount = ?"); args.push(String(data.actual_amount)); }
  if (data.trade_type) { sets.push("trade_type = ?"); args.push(data.trade_type); }
  if (data.currency) { sets.push("currency = ?"); args.push(data.currency); }
  if (data.network) { sets.push("network = ?"); args.push(data.network); }

  if (sets.length === 0) return;

  args.push(tradeId);
  await db.execute({
    sql: `UPDATE orders SET ${sets.join(", ")} WHERE trade_id = ?`,
    args,
  });
}

/**
 * 检查 txHash 是否已处理
 */
async function isTxHashProcessed(txHash) {
  const result = await db.execute({
    sql: "SELECT 1 FROM tx_records WHERE tx_hash = ?",
    args: [txHash],
  });
  return result.rows.length > 0;
}

/**
 * 记录交易
 */
async function recordTx(data) {
  await db.execute({
    sql: `INSERT OR IGNORE INTO tx_records (tx_hash, from_address, to_address, amount, block_number, trade_id)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [data.tx_hash, data.from_address, data.to_address, data.amount, data.block_number, data.trade_id || null],
  });
}

/**
 * 获取需要回调的订单
 */
async function getOrdersToNotify() {
  const result = await db.execute(
    "SELECT * FROM orders WHERE status IN (2, 3) AND notify_status = 0 AND notify_count < 10"
  );
  return result.rows;
}

/**
 * 更新回调状态
 */
async function updateNotifyStatus(tradeId, success) {
  if (success) {
    await db.execute({
      sql: "UPDATE orders SET notify_status = 1 WHERE trade_id = ?",
      args: [tradeId],
    });
  } else {
    const order = await getOrder(tradeId);
    const count = (order.notify_count || 0) + 1;
    // 指数退避: 2/4/8/16/32/64 分钟
    const delayMin = Math.pow(2, count);
    const nextTime = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
    await db.execute({
      sql: "UPDATE orders SET notify_status = 0, notify_count = ?, next_notify_at = ? WHERE trade_id = ?",
      args: [count, nextTime, tradeId],
    });
  }
}

// ==================== 钱包操作 ====================

async function getWallets() {
  const result = await db.execute("SELECT * FROM wallets ORDER BY id");
  return result.rows;
}

async function getActiveWallet(tradeType) {
  const result = await db.execute({
    sql: "SELECT * FROM wallets WHERE trade_type = ? AND status = 1 LIMIT 1",
    args: [tradeType],
  });
  return result.rows[0] || null;
}

async function addWallet(data) {
  await db.execute({
    sql: "INSERT INTO wallets (name, trade_type, wallet_address, status) VALUES (?, ?, ?, ?)",
    args: [data.name, data.trade_type, data.wallet_address, data.status !== undefined ? data.status : 1],
  });
}

async function updateWallet(id, data) {
  const sets = [];
  const args = [];
  if (data.name) { sets.push("name = ?"); args.push(data.name); }
  if (data.trade_type) { sets.push("trade_type = ?"); args.push(data.trade_type); }
  if (data.wallet_address) { sets.push("wallet_address = ?"); args.push(data.wallet_address); }
  if (data.status !== undefined) { sets.push("status = ?"); args.push(data.status); }
  if (sets.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE wallets SET ${sets.join(", ")} WHERE id = ?`, args });
}

async function deleteWallet(id) {
  await db.execute({ sql: "DELETE FROM wallets WHERE id = ?", args: [id] });
}

// ==================== 配置操作 ====================

async function getConfig(key) {
  const result = await db.execute({
    sql: "SELECT value FROM config WHERE key = ?",
    args: [key],
  });
  return result.rows[0]?.value || null;
}

async function setConfig(key, value) {
  await db.execute({
    sql: "INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')",
    args: [key, value, value],
  });
}

async function getAllConfig() {
  const result = await db.execute("SELECT key, value FROM config");
  const config = {};
  for (const row of result.rows) {
    config[row.key] = row.value;
  }
  return config;
}

// ==================== 汇率操作 ====================

async function getRate() {
  const result = await db.execute("SELECT value, updated_at FROM config WHERE key = 'usdt_rate'");
  return {
    rate: result.rows[0]?.value || "7.2",
    updatedAt: result.rows[0]?.updated_at || "0",
  };
}

async function setRate(rate) {
  await setConfig("usdt_rate", String(rate));
}

async function getRateUpdatedAt() {
  return await getConfig("rate_updated_at");
}

async function setRateUpdatedAt(timestamp) {
  await setConfig("rate_updated_at", String(timestamp));
}

// ==================== 区块扫描 ====================

async function getLastScannedBlock() {
  const result = await db.execute("SELECT value FROM config WHERE key = 'last_scanned_block'");
  return parseInt(result.rows[0]?.value || "0");
}

async function setLastScannedBlock(block) {
  await setConfig("last_scanned_block", String(block));
}

// ==================== 订单列表（管理后台用） ====================

async function getOrders({ page = 1, pageSize = 10, keyword, tradeType, status, startDate, endDate } = {}) {
  let where = [];
  let args = [];

  if (keyword) {
    where.push("(order_id LIKE ? OR trade_id LIKE ? OR token LIKE ?)");
    args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (tradeType) {
    where.push("trade_type = ?");
    args.push(tradeType);
  }
  if (status !== undefined && status !== "") {
    where.push("status = ?");
    args.push(parseInt(status));
  }
  if (startDate) {
    where.push("created_at >= ?");
    args.push(startDate);
  }
  if (endDate) {
    where.push("created_at <= ?");
    args.push(endDate + " 23:59:59");
  }

  const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as count FROM orders ${whereClause}`,
    args,
  });
  const total = countResult.rows[0].count;

  const offset = (page - 1) * pageSize;
  const dataResult = await db.execute({
    sql: `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    args: [...args, pageSize, offset],
  });

  return { total, page, pageSize, data: dataResult.rows };
}

async function deleteOrder(tradeId) {
  await db.execute({ sql: "DELETE FROM orders WHERE trade_id = ?", args: [tradeId] });
}

async function deleteOrders(tradeIds) {
  for (const id of tradeIds) {
    await db.execute({ sql: "DELETE FROM orders WHERE trade_id = ?", args: [id] });
  }
}

// ==================== 管理员认证 ====================

async function getAdminPassword() {
  return await getConfig("admin_password");
}

async function setAdminPassword(password) {
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  await setConfig("admin_password", hash);
}

async function verifyAdminPassword(password) {
  const stored = await getAdminPassword();
  if (!stored) return false;
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  return stored === hash;
}

async function createAdminSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.execute({
    sql: "INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?",
    args: [`admin_session_${token}`, expiresAt, expiresAt, expiresAt, expiresAt],
  });
  return token;
}

async function verifyAdminSession(token) {
  if (!token) return false;
  const result = await db.execute({
    sql: "SELECT value FROM config WHERE key = ?",
    args: [`admin_session_${token}`],
  });
  if (!result.rows[0]) return false;
  const expiresAt = new Date(result.rows[0].value);
  return expiresAt > new Date();
}

async function deleteAdminSession(token) {
  await db.execute({
    sql: "DELETE FROM config WHERE key = ?",
    args: [`admin_session_${token}`],
  });
}

// ==================== 统计 ====================

async function getDashboardStats() {
  const today = new Date().toISOString().split("T")[0];
  const stats = {};

  const totalResult = await db.execute("SELECT COUNT(*) as count FROM orders");
  stats.totalOrders = totalResult.rows[0].count;

  const todayResult = await db.execute({
    sql: "SELECT COUNT(*) as count FROM orders WHERE date(created_at) = date('now')",
    args: [],
  });
  stats.todayOrders = todayResult.rows[0].count;

  const successResult = await db.execute("SELECT COUNT(*) as count, COALESCE(SUM(actual_amount), 0) as amount FROM orders WHERE status = 2");
  stats.successOrders = successResult.rows[0].count;
  stats.successAmount = successResult.rows[0].amount;

  const pendingResult = await db.execute("SELECT COUNT(*) as count FROM orders WHERE status = 1");
  stats.pendingOrders = pendingResult.rows[0].count;

  const failedResult = await db.execute("SELECT COUNT(*) as count FROM orders WHERE status = 3");
  stats.failedOrders = failedResult.rows[0].count;

  const expiredResult = await db.execute("SELECT COUNT(*) as count FROM orders WHERE status = 4");
  stats.expiredOrders = expiredResult.rows[0].count;

  const confirmResult = await db.execute("SELECT COUNT(*) as count FROM orders WHERE status = 5");
  stats.confirmingOrders = confirmResult.rows[0].count;

  // 按交易类型统计
  const typeResult = await db.execute("SELECT trade_type, COUNT(*) as count FROM orders WHERE status = 2 GROUP BY trade_type");
  stats.byType = typeResult.rows;

  // 最近7天趋势
  const trendResult = await db.execute(`
    SELECT date(created_at) as date, COUNT(*) as total,
           SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as paid,
           SUM(CASE WHEN status = 2 THEN CAST(actual_amount AS REAL) ELSE 0 END) as amount
    FROM orders WHERE created_at >= date('now', '-7 days')
    GROUP BY date(created_at) ORDER BY date ASC
  `);
  stats.trend = trendResult.rows;

  return stats;
}

module.exports = {
  createOrder,
  getOrder,
  getPendingOrders,
  updateOrderStatus,
  updateOrderPayment,
  isTxHashProcessed,
  recordTx,
  getOrdersToNotify,
  updateNotifyStatus,
  getWallets,
  getActiveWallet,
  addWallet,
  updateWallet,
  deleteWallet,
  getConfig,
  setConfig,
  getAllConfig,
  getRate,
  setRate,
  getRateUpdatedAt,
  setRateUpdatedAt,
  getLastScannedBlock,
  setLastScannedBlock,
  getDashboardStats,
  getOrders,
  deleteOrder,
  deleteOrders,
  getAdminPassword,
  setAdminPassword,
  verifyAdminPassword,
  createAdminSession,
  verifyAdminSession,
  deleteAdminSession,
};

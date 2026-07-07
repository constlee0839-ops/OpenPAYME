/**
 * Turso 数据库初始化脚本
 * 创建 BEpusdt 兼容的完整表结构
 */

const { createClient } = require("@libsql/client");

const db = createClient({
  url: "libsql://bepusdt-const.aws-ap-northeast-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODM0MzYwMzAsImlkIjoiMDE5ZjNkMGYtZGQwMS03NzY1LTg2YjEtNDYwZDNkZmZlNmI5Iiwia2lkIjoiNjZ4SllYQnRBSGMxSWVsbTQ2cmpENkh1Z292b2dFdDMxNFZiRmU2Y21NYyIsInJpZCI6Ijk0NGQ4NDcwLTEzMmItNDJhNC05ZmZiLTU0NGZlODM1NTY5NCJ9.OS9v7two881_6OvCqcF7_dB8rxNfSzSwuePu2hhN2N-9Dsmd9loF618up_tB14vswCB6m--SE_It1XvkvFBeAQ",
});

async function setup() {
  console.log("开始创建表结构...");

  // 订单表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS orders (
      trade_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      amount TEXT,
      actual_amount TEXT,
      token TEXT,
      status INTEGER DEFAULT 1,
      tx_hash TEXT,
      block_number INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      confirmed_at TEXT,
      expired_at TEXT,
      notify_url TEXT,
      redirect_url TEXT,
      notify_status INTEGER DEFAULT 0,
      notify_count INTEGER DEFAULT 0,
      next_notify_at TEXT,
      fiat TEXT DEFAULT 'CNY',
      trade_type TEXT,
      currency TEXT,
      network TEXT,
      name TEXT,
      timeout INTEGER DEFAULT 600,
      rate TEXT,
      reselect INTEGER DEFAULT 0,
      address_exclusive INTEGER DEFAULT 0
    )
  `);
  console.log("✅ orders 表");

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_orders_tx_hash ON orders(tx_hash)`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id)`);

  // 钱包表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      trade_type TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      status INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  console.log("✅ wallets 表");

  // 插入默认 BSC 钱包
  await db.execute({
    sql: `INSERT OR IGNORE INTO wallets (id, name, trade_type, wallet_address, status) VALUES (1, ?, ?, ?, 1)`,
    args: ["BSC USDT", "usdt.bep20", "0xe6d587ed23f76feE972dc07c9eb69953d5a48483"],
  });
  console.log("✅ 默认钱包已插入");

  // 配置表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  console.log("✅ config 表");

  // 写入默认配置
  const defaults = {
    api_auth_token: "bepusdt_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
    payment_timeout: "600",
    usdt_rate: "7.2",
    rate_updated_at: "0",
    last_scanned_block: "0",
    payment_expiration: "600",
    notify_retry_count: "10",
    amount_tolerance: "0.000001",
  };

  for (const [key, value] of Object.entries(defaults)) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
      args: [key, value],
    });
  }
  console.log("✅ 默认配置已写入");

  // 交易记录表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tx_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash TEXT UNIQUE,
      from_address TEXT,
      to_address TEXT,
      amount REAL,
      block_number INTEGER,
      trade_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  console.log("✅ tx_records 表");

  // 读取 API Token
  const tokenResult = await db.execute("SELECT value FROM config WHERE key = 'api_auth_token'");
  console.log("\n========================================");
  console.log("数据库初始化完成！");
  console.log("========================================");
  console.log("API Token (保存好，对接商店用):");
  console.log(tokenResult.rows[0].value);
  console.log("========================================\n");

  process.exit(0);
}

setup().catch((err) => {
  console.error("初始化失败:", err);
  process.exit(1);
});

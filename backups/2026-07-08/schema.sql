-- ===== 表 config =====
CREATE TABLE config (
    key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now'))
  );

-- ===== 表 orders =====
CREATE TABLE orders (
    trade_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount TEXT, actual_amount TEXT,
    token TEXT, status INTEGER DEFAULT 1, tx_hash TEXT, block_number INTEGER,
    created_at TEXT DEFAULT (datetime('now')), confirmed_at TEXT, expired_at TEXT,
    notify_url TEXT, redirect_url TEXT, notify_status INTEGER DEFAULT 0,
    notify_count INTEGER DEFAULT 0, next_notify_at TEXT, fiat TEXT DEFAULT 'CNY',
    trade_type TEXT, currency TEXT, network TEXT, name TEXT, timeout INTEGER DEFAULT 600,
    rate TEXT, reselect INTEGER DEFAULT 0, address_exclusive INTEGER DEFAULT 0
  );

-- ===== 表 tx_records =====
CREATE TABLE tx_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tx_hash TEXT UNIQUE,
    from_address TEXT, to_address TEXT, amount REAL,
    block_number INTEGER, trade_id TEXT, created_at TEXT DEFAULT (datetime('now'))
  );

-- ===== 表 wallets =====
CREATE TABLE wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, trade_type TEXT NOT NULL,
    wallet_address TEXT NOT NULL, status INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
  );


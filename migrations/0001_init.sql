-- 咖啡店进销存工作台 · D1 初始化 schema
-- 运行：wrangler d1 execute coffee-erp --local --file=./migrations/0001_init.sql
--       （部署后）wrangler d1 execute coffee-erp --remote --file=./migrations/0001_init.sql

-- 门店
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);

-- 账号（门店店员/店长 + 总部，预设、账号密码登录）
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  store_id TEXT,
  role TEXT NOT NULL,            -- hq / manager / clerk
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,        -- 明文（演示）；生产建议改 bcrypt/HASH
  created_at TEXT
);

-- 物料（原材料）目录，全门店共用
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  min_order REAL NOT NULL DEFAULT 0
);

-- 商品
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- 加料（固定菜单，可加价）
CREATE TABLE IF NOT EXISTS addons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  bom TEXT NOT NULL DEFAULT '[]'  -- JSON: [{mid,qty}]
);

-- 配方 BOM（商品 冷热×杯型 展开，含杯/冰/吸管）
CREATE TABLE IF NOT EXISTS boms (
  pk TEXT NOT NULL,              -- p|hot|M / p|ice|L / a|a1 ...
  material_id TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (pk, material_id)
);

-- 销售流水（按渠道）
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  date TEXT NOT NULL,
  pid TEXT NOT NULL,
  temp TEXT NOT NULL,            -- hot / ice
  size TEXT NOT NULL,            -- M / L
  addons TEXT NOT NULL DEFAULT '[]',
  qty INTEGER NOT NULL DEFAULT 1,
  income REAL NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'other',
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_store_date ON sales(store_id, date);

-- 单据（订货/配货/盘点/退货 共用）
CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- req / alloc / stk / ret
  store_id TEXT NOT NULL,
  status TEXT NOT NULL,
  creator TEXT NOT NULL,
  date TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',  -- JSON 明细
  meta TEXT NOT NULL DEFAULT '{}',    -- JSON 扩展（fromReq / reasons / logs）
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_docs_store ON docs(store_id, type, status);

-- 库存（按门店 × 物料，理论库存）
CREATE TABLE IF NOT EXISTS inventory (
  store_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, material_id)
);

-- 智能推荐订货（按门店 × 周）
CREATE TABLE IF NOT EXISTS recos (
  store_id TEXT NOT NULL,
  week TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (store_id, week)
);

-- 登录会话
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires TEXT NOT NULL
);

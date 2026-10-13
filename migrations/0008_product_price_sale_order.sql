-- 多品销售出库 + 标准售价支持
-- 1) products 增加标准售价 price（总部维护，用于定价基准、外卖实付分摊权重）
ALTER TABLE products ADD COLUMN price REAL NOT NULL DEFAULT 0;

-- 2) sales 增加 order_no（同一笔外卖/订单的多行商品共享，用于整单撤销与查询）
ALTER TABLE sales ADD COLUMN order_no TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_order ON sales(order_no);

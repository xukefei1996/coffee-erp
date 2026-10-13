-- 规格中转站：给物料增加包装规格字段（仅用于订货/库存的显示与输入换算，库存与BOM仍为基础单位）
-- 字段默认留空(NULL)，由总部在物料管理页逐个设置包装换算基数，不预填任何默认值。
ALTER TABLE materials ADD COLUMN pack_qty REAL;
ALTER TABLE materials ADD COLUMN pack_unit TEXT;

-- 留空说明：pack_qty/pack_unit 为 NULL 时，前端按基础单位(ml/g/件)显示与输入，不做换算。

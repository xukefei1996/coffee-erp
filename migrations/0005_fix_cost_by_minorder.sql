-- 修正 0004 的错误假设，改用正确口径重新校准原材料单位成本。
--
-- 【真实口径】materials.price 存的是「整件价」，min_order 是「整件规格」。
--   例：纯牛奶 price=85, min_order=12000ml  -> 一箱12L 卖85元 -> 单位成本 85/12000 = 0.00708 元/ml
--   例：Q3咖啡豆 price=120, min_order=1000g -> 1kg装 120元   -> 单位成本 120/1000  = 0.12    元/g
-- 0004 统一 ÷1000 只对「恰好1000装」的咖啡豆碰巧正确，对 12000ml 装的液体会放大12倍。
--
-- 【例外】杯盖吸管类(热杯0.395/冰盖0.11/热盖0.13/冰杯0.34/细吸管0.08/干橙片0.43)
--   录入的本就是单件价，不能再除。用 price>=1 作为判据：
--   单件价普遍 <1 元，整件价普遍 >=1 元，该判据可完整区分现有31条数据。

-- 第一步：回滚 0004 对 g/ml 的 ÷1000
UPDATE materials SET price = round(price * 1000.0, 4) WHERE unit IN ('g', 'ml');

-- 第二步：整件价 ÷ 整件规格 = 单位成本
UPDATE materials SET price = round(price / min_order, 6) WHERE price >= 1 AND min_order > 0;

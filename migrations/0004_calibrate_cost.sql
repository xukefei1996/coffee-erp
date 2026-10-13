-- 校准原材料单位成本口径：
-- 当前线上 g/ml 类物料的 price 疑似按「元/kg(L)」录入，而单位标的是 g/ml，
-- 导致成本被放大约 1000 倍。这里仅对 g/ml 单位 ÷1000 还原为「元/g、元/ml」，
-- 个/只/片 等单位本就是按件计价，保持不变。
UPDATE materials SET price = round(price / 1000.0, 4) WHERE unit IN ('g', 'ml');

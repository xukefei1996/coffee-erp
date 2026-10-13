-- 咖啡店进销存工作台 · 加料改为咖啡豆品种（在线补丁，幂等可重跑）
-- 仅更新 addons 表与对应 a|<id> 的 BOM 配方，不影响销售/库存/单据。
-- 运行：wrangler d1 execute coffee-erp --remote --file=./migrations/0003_addons_beans.sql

DELETE FROM addons;
DELETE FROM boms WHERE pk LIKE 'a|%';

INSERT INTO addons(id,name,price,bom) VALUES('a1','Q3赛豆',6,'[["m1", 18]]');
INSERT INTO boms(pk,material_id,qty) VALUES('a|a1','m1',18);
INSERT INTO addons(id,name,price,bom) VALUES('a2','Sidamo',6,'[["m1", 18]]');
INSERT INTO boms(pk,material_id,qty) VALUES('a|a2','m1',18);
INSERT INTO addons(id,name,price,bom) VALUES('a3','M3瑰夏',6,'[["m1", 18]]');
INSERT INTO boms(pk,material_id,qty) VALUES('a|a3','m1',18);
INSERT INTO addons(id,name,price,bom) VALUES('a4','C3果丁丁',6,'[["m1", 18]]');
INSERT INTO boms(pk,material_id,qty) VALUES('a|a4','m1',18);
INSERT INTO addons(id,name,price,bom) VALUES('a5','K3肯尼亚',6,'[["m1", 18]]');
INSERT INTO boms(pk,material_id,qty) VALUES('a|a5','m1',18);

// 咖啡店进销存工作台 · 浏览器内后端（零依赖，file:// 双击即可运行）
// 拦截 /api/* 请求，使用 localStorage 持久化的数据层完成全部业务逻辑。
// 前端 app.js 无需任何修改，照常调用 fetch('/api/...')。
(function () {
  'use strict';

  // ---------- 持久化（localStorage，file:// 不可用时退化为内存） ----------
  var LS_KEY = 'coffee_erp_store_v1';
  var MEM = null; // 内存兜底
  function lsGet() { try { return localStorage.getItem(LS_KEY); } catch (e) { return MEM; } }
  function lsSet(v) { try { localStorage.setItem(LS_KEY, v); } catch (e) { MEM = v; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var SEED = {"stores":[{"id":"s1","name":"北京国贸店","active":1,"created_at":"2026-06-01T09:00:00.000Z"},{"id":"s2","name":"上海静安店","active":1,"created_at":"2026-06-01T09:00:00.000Z"},{"id":"s3","name":"广州天河店","active":1,"created_at":"2026-06-01T09:00:00.000Z"},{"id":"s4","name":"深圳南山店","active":1,"created_at":"2026-06-01T09:00:00.000Z"},{"id":"s5","name":"成都春熙店","active":1,"created_at":"2026-06-01T09:00:00.000Z"},{"id":"s6","name":"杭州西湖店","active":1,"created_at":"2026-06-01T09:00:00.000Z"}],"users":[{"id":"mgr_s1","store_id":"s1","role":"manager","name":"北京国贸店·店长","username":"s1mgr","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"clerk_s1","store_id":"s1","role":"clerk","name":"北京国贸店·店员","username":"s1clerk","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"mgr_s2","store_id":"s2","role":"manager","name":"上海静安店·店长","username":"s2mgr","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"clerk_s2","store_id":"s2","role":"clerk","name":"上海静安店·店员","username":"s2clerk","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"mgr_s3","store_id":"s3","role":"manager","name":"广州天河店·店长","username":"s3mgr","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"clerk_s3","store_id":"s3","role":"clerk","name":"广州天河店·店员","username":"s3clerk","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"mgr_s4","store_id":"s4","role":"manager","name":"深圳南山店·店长","username":"s4mgr","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"clerk_s4","store_id":"s4","role":"clerk","name":"深圳南山店·店员","username":"s4clerk","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"mgr_s5","store_id":"s5","role":"manager","name":"成都春熙店·店长","username":"s5mgr","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"clerk_s5","store_id":"s5","role":"clerk","name":"成都春熙店·店员","username":"s5clerk","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"mgr_s6","store_id":"s6","role":"manager","name":"杭州西湖店·店长","username":"s6mgr","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"clerk_s6","store_id":"s6","role":"clerk","name":"杭州西湖店·店员","username":"s6clerk","password":"123456","created_at":"2026-06-01T09:00:00.000Z"},{"id":"hq","store_id":null,"role":"hq","name":"总部管理员","username":"hq","password":"123456","created_at":"2026-06-01T09:00:00.000Z"}],"materials":[{"id":"m1","name":"咖啡豆","unit":"g","price":0.08,"min_order":2000.0},{"id":"m2","name":"牛奶","unit":"ml","price":0.02,"min_order":5000.0},{"id":"m3","name":"燕麦奶","unit":"ml","price":0.04,"min_order":2000.0},{"id":"m4","name":"糖浆","unit":"ml","price":0.01,"min_order":1000.0},{"id":"m5","name":"杯","unit":"个","price":0.3,"min_order":500.0},{"id":"m6","name":"盖","unit":"个","price":0.1,"min_order":500.0},{"id":"m7","name":"吸管","unit":"根","price":0.02,"min_order":500.0},{"id":"m8","name":"可可粉","unit":"g","price":0.15,"min_order":500.0},{"id":"m9","name":"抹茶粉","unit":"g","price":0.2,"min_order":500.0},{"id":"m10","name":"水","unit":"ml","price":0.001,"min_order":10000.0},{"id":"m11","name":"冰块","unit":"g","price":0.001,"min_order":10000.0},{"id":"m12","name":"柠檬","unit":"个","price":0.5,"min_order":100.0}],"products":[{"id":"p1","name":"美式","active":1},{"id":"p2","name":"拿铁","active":1},{"id":"p3","name":"燕麦拿铁","active":1},{"id":"p4","name":"可可","active":1},{"id":"p5","name":"抹茶","active":1}],"addons":[{"id":"a1","name":"加浓","price":9.0,"bom":"[[\"m1\", 9]]"},{"id":"a2","name":"加奶","price":3.0,"bom":"[[\"m2\", 100]]"},{"id":"a3","name":"香草糖浆","price":2.0,"bom":"[[\"m4\", 20]]"},{"id":"a4","name":"加可可","price":2.0,"bom":"[[\"m8\", 5]]"}],"boms":[{"pk":"p1|hot|M","material_id":"m1","qty":18.0},{"pk":"p1|hot|M","material_id":"m10","qty":200.0},{"pk":"p1|hot|L","material_id":"m1","qty":23.4},{"pk":"p1|hot|L","material_id":"m10","qty":260.0},{"pk":"p1|ice|M","material_id":"m1","qty":18.0},{"pk":"p1|ice|M","material_id":"m10","qty":200.0},{"pk":"p1|ice|M","material_id":"m11","qty":150.0},{"pk":"p1|ice|L","material_id":"m1","qty":23.4},{"pk":"p1|ice|L","material_id":"m10","qty":260.0},{"pk":"p1|ice|L","material_id":"m11","qty":150.0},{"pk":"p2|hot|M","material_id":"m1","qty":18.0},{"pk":"p2|hot|M","material_id":"m2","qty":250.0},{"pk":"p2|hot|M","material_id":"m5","qty":1.0},{"pk":"p2|hot|M","material_id":"m6","qty":1.0},{"pk":"p2|hot|M","material_id":"m7","qty":1.0},{"pk":"p2|hot|L","material_id":"m1","qty":23.4},{"pk":"p2|hot|L","material_id":"m2","qty":325.0},{"pk":"p2|hot|L","material_id":"m5","qty":1.3},{"pk":"p2|hot|L","material_id":"m6","qty":1.3},{"pk":"p2|hot|L","material_id":"m7","qty":1.3},{"pk":"p2|ice|M","material_id":"m1","qty":18.0},{"pk":"p2|ice|M","material_id":"m2","qty":250.0},{"pk":"p2|ice|M","material_id":"m5","qty":1.0},{"pk":"p2|ice|M","material_id":"m6","qty":1.0},{"pk":"p2|ice|M","material_id":"m7","qty":1.0},{"pk":"p2|ice|M","material_id":"m11","qty":150.0},{"pk":"p2|ice|L","material_id":"m1","qty":23.4},{"pk":"p2|ice|L","material_id":"m2","qty":325.0},{"pk":"p2|ice|L","material_id":"m5","qty":1.3},{"pk":"p2|ice|L","material_id":"m6","qty":1.3},{"pk":"p2|ice|L","material_id":"m7","qty":1.3},{"pk":"p2|ice|L","material_id":"m11","qty":150.0},{"pk":"p3|hot|M","material_id":"m1","qty":18.0},{"pk":"p3|hot|M","material_id":"m3","qty":250.0},{"pk":"p3|hot|M","material_id":"m5","qty":1.0},{"pk":"p3|hot|M","material_id":"m6","qty":1.0},{"pk":"p3|hot|L","material_id":"m1","qty":23.4},{"pk":"p3|hot|L","material_id":"m3","qty":325.0},{"pk":"p3|hot|L","material_id":"m5","qty":1.3},{"pk":"p3|hot|L","material_id":"m6","qty":1.3},{"pk":"p3|ice|M","material_id":"m1","qty":18.0},{"pk":"p3|ice|M","material_id":"m3","qty":250.0},{"pk":"p3|ice|M","material_id":"m5","qty":1.0},{"pk":"p3|ice|M","material_id":"m6","qty":1.0},{"pk":"p3|ice|M","material_id":"m11","qty":150.0},{"pk":"p3|ice|L","material_id":"m1","qty":23.4},{"pk":"p3|ice|L","material_id":"m3","qty":325.0},{"pk":"p3|ice|L","material_id":"m5","qty":1.3},{"pk":"p3|ice|L","material_id":"m6","qty":1.3},{"pk":"p3|ice|L","material_id":"m11","qty":150.0},{"pk":"p4|hot|M","material_id":"m2","qty":300.0},{"pk":"p4|hot|M","material_id":"m8","qty":15.0},{"pk":"p4|hot|M","material_id":"m5","qty":1.0},{"pk":"p4|hot|M","material_id":"m6","qty":1.0},{"pk":"p4|hot|M","material_id":"m7","qty":1.0},{"pk":"p4|hot|L","material_id":"m2","qty":390.0},{"pk":"p4|hot|L","material_id":"m8","qty":19.5},{"pk":"p4|hot|L","material_id":"m5","qty":1.3},{"pk":"p4|hot|L","material_id":"m6","qty":1.3},{"pk":"p4|hot|L","material_id":"m7","qty":1.3},{"pk":"p4|ice|M","material_id":"m2","qty":300.0},{"pk":"p4|ice|M","material_id":"m8","qty":15.0},{"pk":"p4|ice|M","material_id":"m5","qty":1.0},{"pk":"p4|ice|M","material_id":"m6","qty":1.0},{"pk":"p4|ice|M","material_id":"m7","qty":1.0},{"pk":"p4|ice|M","material_id":"m11","qty":150.0},{"pk":"p4|ice|L","material_id":"m2","qty":390.0},{"pk":"p4|ice|L","material_id":"m8","qty":19.5},{"pk":"p4|ice|L","material_id":"m5","qty":1.3},{"pk":"p4|ice|L","material_id":"m6","qty":1.3},{"pk":"p4|ice|L","material_id":"m7","qty":1.3},{"pk":"p4|ice|L","material_id":"m11","qty":150.0},{"pk":"p5|hot|M","material_id":"m9","qty":12.0},{"pk":"p5|hot|M","material_id":"m2","qty":250.0},{"pk":"p5|hot|M","material_id":"m5","qty":1.0},{"pk":"p5|hot|M","material_id":"m6","qty":1.0},{"pk":"p5|hot|L","material_id":"m9","qty":15.6},{"pk":"p5|hot|L","material_id":"m2","qty":325.0},{"pk":"p5|hot|L","material_id":"m5","qty":1.3},{"pk":"p5|hot|L","material_id":"m6","qty":1.3},{"pk":"p5|ice|M","material_id":"m9","qty":12.0},{"pk":"p5|ice|M","material_id":"m2","qty":250.0},{"pk":"p5|ice|M","material_id":"m5","qty":1.0},{"pk":"p5|ice|M","material_id":"m6","qty":1.0},{"pk":"p5|ice|M","material_id":"m11","qty":150.0},{"pk":"p5|ice|L","material_id":"m9","qty":15.6},{"pk":"p5|ice|L","material_id":"m2","qty":325.0},{"pk":"p5|ice|L","material_id":"m5","qty":1.3},{"pk":"p5|ice|L","material_id":"m6","qty":1.3},{"pk":"p5|ice|L","material_id":"m11","qty":150.0},{"pk":"a|a1","material_id":"m1","qty":9.0},{"pk":"a|a2","material_id":"m2","qty":100.0},{"pk":"a|a3","material_id":"m4","qty":20.0},{"pk":"a|a4","material_id":"m8","qty":5.0}],"sales":[{"id":"sale_seed_1","store_id":"s1","date":"2026-07-28","pid":"p4","temp":"ice","size":"M","addons":"[]","qty":2,"income":52.87,"channel":"miniapp","created_at":"2026-07-28T10:24:00.000Z"},{"id":"sale_seed_2","store_id":"s1","date":"2026-07-28","pid":"p1","temp":"hot","size":"L","addons":"[\"a2\"]","qty":3,"income":92.25,"channel":"jd","created_at":"2026-07-28T13:18:00.000Z"},{"id":"sale_seed_3","store_id":"s1","date":"2026-07-27","pid":"p2","temp":"hot","size":"M","addons":"[\"a2\"]","qty":3,"income":67.12,"channel":"taobao","created_at":"2026-07-27T15:37:00.000Z"},{"id":"sale_seed_4","store_id":"s1","date":"2026-07-27","pid":"p4","temp":"hot","size":"L","addons":"[]","qty":1,"income":28.84,"channel":"taobao","created_at":"2026-07-27T19:40:00.000Z"},{"id":"sale_seed_5","store_id":"s1","date":"2026-07-27","pid":"p4","temp":"hot","size":"M","addons":"[]","qty":1,"income":25.98,"channel":"other","created_at":"2026-07-27T12:32:00.000Z"},{"id":"sale_seed_6","store_id":"s1","date":"2026-07-26","pid":"p4","temp":"ice","size":"L","addons":"[\"a4\"]","qty":2,"income":62.9,"channel":"meituan","created_at":"2026-07-26T19:36:00.000Z"},{"id":"sale_seed_7","store_id":"s1","date":"2026-07-26","pid":"p3","temp":"hot","size":"M","addons":"[]","qty":1,"income":22.26,"channel":"jd","created_at":"2026-07-26T12:26:00.000Z"},{"id":"sale_seed_8","store_id":"s1","date":"2026-07-26","pid":"p2","temp":"hot","size":"M","addons":"[]","qty":1,"income":18.32,"channel":"taobao","created_at":"2026-07-26T13:12:00.000Z"},{"id":"sale_seed_9","store_id":"s1","date":"2026-07-25","pid":"p3","temp":"hot","size":"M","addons":"[]","qty":2,"income":45.17,"channel":"jd","created_at":"2026-07-25T21:53:00.000Z"},{"id":"sale_seed_10","store_id":"s1","date":"2026-07-25","pid":"p2","temp":"hot","size":"M","addons":"[\"a4\"]","qty":2,"income":40.66,"channel":"cmb","created_at":"2026-07-25T16:25:00.000Z"},{"id":"sale_seed_11","store_id":"s1","date":"2026-07-25","pid":"p2","temp":"ice","size":"M","addons":"[]","qty":3,"income":55.21,"channel":"group","created_at":"2026-07-25T18:19:00.000Z"},{"id":"sale_seed_12","store_id":"s1","date":"2026-07-25","pid":"p4","temp":"hot","size":"L","addons":"[\"a2\", \"a3\"]","qty":1,"income":34.66,"channel":"cmb","created_at":"2026-07-25T11:37:00.000Z"},{"id":"sale_seed_13","store_id":"s1","date":"2026-07-24","pid":"p2","temp":"ice","size":"L","addons":"[\"a1\"]","qty":3,"income":92.87,"channel":"meituan","created_at":"2026-07-24T12:58:00.000Z"},{"id":"sale_seed_14","store_id":"s1","date":"2026-07-24","pid":"p4","temp":"ice","size":"M","addons":"[\"a3\"]","qty":2,"income":56.44,"channel":"meituan","created_at":"2026-07-24T16:33:00.000Z"},{"id":"sale_seed_15","store_id":"s1","date":"2026-07-24","pid":"p3","temp":"ice","size":"L","addons":"[]","qty":3,"income":75.01,"channel":"other","created_at":"2026-07-24T21:24:00.000Z"},{"id":"sale_seed_16","store_id":"s1","date":"2026-07-24","pid":"p3","temp":"hot","size":"L","addons":"[\"a4\"]","qty":3,"income":81.07,"channel":"cmb","created_at":"2026-07-24T12:38:00.000Z"},{"id":"sale_seed_17","store_id":"s1","date":"2026-07-23","pid":"p1","temp":"hot","size":"M","addons":"[]","qty":3,"income":71.34,"channel":"cmb","created_at":"2026-07-23T14:44:00.000Z"},{"id":"sale_seed_18","store_id":"s1","date":"2026-07-23","pid":"p4","temp":"hot","size":"M","addons":"[\"a1\"]","qty":3,"income":104.26,"channel":"group","created_at":"2026-07-23T18:36:00.000Z"},{"id":"sale_seed_19","store_id":"s1","date":"2026-07-23","pid":"p4","temp":"hot","size":"L","addons":"[]","qty":2,"income":57.33,"channel":"group","created_at":"2026-07-23T09:16:00.000Z"},{"id":"sale_seed_20","store_id":"s1","date":"2026-07-23","pid":"p5","temp":"ice","size":"L","addons":"[]","qty":3,"income":95.99,"channel":"taobao","created_at":"2026-07-23T19:10:00.000Z"},{"id":"sale_seed_21","store_id":"s1","date":"2026-07-22","pid":"p4","temp":"hot","size":"L","addons":"[]","qty":2,"income":59.97,"channel":"group","created_at":"2026-07-22T18:37:00.000Z"},{"id":"sale_seed_22","store_id":"s1","date":"2026-07-22","pid":"p2","temp":"ice","size":"L","addons":"[\"a3\"]","qty":3,"income":69.8,"channel":"group","created_at":"2026-07-22T17:57:00.000Z"},{"id":"sale_seed_23","store_id":"s1","date":"2026-07-22","pid":"p5","temp":"hot","size":"L","addons":"[]","qty":2,"income":60.9,"channel":"cash","created_at":"2026-07-22T21:54:00.000Z"},{"id":"sale_seed_24","store_id":"s1","date":"2026-07-21","pid":"p4","temp":"ice","size":"L","addons":"[\"a3\", \"a4\"]","qty":1,"income":32.71,"channel":"taobao","created_at":"2026-07-21T21:09:00.000Z"},{"id":"sale_seed_25","store_id":"s1","date":"2026-07-21","pid":"p1","temp":"ice","size":"M","addons":"[]","qty":1,"income":24.55,"channel":"taobao","created_at":"2026-07-21T09:21:00.000Z"},{"id":"sale_seed_26","store_id":"s1","date":"2026-07-21","pid":"p2","temp":"ice","size":"L","addons":"[]","qty":3,"income":66.83,"channel":"cash","created_at":"2026-07-21T10:51:00.000Z"},{"id":"sale_seed_27","store_id":"s1","date":"2026-07-21","pid":"p2","temp":"hot","size":"L","addons":"[\"a4\"]","qty":1,"income":24.34,"channel":"cmb","created_at":"2026-07-21T18:32:00.000Z"},{"id":"sale_seed_28","store_id":"s1","date":"2026-07-20","pid":"p2","temp":"ice","size":"M","addons":"[\"a1\", \"a3\"]","qty":3,"income":84.61,"channel":"cmb","created_at":"2026-07-20T19:29:00.000Z"},{"id":"sale_seed_29","store_id":"s1","date":"2026-07-20","pid":"p5","temp":"ice","size":"M","addons":"[\"a1\"]","qty":2,"income":72.05,"channel":"cmb","created_at":"2026-07-20T20:08:00.000Z"},{"id":"sale_seed_30","store_id":"s1","date":"2026-07-20","pid":"p3","temp":"ice","size":"L","addons":"[]","qty":3,"income":76.61,"channel":"jd","created_at":"2026-07-20T19:33:00.000Z"},{"id":"sale_seed_31","store_id":"s1","date":"2026-07-19","pid":"p4","temp":"ice","size":"L","addons":"[]","qty":2,"income":60.76,"channel":"cash","created_at":"2026-07-19T10:14:00.000Z"},{"id":"sale_seed_32","store_id":"s1","date":"2026-07-19","pid":"p1","temp":"ice","size":"M","addons":"[]","qty":2,"income":48.78,"channel":"miniapp","created_at":"2026-07-19T21:58:00.000Z"},{"id":"sale_seed_33","store_id":"s1","date":"2026-07-19","pid":"p3","temp":"ice","size":"L","addons":"[]","qty":3,"income":80.73,"channel":"group","created_at":"2026-07-19T13:06:00.000Z"},{"id":"sale_seed_34","store_id":"s1","date":"2026-07-19","pid":"p4","temp":"ice","size":"L","addons":"[\"a2\", \"a4\"]","qty":3,"income":101.65,"channel":"other","created_at":"2026-07-19T18:38:00.000Z"},{"id":"sale_seed_35","store_id":"s1","date":"2026-07-18","pid":"p1","temp":"hot","size":"M","addons":"[\"a2\"]","qty":3,"income":80.19,"channel":"miniapp","created_at":"2026-07-18T17:54:00.000Z"},{"id":"sale_seed_36","store_id":"s1","date":"2026-07-18","pid":"p2","temp":"hot","size":"L","addons":"[]","qty":3,"income":67.91,"channel":"meituan","created_at":"2026-07-18T19:49:00.000Z"},{"id":"sale_seed_37","store_id":"s1","date":"2026-07-17","pid":"p5","temp":"ice","size":"L","addons":"[\"a4\"]","qty":1,"income":33.16,"channel":"jd","created_at":"2026-07-17T13:06:00.000Z"},{"id":"sale_seed_38","store_id":"s1","date":"2026-07-17","pid":"p5","temp":"hot","size":"M","addons":"[\"a1\", \"a3\", \"a4\"]","qty":1,"income":38.27,"channel":"taobao","created_at":"2026-07-17T11:50:00.000Z"},{"id":"sale_seed_39","store_id":"s1","date":"2026-07-17","pid":"p4","temp":"ice","size":"M","addons":"[\"a2\"]","qty":1,"income":29.53,"channel":"cash","created_at":"2026-07-17T21:15:00.000Z"},{"id":"sale_seed_40","store_id":"s2","date":"2026-07-28","pid":"p4","temp":"hot","size":"M","addons":"[\"a1\", \"a4\"]","qty":1,"income":36.53,"channel":"other","created_at":"2026-07-28T15:46:00.000Z"},{"id":"sale_seed_41","store_id":"s2","date":"2026-07-28","pid":"p2","temp":"ice","size":"M","addons":"[]","qty":1,"income":18.09,"channel":"meituan","created_at":"2026-07-28T17:45:00.000Z"},{"id":"sale_seed_42","store_id":"s2","date":"2026-07-28","pid":"p3","temp":"hot","size":"M","addons":"[\"a2\"]","qty":3,"income":77.02,"channel":"taobao","created_at":"2026-07-28T19:52:00.000Z"},{"id":"sale_seed_43","store_id":"s2","date":"2026-07-28","pid":"p5","temp":"hot","size":"L","addons":"[\"a2\"]","qty":3,"income":103.46,"channel":"cmb","created_at":"2026-07-28T12:26:00.000Z"},{"id":"sale_seed_44","store_id":"s2","date":"2026-07-27","pid":"p3","temp":"hot","size":"M","addons":"[]","qty":3,"income":68.79,"channel":"jd","created_at":"2026-07-27T18:29:00.000Z"},{"id":"sale_seed_45","store_id":"s2","date":"2026-07-27","pid":"p5","temp":"hot","size":"M","addons":"[\"a1\"]","qty":1,"income":36.1,"channel":"group","created_at":"2026-07-27T19:20:00.000Z"},{"id":"sale_seed_46","store_id":"s2","date":"2026-07-27","pid":"p5","temp":"ice","size":"L","addons":"[\"a1\"]","qty":1,"income":38.36,"channel":"jd","created_at":"2026-07-27T13:50:00.000Z"},{"id":"sale_seed_47","store_id":"s2","date":"2026-07-26","pid":"p1","temp":"ice","size":"M","addons":"[\"a4\"]","qty":2,"income":53.27,"channel":"cmb","created_at":"2026-07-26T17:29:00.000Z"},{"id":"sale_seed_48","store_id":"s2","date":"2026-07-26","pid":"p2","temp":"ice","size":"M","addons":"[\"a3\"]","qty":2,"income":40.67,"channel":"miniapp","created_at":"2026-07-26T09:01:00.000Z"},{"id":"sale_seed_49","store_id":"s2","date":"2026-07-26","pid":"p1","temp":"ice","size":"M","addons":"[]","qty":2,"income":47.58,"channel":"meituan","created_at":"2026-07-26T17:22:00.000Z"},{"id":"sale_seed_50","store_id":"s2","date":"2026-07-25","pid":"p2","temp":"hot","size":"L","addons":"[]","qty":2,"income":43.74,"channel":"jd","created_at":"2026-07-25T19:38:00.000Z"},{"id":"sale_seed_51","store_id":"s2","date":"2026-07-25","pid":"p1","temp":"ice","size":"M","addons":"[]","qty":2,"income":46.82,"channel":"meituan","created_at":"2026-07-25T21:11:00.000Z"},{"id":"sale_seed_52","store_id":"s2","date":"2026-07-24","pid":"p3","temp":"hot","size":"L","addons":"[\"a2\"]","qty":3,"income":85.17,"channel":"cash","created_at":"2026-07-24T20:48:00.000Z"},{"id":"sale_seed_53","store_id":"s2","date":"2026-07-24","pid":"p5","temp":"ice","size":"L","addons":"[]","qty":1,"income":31.34,"channel":"group","created_at":"2026-07-24T13:04:00.000Z"},{"id":"sale_seed_54","store_id":"s2","date":"2026-07-24","pid":"p2","temp":"ice","size":"M","addons":"[\"a4\"]","qty":1,"income":20.62,"channel":"other","created_at":"2026-07-24T12:46:00.000Z"},{"id":"sale_seed_55","store_id":"s2","date":"2026-07-24","pid":"p2","temp":"ice","size":"M","addons":"[\"a1\", \"a4\"]","qty":3,"income":82.54,"channel":"cmb","created_at":"2026-07-24T19:04:00.000Z"},{"id":"sale_seed_56","store_id":"s2","date":"2026-07-23","pid":"p5","temp":"hot","size":"L","addons":"[\"a4\"]","qty":3,"income":93.67,"channel":"cash","created_at":"2026-07-23T17:44:00.000Z"},{"id":"sale_seed_57","store_id":"s2","date":"2026-07-23","pid":"p5","temp":"hot","size":"L","addons":"[]","qty":1,"income":32.27,"channel":"cmb","created_at":"2026-07-23T16:03:00.000Z"},{"id":"sale_seed_58","store_id":"s2","date":"2026-07-23","pid":"p1","temp":"hot","size":"L","addons":"[]","qty":3,"income":85.23,"channel":"other","created_at":"2026-07-23T09:13:00.000Z"},{"id":"sale_seed_59","store_id":"s2","date":"2026-07-23","pid":"p1","temp":"hot","size":"M","addons":"[\"a3\"]","qty":1,"income":25.88,"channel":"jd","created_at":"2026-07-23T09:33:00.000Z"},{"id":"sale_seed_60","store_id":"s2","date":"2026-07-22","pid":"p5","temp":"ice","size":"M","addons":"[\"a1\", \"a2\"]","qty":2,"income":75.64,"channel":"cmb","created_at":"2026-07-22T20:20:00.000Z"},{"id":"sale_seed_61","store_id":"s2","date":"2026-07-22","pid":"p3","temp":"ice","size":"M","addons":"[]","qty":1,"income":22.23,"channel":"group","created_at":"2026-07-22T14:28:00.000Z"},{"id":"sale_seed_62","store_id":"s2","date":"2026-07-21","pid":"p5","temp":"hot","size":"L","addons":"[]","qty":3,"income":94.35,"channel":"jd","created_at":"2026-07-21T14:51:00.000Z"},{"id":"sale_seed_63","store_id":"s2","date":"2026-07-21","pid":"p5","temp":"ice","size":"M","addons":"[\"a1\", \"a4\"]","qty":3,"income":112.61,"channel":"meituan","created_at":"2026-07-21T11:10:00.000Z"},{"id":"sale_seed_64","store_id":"s2","date":"2026-07-21","pid":"p4","temp":"hot","size":"L","addons":"[]","qty":2,"income":57.21,"channel":"group","created_at":"2026-07-21T21:23:00.000Z"},{"id":"sale_seed_65","store_id":"s2","date":"2026-07-21","pid":"p4","temp":"ice","size":"L","addons":"[\"a4\"]","qty":2,"income":63.4,"channel":"jd","created_at":"2026-07-21T13:08:00.000Z"},{"id":"sale_seed_66","store_id":"s2","date":"2026-07-20","pid":"p5","temp":"ice","size":"M","addons":"[\"a2\"]","qty":3,"income":90.73,"channel":"meituan","created_at":"2026-07-20T11:15:00.000Z"},{"id":"sale_seed_67","store_id":"s2","date":"2026-07-20","pid":"p5","temp":"hot","size":"M","addons":"[\"a4\"]","qty":1,"income":30.15,"channel":"cash","created_at":"2026-07-20T09:04:00.000Z"},{"id":"sale_seed_68","store_id":"s2","date":"2026-07-19","pid":"p2","temp":"hot","size":"L","addons":"[\"a3\"]","qty":3,"income":73.2,"channel":"taobao","created_at":"2026-07-19T14:31:00.000Z"},{"id":"sale_seed_69","store_id":"s2","date":"2026-07-19","pid":"p4","temp":"ice","size":"L","addons":"[]","qty":3,"income":89.14,"channel":"group","created_at":"2026-07-19T18:02:00.000Z"},{"id":"sale_seed_70","store_id":"s2","date":"2026-07-18","pid":"p2","temp":"hot","size":"M","addons":"[\"a1\"]","qty":1,"income":27.86,"channel":"meituan","created_at":"2026-07-18T17:22:00.000Z"},{"id":"sale_seed_71","store_id":"s2","date":"2026-07-18","pid":"p5","temp":"hot","size":"L","addons":"[\"a4\"]","qty":1,"income":33.09,"channel":"miniapp","created_at":"2026-07-18T11:26:00.000Z"},{"id":"sale_seed_72","store_id":"s2","date":"2026-07-17","pid":"p4","temp":"hot","size":"L","addons":"[]","qty":2,"income":58.64,"channel":"meituan","created_at":"2026-07-17T10:08:00.000Z"},{"id":"sale_seed_73","store_id":"s2","date":"2026-07-17","pid":"p2","temp":"ice","size":"L","addons":"[\"a4\"]","qty":1,"income":23.21,"channel":"taobao","created_at":"2026-07-17T18:53:00.000Z"},{"id":"sale_seed_74","store_id":"s2","date":"2026-07-17","pid":"p5","temp":"hot","size":"L","addons":"[\"a2\"]","qty":1,"income":33.49,"channel":"taobao","created_at":"2026-07-17T16:39:00.000Z"},{"id":"sale_seed_75","store_id":"s3","date":"2026-07-28","pid":"p2","temp":"ice","size":"M","addons":"[]","qty":1,"income":19.4,"channel":"other","created_at":"2026-07-28T09:05:00.000Z"},{"id":"sale_seed_76","store_id":"s3","date":"2026-07-28","pid":"p5","temp":"ice","size":"L","addons":"[]","qty":1,"income":32.12,"channel":"taobao","created_at":"2026-07-28T16:53:00.000Z"},{"id":"sale_seed_77","store_id":"s3","date":"2026-07-28","pid":"p3","temp":"hot","size":"M","addons":"[\"a3\", \"a4\"]","qty":2,"income":49.33,"channel":"other","created_at":"2026-07-28T10:58:00.000Z"},{"id":"sale_seed_78","store_id":"s3","date":"2026-07-27","pid":"p4","temp":"ice","size":"L","addons":"[\"a4\"]","qty":2,"income":61.66,"channel":"meituan","created_at":"2026-07-27T19:31:00.000Z"},{"id":"sale_seed_79","store_id":"s3","date":"2026-07-27","pid":"p5","temp":"hot","size":"L","addons":"[\"a1\", \"a3\", \"a4\"]","qty":2,"income":82.68,"channel":"cash","created_at":"2026-07-27T11:42:00.000Z"},{"id":"sale_seed_80","store_id":"s3","date":"2026-07-26","pid":"p3","temp":"hot","size":"M","addons":"[\"a1\"]","qty":1,"income":29.7,"channel":"taobao","created_at":"2026-07-26T09:55:00.000Z"},{"id":"sale_seed_81","store_id":"s3","date":"2026-07-26","pid":"p4","temp":"hot","size":"M","addons":"[\"a2\", \"a3\", \"a4\"]","qty":3,"income":98.96,"channel":"jd","created_at":"2026-07-26T14:42:00.000Z"},{"id":"sale_seed_82","store_id":"s3","date":"2026-07-25","pid":"p1","temp":"ice","size":"M","addons":"[\"a2\"]","qty":2,"income":50.97,"channel":"jd","created_at":"2026-07-25T12:09:00.000Z"},{"id":"sale_seed_83","store_id":"s3","date":"2026-07-25","pid":"p2","temp":"ice","size":"M","addons":"[\"a1\", \"a4\"]","qty":2,"income":55.33,"channel":"jd","created_at":"2026-07-25T11:36:00.000Z"},{"id":"sale_seed_84","store_id":"s3","date":"2026-07-24","pid":"p2","temp":"hot","size":"M","addons":"[\"a3\"]","qty":1,"income":20.93,"channel":"cmb","created_at":"2026-07-24T13:01:00.000Z"},{"id":"sale_seed_85","store_id":"s3","date":"2026-07-24","pid":"p1","temp":"hot","size":"M","addons":"[\"a1\", \"a4\"]","qty":2,"income":65.89,"channel":"meituan","created_at":"2026-07-24T17:57:00.000Z"},{"id":"sale_seed_86","store_id":"s3","date":"2026-07-24","pid":"p2","temp":"hot","size":"L","addons":"[\"a4\"]","qty":1,"income":24.01,"channel":"miniapp","created_at":"2026-07-24T10:42:00.000Z"},{"id":"sale_seed_87","store_id":"s3","date":"2026-07-24","pid":"p3","temp":"ice","size":"M","addons":"[]","qty":1,"income":22.24,"channel":"miniapp","created_at":"2026-07-24T15:15:00.000Z"},{"id":"sale_seed_88","store_id":"s3","date":"2026-07-23","pid":"p3","temp":"hot","size":"L","addons":"[]","qty":2,"income":51.25,"channel":"group","created_at":"2026-07-23T09:26:00.000Z"},{"id":"sale_seed_89","store_id":"s3","date":"2026-07-23","pid":"p3","temp":"ice","size":"L","addons":"[]","qty":2,"income":50.52,"channel":"cash","created_at":"2026-07-23T17:16:00.000Z"},{"id":"sale_seed_90","store_id":"s3","date":"2026-07-23","pid":"p1","temp":"hot","size":"L","addons":"[]","qty":3,"income":81.28,"channel":"meituan","created_at":"2026-07-23T18:48:00.000Z"},{"id":"sale_seed_91","store_id":"s3","date":"2026-07-23","pid":"p4","temp":"ice","size":"M","addons":"[\"a2\"]","qty":2,"income":54.31,"channel":"cash","created_at":"2026-07-23T13:19:00.000Z"},{"id":"sale_seed_92","store_id":"s3","date":"2026-07-22","pid":"p5","temp":"hot","size":"M","addons":"[\"a4\"]","qty":1,"income":29.4,"channel":"cmb","created_at":"2026-07-22T19:07:00.000Z"},{"id":"sale_seed_93","store_id":"s3","date":"2026-07-22","pid":"p4","temp":"hot","size":"L","addons":"[]","qty":1,"income":29.58,"channel":"jd","created_at":"2026-07-22T17:06:00.000Z"},{"id":"sale_seed_94","store_id":"s3","date":"2026-07-21","pid":"p4","temp":"hot","size":"M","addons":"[]","qty":2,"income":49.65,"channel":"taobao","created_at":"2026-07-21T13:24:00.000Z"},{"id":"sale_seed_95","store_id":"s3","date":"2026-07-21","pid":"p1","temp":"hot","size":"L","addons":"[\"a1\"]","qty":1,"income":35.63,"channel":"other","created_at":"2026-07-21T16:45:00.000Z"},{"id":"sale_seed_96","store_id":"s3","date":"2026-07-20","pid":"p2","temp":"ice","size":"L","addons":"[]","qty":3,"income":65.86,"channel":"cash","created_at":"2026-07-20T10:42:00.000Z"},{"id":"sale_seed_97","store_id":"s3","date":"2026-07-20","pid":"p3","temp":"ice","size":"M","addons":"[\"a3\"]","qty":1,"income":23.45,"channel":"other","created_at":"2026-07-20T10:04:00.000Z"},{"id":"sale_seed_98","store_id":"s3","date":"2026-07-19","pid":"p5","temp":"ice","size":"M","addons":"[]","qty":1,"income":27.52,"channel":"miniapp","created_at":"2026-07-19T16:13:00.000Z"},{"id":"sale_seed_99","store_id":"s3","date":"2026-07-19","pid":"p3","temp":"hot","size":"M","addons":"[\"a1\", \"a3\"]","qty":3,"income":92.18,"channel":"miniapp","created_at":"2026-07-19T16:59:00.000Z"},{"id":"sale_seed_100","store_id":"s3","date":"2026-07-19","pid":"p2","temp":"hot","size":"M","addons":"[]","qty":2,"income":36.14,"channel":"meituan","created_at":"2026-07-19T14:33:00.000Z"},{"id":"sale_seed_101","store_id":"s3","date":"2026-07-18","pid":"p4","temp":"ice","size":"L","addons":"[\"a2\"]","qty":2,"income":62.0,"channel":"taobao","created_at":"2026-07-18T16:40:00.000Z"},{"id":"sale_seed_102","store_id":"s3","date":"2026-07-18","pid":"p1","temp":"ice","size":"L","addons":"[]","qty":3,"income":86.28,"channel":"other","created_at":"2026-07-18T19:48:00.000Z"},{"id":"sale_seed_103","store_id":"s3","date":"2026-07-18","pid":"p2","temp":"hot","size":"M","addons":"[]","qty":2,"income":38.32,"channel":"meituan","created_at":"2026-07-18T21:13:00.000Z"},{"id":"sale_seed_104","store_id":"s3","date":"2026-07-18","pid":"p1","temp":"ice","size":"M","addons":"[\"a2\", \"a3\"]","qty":3,"income":84.91,"channel":"group","created_at":"2026-07-18T10:19:00.000Z"},{"id":"sale_seed_105","store_id":"s3","date":"2026-07-17","pid":"p2","temp":"ice","size":"L","addons":"[]","qty":3,"income":69.03,"channel":"group","created_at":"2026-07-17T09:26:00.000Z"},{"id":"sale_seed_106","store_id":"s3","date":"2026-07-17","pid":"p2","temp":"ice","size":"L","addons":"[\"a3\", \"a4\"]","qty":3,"income":77.58,"channel":"meituan","created_at":"2026-07-17T21:55:00.000Z"},{"id":"sale_seed_107","store_id":"s3","date":"2026-07-17","pid":"p3","temp":"ice","size":"L","addons":"[\"a2\"]","qty":1,"income":28.16,"channel":"meituan","created_at":"2026-07-17T16:20:00.000Z"},{"id":"sale_seed_108","store_id":"s3","date":"2026-07-17","pid":"p1","temp":"ice","size":"M","addons":"[\"a1\", \"a2\"]","qty":1,"income":35.68,"channel":"other","created_at":"2026-07-17T11:16:00.000Z"},{"id":"sale_seed_109","store_id":"s4","date":"2026-07-28","pid":"p1","temp":"hot","size":"M","addons":"[\"a1\", \"a3\"]","qty":1,"income":35.01,"channel":"meituan","created_at":"2026-07-28T21:03:00.000Z"},{"id":"sale_seed_110","store_id":"s4","date":"2026-07-28","pid":"p2","temp":"ice","size":"L","addons":"[\"a4\"]","qty":3,"income":74.93,"channel":"other","created_at":"2026-07-28T18:17:00.000Z"},{"id":"sale_seed_111","store_id":"s4","date":"2026-07-28","pid":"p1","temp":"ice","size":"L","addons":"[\"a1\"]","qty":1,"income":35.29,"channel":"cmb","created_at":"2026-07-28T14:18:00.000Z"},{"id":"sale_seed_112","store_id":"s4","date":"2026-07-28","pid":"p2","temp":"ice","size":"L","addons":"[]","qty":1,"income":22.94,"channel":"cash","created_at":"2026-07-28T12:07:00.000Z"},{"id":"sale_seed_113","store_id":"s4","date":"2026-07-27","pid":"p2","temp":"ice","size":"M","addons":"[\"a1\"]","qty":3,"income":81.71,"channel":"cmb","created_at":"2026-07-27T17:18:00.000Z"},{"id":"sale_seed_114","store_id":"s4","date":"2026-07-27","pid":"p3","temp":"hot","size":"M","addons":"[\"a1\", \"a4\"]","qty":1,"income":31.71,"channel":"meituan","created_at":"2026-07-27T10:06:00.000Z"},{"id":"sale_seed_115","store_id":"s4","date":"2026-07-26","pid":"p3","temp":"ice","size":"M","addons":"[]","qty":1,"income":23.26,"channel":"group","created_at":"2026-07-26T18:58:00.000Z"},{"id":"sale_seed_116","store_id":"s4","date":"2026-07-26","pid":"p5","temp":"ice","size":"L","addons":"[]","qty":3,"income":89.54,"channel":"taobao","created_at":"2026-07-26T13:41:00.000Z"},{"id":"sale_seed_117","store_id":"s4","date":"2026-07-26","pid":"p1","temp":"ice","size":"L","addons":"[]","qty":2,"income":56.07,"channel":"cmb","created_at":"2026-07-26T17:49:00.000Z"},{"id":"sale_seed_118","store_id":"s4","date":"2026-07-26","pid":"p3","temp":"hot","size":"M","addons":"[]","qty":1,"income":22.06,"channel":"miniapp","created_at":"2026-07-26T15:55:00.000Z"},{"id":"sale_seed_119","store_id":"s4","date":"2026-07-25","pid":"p1","temp":"ice","size":"L","addons":"[\"a3\", \"a4\"]","qty":3,"income":96.2,"channel":"meituan","created_at":"2026-07-25T14:40:00.000Z"},{"id":"sale_seed_120","store_id":"s4","date":"2026-07-25","pid":"p5","temp":"ice","size":"M","addons":"[\"a1\", \"a4\"]","qty":3,"income":113.38,"channel":"miniapp","created_at":"2026-07-25T19:49:00.000Z"},{"id":"sale_seed_121","store_id":"s4","date":"2026-07-24","pid":"p5","temp":"ice","size":"L","addons":"[\"a2\"]","qty":2,"income":68.52,"channel":"taobao","created_at":"2026-07-24T10:28:00.000Z"},{"id":"sale_seed_122","store_id":"s4","date":"2026-07-24","pid":"p4","temp":"ice","size":"L","addons":"[\"a3\"]","qty":3,"income":90.89,"channel":"cash","created_at":"2026-07-24T20:38:00.000Z"},{"id":"sale_seed_123","store_id":"s4","date":"2026-07-24","pid":"p3","temp":"ice","size":"L","addons":"[]","qty":2,"income":53.34,"channel":"group","created_at":"2026-07-24T21:38:00.000Z"},{"id":"sale_seed_124","store_id":"s4","date":"2026-07-23","pid":"p5","temp":"ice","size":"M","addons":"[\"a2\", \"a3\"]","qty":2,"income":62.27,"channel":"cash","created_at":"2026-07-23T12:43:00.000Z"},{"id":"sale_seed_125","store_id":"s4","date":"2026-07-23","pid":"p2","temp":"hot","size":"M","addons":"[]","qty":2,"income":39.12,"channel":"cmb","created_at":"2026-07-23T10:19:00.000Z"},{"id":"sale_seed_126","store_id":"s4","date":"2026-07-22","pid":"p4","temp":"hot","size":"M","addons":"[\"a2\", \"a4\"]","qty":3,"income":92.6,"channel":"group","created_at":"2026-07-22T15:31:00.000Z"},{"id":"sale_seed_127","store_id":"s4","date":"2026-07-22","pid":"p1","temp":"hot","size":"L","addons":"[]","qty":3,"income":84.6,"channel":"group","created_at":"2026-07-22T11:35:00.000Z"},{"id":"sale_seed_128","store_id":"s4","date":"2026-07-21","pid":"p5","temp":"hot","size":"M","addons":"[\"a1\", \"a3\"]","qty":1,"income":35.56,"channel":"group","created_at":"2026-07-21T16:17:00.000Z"},{"id":"sale_seed_129","store_id":"s4","date":"2026-07-21","pid":"p5","temp":"ice","size":"L","addons":"[\"a2\"]","qty":1,"income":33.1,"channel":"miniapp","created_at":"2026-07-21T11:16:00.000Z"},{"id":"sale_seed_130","store_id":"s4","date":"2026-07-20","pid":"p3","temp":"hot","size":"M","addons":"[\"a4\"]","qty":3,"income":74.07,"channel":"cmb","created_at":"2026-07-20T18:43:00.000Z"},{"id":"sale_seed_131","store_id":"s4","date":"2026-07-20","pid":"p4","temp":"hot","size":"L","addons":"[\"a3\"]","qty":1,"income":31.38,"channel":"group","created_at":"2026-07-20T14:37:00.000Z"},{"id":"sale_seed_132","store_id":"s4","date":"2026-07-20","pid":"p3","temp":"ice","size":"L","addons":"[\"a1\"]","qty":3,"income":97.14,"channel":"cmb","created_at":"2026-07-20T12:44:00.000Z"},{"id":"sale_seed_133","store_id":"s4","date":"2026-07-19","pid":"p4","temp":"hot","size":"L","addons":"[\"a1\", \"a2\", \"a3\"]","qty":3,"income":119.78,"channel":"cash","created_at":"2026-07-19T09:07:00.000Z"},{"id":"sale_seed_134","store_id":"s4","date":"2026-07-19","pid":"p4","temp":"ice","size":"M","addons":"[]","qty":1,"income":25.05,"channel":"cmb","created_at":"2026-07-19T17:58:00.000Z"},{"id":"sale_seed_135","store_id":"s4","date":"2026-07-18","pid":"p3","temp":"ice","size":"L","addons":"[\"a2\"]","qty":3,"income":81.98,"channel":"cmb","created_at":"2026-07-18T14:07:00.000Z"},{"id":"sale_seed_136","store_id":"s4","date":"2026-07-18","pid":"p1","temp":"hot","size":"M","addons":"[\"a2\", \"a3\"]","qty":1,"income":28.22,"channel":"taobao","created_at":"2026-07-18T19:14:00.000Z"},{"id":"sale_seed_137","store_id":"s4","date":"2026-07-17","pid":"p3","temp":"ice","size":"L","addons":"[]","qty":2,"income":49.91,"channel":"cmb","created_at":"2026-07-17T18:02:00.000Z"},{"id":"sale_seed_138","store_id":"s4","date":"2026-07-17","pid":"p3","temp":"hot","size":"M","addons":"[]","qty":1,"income":22.61,"channel":"taobao","created_at":"2026-07-17T21:33:00.000Z"},{"id":"sale_seed_139","store_id":"s5","date":"2026-07-28","pid":"p4","temp":"ice","size":"M","addons":"[]","qty":3,"income":76.24,"channel":"meituan","created_at":"2026-07-28T12:19:00.000Z"},{"id":"sale_seed_140","store_id":"s5","date":"2026-07-28","pid":"p5","temp":"hot","size":"L","addons":"[\"a3\"]","qty":1,"income":33.6,"channel":"cash","created_at":"2026-07-28T18:34:00.000Z"},{"id":"sale_seed_141","store_id":"s5","date":"2026-07-28","pid":"p1","temp":"hot","size":"M","addons":"[]","qty":1,"income":24.44,"channel":"cmb","created_at":"2026-07-28T09:00:00.000Z"},{"id":"sale_seed_142","store_id":"s5","date":"2026-07-27","pid":"p5","temp":"hot","size":"M","addons":"[\"a2\", \"a3\"]","qty":2,"income":64.67,"channel":"other","created_at":"2026-07-27T15:59:00.000Z"},{"id":"sale_seed_143","store_id":"s5","date":"2026-07-27","pid":"p1","temp":"ice","size":"L","addons":"[]","qty":3,"income":83.58,"channel":"jd","created_at":"2026-07-27T16:40:00.000Z"},{"id":"sale_seed_144","store_id":"s5","date":"2026-07-27","pid":"p3","temp":"hot","size":"M","addons":"[\"a4\"]","qty":1,"income":24.55,"channel":"meituan","created_at":"2026-07-27T09:40:00.000Z"},{"id":"sale_seed_145","store_id":"s5","date":"2026-07-26","pid":"p4","temp":"hot","size":"L","addons":"[\"a3\", \"a4\"]","qty":1,"income":31.99,"channel":"cash","created_at":"2026-07-26T12:18:00.000Z"},{"id":"sale_seed_146","store_id":"s5","date":"2026-07-26","pid":"p1","temp":"hot","size":"M","addons":"[\"a2\"]","qty":2,"income":55.77,"channel":"jd","created_at":"2026-07-26T19:26:00.000Z"},{"id":"sale_seed_147","store_id":"s5","date":"2026-07-25","pid":"p3","temp":"ice","size":"L","addons":"[]","qty":2,"income":51.54,"channel":"meituan","created_at":"2026-07-25T12:43:00.000Z"},{"id":"sale_seed_148","store_id":"s5","date":"2026-07-25","pid":"p2","temp":"ice","size":"M","addons":"[\"a1\", \"a3\"]","qty":3,"income":88.19,"channel":"jd","created_at":"2026-07-25T16:48:00.000Z"},{"id":"sale_seed_149","store_id":"s5","date":"2026-07-24","pid":"p4","temp":"hot","size":"M","addons":"[\"a1\", \"a3\"]","qty":3,"income":110.08,"channel":"cash","created_at":"2026-07-24T19:36:00.000Z"},{"id":"sale_seed_150","store_id":"s5","date":"2026-07-24","pid":"p4","temp":"hot","size":"L","addons":"[]","qty":3,"income":85.68,"channel":"miniapp","created_at":"2026-07-24T16:54:00.000Z"},{"id":"sale_seed_151","store_id":"s5","date":"2026-07-24","pid":"p2","temp":"hot","size":"L","addons":"[]","qty":1,"income":22.27,"channel":"other","created_at":"2026-07-24T16:04:00.000Z"},{"id":"sale_seed_152","store_id":"s5","date":"2026-07-24","pid":"p2","temp":"hot","size":"L","addons":"[]","qty":1,"income":21.75,"channel":"taobao","created_at":"2026-07-24T15:44:00.000Z"},{"id":"sale_seed_153","store_id":"s5","date":"2026-07-23","pid":"p2","temp":"hot","size":"M","addons":"[]","qty":3,"income":54.22,"channel":"group","created_at":"2026-07-23T20:22:00.000Z"},{"id":"sale_seed_154","store_id":"s5","date":"2026-07-23","pid":"p5","temp":"hot","size":"L","addons":"[\"a2\"]","qty":2,"income":67.54,"channel":"group","created_at":"2026-07-23T10:04:00.000Z"},{"id":"sale_seed_155","store_id":"s5","date":"2026-07-23","pid":"p3","temp":"ice","size":"L","addons":"[\"a3\"]","qty":2,"income":55.53,"channel":"cmb","created_at":"2026-07-23T17:59:00.000Z"},{"id":"sale_seed_156","store_id":"s5","date":"2026-07-22","pid":"p5","temp":"ice","size":"L","addons":"[]","qty":2,"income":64.46,"channel":"cash","created_at":"2026-07-22T17:18:00.000Z"},{"id":"sale_seed_157","store_id":"s5","date":"2026-07-22","pid":"p1","temp":"hot","size":"L","addons":"[\"a2\", \"a3\"]","qty":1,"income":31.18,"channel":"miniapp","created_at":"2026-07-22T19:22:00.000Z"},{"id":"sale_seed_158","store_id":"s5","date":"2026-07-21","pid":"p2","temp":"hot","size":"L","addons":"[\"a3\"]","qty":1,"income":23.29,"channel":"meituan","created_at":"2026-07-21T11:07:00.000Z"},{"id":"sale_seed_159","store_id":"s5","date":"2026-07-21","pid":"p4","temp":"hot","size":"L","addons":"[\"a2\", \"a3\"]","qty":3,"income":103.94,"channel":"taobao","created_at":"2026-07-21T11:46:00.000Z"},{"id":"sale_seed_160","store_id":"s5","date":"2026-07-21","pid":"p1","temp":"hot","size":"L","addons":"[\"a1\", \"a2\", \"a4\"]","qty":2,"income":76.01,"channel":"miniapp","created_at":"2026-07-21T13:14:00.000Z"},{"id":"sale_seed_161","store_id":"s5","date":"2026-07-21","pid":"p5","temp":"hot","size":"M","addons":"[\"a2\"]","qty":3,"income":87.41,"channel":"meituan","created_at":"2026-07-21T14:07:00.000Z"},{"id":"sale_seed_162","store_id":"s5","date":"2026-07-20","pid":"p5","temp":"hot","size":"M","addons":"[]","qty":1,"income":28.08,"channel":"miniapp","created_at":"2026-07-20T10:35:00.000Z"},{"id":"sale_seed_163","store_id":"s5","date":"2026-07-20","pid":"p3","temp":"ice","size":"M","addons":"[]","qty":3,"income":64.55,"channel":"other","created_at":"2026-07-20T17:14:00.000Z"},{"id":"sale_seed_164","store_id":"s5","date":"2026-07-20","pid":"p5","temp":"ice","size":"M","addons":"[\"a4\"]","qty":2,"income":56.45,"channel":"cmb","created_at":"2026-07-20T21:49:00.000Z"},{"id":"sale_seed_165","store_id":"s5","date":"2026-07-19","pid":"p4","temp":"hot","size":"L","addons":"[\"a2\", \"a4\"]","qty":1,"income":33.68,"channel":"cmb","created_at":"2026-07-19T14:31:00.000Z"},{"id":"sale_seed_166","store_id":"s5","date":"2026-07-19","pid":"p2","temp":"ice","size":"M","addons":"[]","qty":1,"income":18.9,"channel":"taobao","created_at":"2026-07-19T20:42:00.000Z"},{"id":"sale_seed_167","store_id":"s5","date":"2026-07-19","pid":"p4","temp":"ice","size":"L","addons":"[\"a4\"]","qty":2,"income":61.77,"channel":"meituan","created_at":"2026-07-19T20:32:00.000Z"},{"id":"sale_seed_168","store_id":"s5","date":"2026-07-18","pid":"p1","temp":"hot","size":"L","addons":"[\"a1\", \"a2\"]","qty":1,"income":39.38,"channel":"other","created_at":"2026-07-18T16:28:00.000Z"},{"id":"sale_seed_169","store_id":"s5","date":"2026-07-18","pid":"p4","temp":"ice","size":"L","addons":"[\"a2\"]","qty":1,"income":31.89,"channel":"other","created_at":"2026-07-18T17:56:00.000Z"},{"id":"sale_seed_170","store_id":"s5","date":"2026-07-17","pid":"p3","temp":"ice","size":"M","addons":"[\"a4\"]","qty":3,"income":72.93,"channel":"jd","created_at":"2026-07-17T14:52:00.000Z"},{"id":"sale_seed_171","store_id":"s5","date":"2026-07-17","pid":"p4","temp":"ice","size":"L","addons":"[\"a3\"]","qty":1,"income":31.72,"channel":"cmb","created_at":"2026-07-17T18:07:00.000Z"},{"id":"sale_seed_172","store_id":"s5","date":"2026-07-17","pid":"p1","temp":"ice","size":"L","addons":"[\"a4\"]","qty":2,"income":59.05,"channel":"meituan","created_at":"2026-07-17T10:57:00.000Z"},{"id":"sale_seed_173","store_id":"s6","date":"2026-07-28","pid":"p5","temp":"hot","size":"L","addons":"[]","qty":1,"income":32.02,"channel":"cash","created_at":"2026-07-28T17:06:00.000Z"},{"id":"sale_seed_174","store_id":"s6","date":"2026-07-28","pid":"p1","temp":"hot","size":"L","addons":"[]","qty":1,"income":27.84,"channel":"jd","created_at":"2026-07-28T17:51:00.000Z"},{"id":"sale_seed_175","store_id":"s6","date":"2026-07-28","pid":"p5","temp":"ice","size":"L","addons":"[]","qty":2,"income":63.14,"channel":"group","created_at":"2026-07-28T12:53:00.000Z"},{"id":"sale_seed_176","store_id":"s6","date":"2026-07-28","pid":"p1","temp":"ice","size":"M","addons":"[]","qty":1,"income":23.73,"channel":"other","created_at":"2026-07-28T18:43:00.000Z"},{"id":"sale_seed_177","store_id":"s6","date":"2026-07-27","pid":"p3","temp":"ice","size":"L","addons":"[]","qty":3,"income":78.76,"channel":"taobao","created_at":"2026-07-27T12:34:00.000Z"},{"id":"sale_seed_178","store_id":"s6","date":"2026-07-27","pid":"p3","temp":"hot","size":"M","addons":"[]","qty":3,"income":65.5,"channel":"other","created_at":"2026-07-27T17:28:00.000Z"},{"id":"sale_seed_179","store_id":"s6","date":"2026-07-27","pid":"p5","temp":"hot","size":"L","addons":"[]","qty":1,"income":31.29,"channel":"miniapp","created_at":"2026-07-27T18:23:00.000Z"},{"id":"sale_seed_180","store_id":"s6","date":"2026-07-27","pid":"p2","temp":"ice","size":"M","addons":"[]","qty":3,"income":58.33,"channel":"jd","created_at":"2026-07-27T20:08:00.000Z"},{"id":"sale_seed_181","store_id":"s6","date":"2026-07-26","pid":"p2","temp":"ice","size":"L","addons":"[\"a1\"]","qty":1,"income":31.06,"channel":"taobao","created_at":"2026-07-26T20:33:00.000Z"},{"id":"sale_seed_182","store_id":"s6","date":"2026-07-26","pid":"p5","temp":"hot","size":"M","addons":"[\"a2\", \"a3\", \"a4\"]","qty":3,"income":101.61,"channel":"other","created_at":"2026-07-26T10:10:00.000Z"},{"id":"sale_seed_183","store_id":"s6","date":"2026-07-26","pid":"p3","temp":"hot","size":"L","addons":"[\"a4\"]","qty":3,"income":84.59,"channel":"miniapp","created_at":"2026-07-26T16:47:00.000Z"},{"id":"sale_seed_184","store_id":"s6","date":"2026-07-25","pid":"p2","temp":"ice","size":"M","addons":"[]","qty":3,"income":56.97,"channel":"cash","created_at":"2026-07-25T12:46:00.000Z"},{"id":"sale_seed_185","store_id":"s6","date":"2026-07-25","pid":"p3","temp":"hot","size":"M","addons":"[]","qty":3,"income":64.26,"channel":"miniapp","created_at":"2026-07-25T16:18:00.000Z"},{"id":"sale_seed_186","store_id":"s6","date":"2026-07-24","pid":"p5","temp":"hot","size":"L","addons":"[]","qty":1,"income":31.75,"channel":"group","created_at":"2026-07-24T13:50:00.000Z"},{"id":"sale_seed_187","store_id":"s6","date":"2026-07-24","pid":"p1","temp":"hot","size":"L","addons":"[\"a2\"]","qty":2,"income":62.78,"channel":"taobao","created_at":"2026-07-24T10:31:00.000Z"},{"id":"sale_seed_188","store_id":"s6","date":"2026-07-23","pid":"p1","temp":"hot","size":"L","addons":"[]","qty":1,"income":27.96,"channel":"taobao","created_at":"2026-07-23T15:41:00.000Z"},{"id":"sale_seed_189","store_id":"s6","date":"2026-07-23","pid":"p4","temp":"hot","size":"L","addons":"[\"a2\"]","qty":2,"income":62.01,"channel":"miniapp","created_at":"2026-07-23T15:01:00.000Z"},{"id":"sale_seed_190","store_id":"s6","date":"2026-07-22","pid":"p4","temp":"ice","size":"M","addons":"[\"a2\"]","qty":3,"income":86.19,"channel":"other","created_at":"2026-07-22T15:16:00.000Z"},{"id":"sale_seed_191","store_id":"s6","date":"2026-07-22","pid":"p4","temp":"hot","size":"L","addons":"[\"a4\"]","qty":1,"income":30.52,"channel":"cmb","created_at":"2026-07-22T21:40:00.000Z"},{"id":"sale_seed_192","store_id":"s6","date":"2026-07-22","pid":"p2","temp":"ice","size":"M","addons":"[\"a1\", \"a3\"]","qty":1,"income":28.19,"channel":"cash","created_at":"2026-07-22T14:59:00.000Z"},{"id":"sale_seed_193","store_id":"s6","date":"2026-07-21","pid":"p2","temp":"ice","size":"L","addons":"[]","qty":2,"income":45.75,"channel":"taobao","created_at":"2026-07-21T20:40:00.000Z"},{"id":"sale_seed_194","store_id":"s6","date":"2026-07-21","pid":"p5","temp":"ice","size":"L","addons":"[\"a3\"]","qty":1,"income":32.76,"channel":"meituan","created_at":"2026-07-21T19:10:00.000Z"},{"id":"sale_seed_195","store_id":"s6","date":"2026-07-21","pid":"p1","temp":"ice","size":"L","addons":"[\"a2\"]","qty":3,"income":87.13,"channel":"cmb","created_at":"2026-07-21T19:17:00.000Z"},{"id":"sale_seed_196","store_id":"s6","date":"2026-07-21","pid":"p1","temp":"hot","size":"L","addons":"[\"a4\"]","qty":1,"income":28.59,"channel":"miniapp","created_at":"2026-07-21T11:29:00.000Z"},{"id":"sale_seed_197","store_id":"s6","date":"2026-07-20","pid":"p2","temp":"ice","size":"L","addons":"[]","qty":2,"income":45.26,"channel":"cmb","created_at":"2026-07-20T17:04:00.000Z"},{"id":"sale_seed_198","store_id":"s6","date":"2026-07-20","pid":"p4","temp":"hot","size":"L","addons":"[]","qty":1,"income":28.61,"channel":"other","created_at":"2026-07-20T17:26:00.000Z"},{"id":"sale_seed_199","store_id":"s6","date":"2026-07-20","pid":"p2","temp":"ice","size":"M","addons":"[\"a2\"]","qty":3,"income":61.7,"channel":"taobao","created_at":"2026-07-20T10:02:00.000Z"},{"id":"sale_seed_200","store_id":"s6","date":"2026-07-19","pid":"p4","temp":"hot","size":"M","addons":"[]","qty":1,"income":26.43,"channel":"other","created_at":"2026-07-19T18:19:00.000Z"},{"id":"sale_seed_201","store_id":"s6","date":"2026-07-19","pid":"p1","temp":"hot","size":"M","addons":"[]","qty":1,"income":23.51,"channel":"miniapp","created_at":"2026-07-19T17:26:00.000Z"},{"id":"sale_seed_202","store_id":"s6","date":"2026-07-19","pid":"p4","temp":"ice","size":"M","addons":"[\"a3\"]","qty":3,"income":83.86,"channel":"meituan","created_at":"2026-07-19T13:53:00.000Z"},{"id":"sale_seed_203","store_id":"s6","date":"2026-07-19","pid":"p4","temp":"hot","size":"M","addons":"[\"a3\"]","qty":1,"income":26.55,"channel":"cash","created_at":"2026-07-19T13:52:00.000Z"},{"id":"sale_seed_204","store_id":"s6","date":"2026-07-18","pid":"p2","temp":"ice","size":"L","addons":"[\"a4\"]","qty":1,"income":22.99,"channel":"meituan","created_at":"2026-07-18T15:56:00.000Z"},{"id":"sale_seed_205","store_id":"s6","date":"2026-07-18","pid":"p5","temp":"ice","size":"M","addons":"[\"a2\"]","qty":1,"income":29.66,"channel":"jd","created_at":"2026-07-18T15:38:00.000Z"},{"id":"sale_seed_206","store_id":"s6","date":"2026-07-18","pid":"p5","temp":"hot","size":"M","addons":"[\"a1\"]","qty":3,"income":106.1,"channel":"taobao","created_at":"2026-07-18T14:58:00.000Z"},{"id":"sale_seed_207","store_id":"s6","date":"2026-07-18","pid":"p2","temp":"ice","size":"L","addons":"[]","qty":3,"income":67.69,"channel":"cash","created_at":"2026-07-18T12:58:00.000Z"},{"id":"sale_seed_208","store_id":"s6","date":"2026-07-17","pid":"p1","temp":"ice","size":"L","addons":"[\"a2\"]","qty":2,"income":60.77,"channel":"group","created_at":"2026-07-17T14:56:00.000Z"},{"id":"sale_seed_209","store_id":"s6","date":"2026-07-17","pid":"p3","temp":"ice","size":"M","addons":"[\"a2\", \"a4\"]","qty":2,"income":51.58,"channel":"miniapp","created_at":"2026-07-17T14:01:00.000Z"}],"docs":[{"id":"REQ-seed1","type":"req","store_id":"s1","status":"approved","creator":"mgr_s1","date":"2026-07-18","items":"[{\"mid\": \"m1\", \"qty\": 2000}, {\"mid\": \"m2\", \"qty\": 5000}]","meta":"{\"fromReco\": false, \"log\": [{\"t\": \"2026-07-18T10:00:00.000Z\", \"who\": \"mgr_s1\", \"act\": \"发起订货\"}]}","created_at":"2026-07-18T10:00:00.000Z","updated_at":"2026-07-19T10:00:00.000Z"},{"id":"ALO-seed1","type":"alloc","store_id":"s1","status":"confirmed","creator":"hq","date":"2026-07-20","items":"[{\"mid\": \"m1\", \"qty\": 2000}, {\"mid\": \"m2\", \"qty\": 5000}]","meta":"{\"fromReq\": \"REQ-seed1\", \"log\": [{\"t\": \"2026-07-20T10:00:00.000Z\", \"who\": \"hq\", \"act\": \"总部下发并确认\"}]}","created_at":"2026-07-20T10:00:00.000Z","updated_at":"2026-07-20T10:00:00.000Z"},{"id":"ALO-seed2","type":"alloc","store_id":"s2","status":"pending_store_confirm","creator":"hq","date":"2026-07-22","items":"[{\"mid\": \"m3\", \"qty\": 2000}]","meta":"{\"fromReq\": \"\", \"log\": []}","created_at":"2026-07-22T10:00:00.000Z","updated_at":"2026-07-22T10:00:00.000Z"},{"id":"STK-seed1","type":"stk","store_id":"s2","status":"pending_hq","creator":"mgr_s2","date":"2026-07-23","items":"[{\"mid\": \"m1\", \"qty\": 1800}, {\"mid\": \"m2\", \"qty\": 4200}]","meta":"{\"log\": [{\"t\": \"2026-07-23T10:00:00.000Z\", \"who\": \"mgr_s2\", \"act\": \"发起盘点\"}]}","created_at":"2026-07-23T10:00:00.000Z","updated_at":"2026-07-23T10:00:00.000Z"},{"id":"RET-seed1","type":"ret","store_id":"s3","status":"pending_manager","creator":"clerk_s3","date":"2026-07-24","items":"[{\"mid\": \"m12\", \"qty\": 20}]","meta":"{\"reason\": \"柠檬到货不新鲜\", \"log\": [{\"t\": \"2026-07-24T10:00:00.000Z\", \"who\": \"clerk_s3\", \"act\": \"发起退货\"}]}","created_at":"2026-07-24T10:00:00.000Z","updated_at":"2026-07-24T10:00:00.000Z"}],"inventory":[{"store_id":"s1","material_id":"m1","qty":4000.0},{"store_id":"s1","material_id":"m2","qty":10000.0},{"store_id":"s1","material_id":"m3","qty":4000.0},{"store_id":"s1","material_id":"m4","qty":2000.0},{"store_id":"s1","material_id":"m5","qty":1000.0},{"store_id":"s1","material_id":"m6","qty":1000.0},{"store_id":"s1","material_id":"m7","qty":1000.0},{"store_id":"s1","material_id":"m8","qty":1000.0},{"store_id":"s1","material_id":"m9","qty":1000.0},{"store_id":"s1","material_id":"m10","qty":20000.0},{"store_id":"s1","material_id":"m11","qty":20000.0},{"store_id":"s1","material_id":"m12","qty":200.0},{"store_id":"s2","material_id":"m1","qty":6000.0},{"store_id":"s2","material_id":"m2","qty":15000.0},{"store_id":"s2","material_id":"m3","qty":6000.0},{"store_id":"s2","material_id":"m4","qty":3000.0},{"store_id":"s2","material_id":"m5","qty":1500.0},{"store_id":"s2","material_id":"m6","qty":1500.0},{"store_id":"s2","material_id":"m7","qty":1500.0},{"store_id":"s2","material_id":"m8","qty":1500.0},{"store_id":"s2","material_id":"m9","qty":1500.0},{"store_id":"s2","material_id":"m10","qty":30000.0},{"store_id":"s2","material_id":"m11","qty":30000.0},{"store_id":"s2","material_id":"m12","qty":300.0},{"store_id":"s3","material_id":"m1","qty":8000.0},{"store_id":"s3","material_id":"m2","qty":20000.0},{"store_id":"s3","material_id":"m3","qty":8000.0},{"store_id":"s3","material_id":"m4","qty":4000.0},{"store_id":"s3","material_id":"m5","qty":2000.0},{"store_id":"s3","material_id":"m6","qty":2000.0},{"store_id":"s3","material_id":"m7","qty":2000.0},{"store_id":"s3","material_id":"m8","qty":2000.0},{"store_id":"s3","material_id":"m9","qty":2000.0},{"store_id":"s3","material_id":"m10","qty":40000.0},{"store_id":"s3","material_id":"m11","qty":40000.0},{"store_id":"s3","material_id":"m12","qty":400.0},{"store_id":"s4","material_id":"m1","qty":4000.0},{"store_id":"s4","material_id":"m2","qty":10000.0},{"store_id":"s4","material_id":"m3","qty":4000.0},{"store_id":"s4","material_id":"m4","qty":2000.0},{"store_id":"s4","material_id":"m5","qty":1000.0},{"store_id":"s4","material_id":"m6","qty":1000.0},{"store_id":"s4","material_id":"m7","qty":1000.0},{"store_id":"s4","material_id":"m8","qty":1000.0},{"store_id":"s4","material_id":"m9","qty":1000.0},{"store_id":"s4","material_id":"m10","qty":20000.0},{"store_id":"s4","material_id":"m11","qty":20000.0},{"store_id":"s4","material_id":"m12","qty":200.0},{"store_id":"s5","material_id":"m1","qty":6000.0},{"store_id":"s5","material_id":"m2","qty":15000.0},{"store_id":"s5","material_id":"m3","qty":6000.0},{"store_id":"s5","material_id":"m4","qty":3000.0},{"store_id":"s5","material_id":"m5","qty":1500.0},{"store_id":"s5","material_id":"m6","qty":1500.0},{"store_id":"s5","material_id":"m7","qty":1500.0},{"store_id":"s5","material_id":"m8","qty":1500.0},{"store_id":"s5","material_id":"m9","qty":1500.0},{"store_id":"s5","material_id":"m10","qty":30000.0},{"store_id":"s5","material_id":"m11","qty":30000.0},{"store_id":"s5","material_id":"m12","qty":300.0},{"store_id":"s6","material_id":"m1","qty":8000.0},{"store_id":"s6","material_id":"m2","qty":20000.0},{"store_id":"s6","material_id":"m3","qty":8000.0},{"store_id":"s6","material_id":"m4","qty":4000.0},{"store_id":"s6","material_id":"m5","qty":2000.0},{"store_id":"s6","material_id":"m6","qty":2000.0},{"store_id":"s6","material_id":"m7","qty":2000.0},{"store_id":"s6","material_id":"m8","qty":2000.0},{"store_id":"s6","material_id":"m9","qty":2000.0},{"store_id":"s6","material_id":"m10","qty":40000.0},{"store_id":"s6","material_id":"m11","qty":40000.0},{"store_id":"s6","material_id":"m12","qty":400.0}],"recos":[],"sessions":[]};

  function loadStore() {
    var raw = lsGet();
    if (raw) { try { return JSON.parse(raw); } catch (e) {} }
    return JSON.parse(JSON.stringify(SEED)); // 深拷贝种子
  }
  var STORE = loadStore();
  function persist() { lsSet(JSON.stringify(STORE)); }

  // ---------- 数据层 helpers（数组版，等价于 server.js 的 SQL） ----------
  function T(name) { return STORE[name]; }
  function findRow(t, pred) { var a = T(t); for (var i = 0; i < a.length; i++) if (pred(a[i])) return a[i]; return null; }
  function filterRows(t, pred) { return T(t).filter(pred); }
  function insertRow(t, row) { T(t).push(row); persist(); return row; }
  function updateRow(t, pred, setter) { var r = findRow(t, pred); if (r) { setter(r); persist(); } return r; }
  function deleteRows(t, pred) { STORE[t] = T(t).filter(function (x) { return !pred(x); }); persist(); }
  function upsertRow(t, row, keyFn) {
    var a = T(t); var k = keyFn(row);
    for (var i = 0; i < a.length; i++) { if (keyFn(a[i]) === k) { a[i] = row; persist(); return row; } }
    a.push(row); persist(); return row;
  }

  function uid(p) { return p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function today() { var d = new Date(); var m = ('0' + (d.getMonth() + 1)).slice(-2); var day = ('0' + d.getDate()).slice(-2); return d.getFullYear() + '-' + m + '-' + day; }
  function isoNow() { return new Date().toISOString(); }
  function dayAdd(dstr, n) { var p = dstr.split('-'); var dt = new Date(p[0], p[1] - 1, p[2]); dt.setDate(dt.getDate() + n); return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2); }
  function cleanUser(u) { if (!u) return u; var c = {}; for (var k in u) { if (k !== 'password') c[k] = u[k]; } return c; }

  var CHANNELS = [
    { id: 'taobao', name: '淘宝闪购' }, { id: 'meituan', name: '美团外卖' },
    { id: 'miniapp', name: '堂食小程序' }, { id: 'jd', name: '京东外卖' },
    { id: 'group', name: '团购' }, { id: 'cmb', name: '招商信用卡' },
    { id: 'cash', name: '堂食现金' }, { id: 'other', name: '其他' }
  ];

  // ---------- 鉴权 ----------
  function getUser(token) {
    if (!token) return null;
    var s = findRow('sessions', function (x) { return x.token === token; });
    if (!s) return null;
    if (new Date(s.expires) < new Date()) return null;
    return findRow('users', function (x) { return x.id === s.user_id; });
  }

  // ---------- BOM ----------
  function loadBoms() {
    var rows = T('boms'); var map = {};
    rows.forEach(function (r) { (map[r.pk] = map[r.pk] || []).push({ mid: r.material_id, qty: r.qty }); });
    return map;
  }
  function saleNeed(boms, pid, temp, size, addonIds, qty) {
    var need = {};
    var list = boms[pid + '|' + temp + '|' + size] || [];
    list.forEach(function (b) { need[b.mid] = (need[b.mid] || 0) + b.qty * qty; });
    (addonIds || []).forEach(function (aid) {
      var list2 = boms['a|' + aid] || [];
      list2.forEach(function (b) { need[b.mid] = (need[b.mid] || 0) + b.qty * qty; });
    });
    return need;
  }

  // ---------- bootstrap ----------
  function bootstrap(user) {
    var stores = T('stores').slice();
    var materials = T('materials').slice();
    var products = T('products').slice();
    var addons = T('addons').slice();
    var boms = loadBoms();
    var inventory = {};
    T('inventory').forEach(function (r) { (inventory[r.store_id] = inventory[r.store_id] || {})[r.material_id] = r.qty; });
    var recos = {};
    T('recos').forEach(function (r) { var d = JSON.parse(r.data || '{}'); recos[r.store_id] = { week: r.week, items: d.items || [] }; });
    var since = dayAdd(today(), -60);
    var sales, docs;
    if (user.role === 'hq') { sales = filterRows('sales', function (s) { return s.date >= since; }); docs = T('docs').slice(); }
    else { sales = filterRows('sales', function (s) { return s.store_id === user.store_id && s.date >= since; }); docs = filterRows('docs', function (d) { return d.store_id === user.store_id; }); }
    // 返回解析后的副本，绝不改写 STORE 原始行（否则后续汇总/结算会重复 JSON.parse 失败）
    docs = docs.map(function (d) { return Object.assign({}, d, { items: JSON.parse(d.items || '[]'), meta: JSON.parse(d.meta || '{}') }); });
    sales = sales.map(function (s) { return Object.assign({}, s, { addons: JSON.parse(s.addons || '[]') }); });
    return { stores: stores, materials: materials, products: products, addons: addons, boms: boms, inventory: inventory, sales: sales, docs: docs, recos: recos, currentUser: cleanUser(user) };
  }

  // ---------- 登录 ----------
  function apiLogin(body) {
    var u = findRow('users', function (x) { return x.username === (body.username || ''); });
    if (!u || u.password !== (body.password || '')) return { status: 401, data: { error: '用户名或密码错误' } };
    var token = uid('tok_');
    var expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    insertRow('sessions', { token: token, user_id: u.id, expires: expires });
    return { status: 200, data: { token: token, user: cleanUser(u) } };
  }

  // ---------- 销售出库 ----------
  function apiCreateSale(user, body) {
    if (user.role === 'hq') return { status: 400, data: { error: '总部账号无门店销售' } };
    var store = findRow('stores', function (s) { return s.id === user.store_id; });
    if (!store || !store.active) return { status: 400, data: { error: '门店已停用，无法出库' } };
    var pid = body.pid, temp = body.temp || 'hot', size = body.size || 'M';
    var addonIds = body.addons || [];
    var qty = parseInt(body.qty, 10) || 1;
    var income = parseFloat(body.income) || 0;
    var channel = body.channel || 'other';
    var boms = loadBoms();
    var need = saleNeed(boms, pid, temp, size, addonIds, qty);
    Object.keys(need).forEach(function (mid) {
      var inv = findRow('inventory', function (r) { return r.store_id === user.store_id && r.material_id === mid; });
      var newq = (inv ? inv.qty : 0) - need[mid];
      upsertRow('inventory', { store_id: user.store_id, material_id: mid, qty: newq }, function (r) { return r.store_id + '|' + r.material_id; });
    });
    var id = uid('sale_');
    insertRow('sales', { id: id, store_id: user.store_id, date: today(), pid: pid, temp: temp, size: size, addons: JSON.stringify(addonIds), qty: qty, income: income, channel: channel, created_at: isoNow() });
    return { status: 200, data: { ok: true, id: id } };
  }

  // ---------- 模拟渠道同步 ----------
  function apiSimulate(user) {
    if (user.role === 'hq') return { status: 400, data: { error: '请在门店账号下演示' } };
    var boms = loadBoms();
    var prods = filterRows('products', function (p) { return p.active === 1; });
    var adds = T('addons');
    var temps = ['hot', 'ice'], sizes = ['M', 'L'];
    var basePrice = { p1: 28, p2: 22, p3: 26, p4: 30, p5: 32 };
    var n = 14 + Math.floor(Math.random() * 8);
    var totalIncome = 0, totalQty = 0, chCount = {};
    for (var i = 0; i < n; i++) {
      var p = prods[Math.floor(Math.random() * prods.length)];
      var temp = temps[Math.floor(Math.random() * 2)];
      var size = sizes[Math.floor(Math.random() * 2)];
      var ch = CHANNELS[Math.floor(Math.random() * CHANNELS.length)].id;
      var addonIds = [];
      adds.forEach(function (a) { if (Math.random() < 0.25) addonIds.push(a.id); });
      var qty = 1 + Math.floor(Math.random() * 2);
      var gross = (basePrice[p.id] || 25) + (size === 'L' ? 4 : 0);
      adds.forEach(function (a) { if (addonIds.indexOf(a.id) >= 0) gross += a.price; });
      var net = Math.round(gross * (0.82 + Math.random() * 0.08) * qty * 100) / 100;
      var need = saleNeed(boms, p.id, temp, size, addonIds, qty);
      Object.keys(need).forEach(function (mid) {
        var inv = findRow('inventory', function (r) { return r.store_id === user.store_id && r.material_id === mid; });
        var newq = (inv ? inv.qty : 0) - need[mid];
        upsertRow('inventory', { store_id: user.store_id, material_id: mid, qty: newq }, function (r) { return r.store_id + '|' + r.material_id; });
      });
      var id = uid('sale_');
      insertRow('sales', { id: id, store_id: user.store_id, date: today(), pid: p.id, temp: temp, size: size, addons: JSON.stringify(addonIds), qty: qty, income: net, channel: ch, created_at: isoNow() });
      totalIncome += net; totalQty += qty; chCount[ch] = (chCount[ch] || 0) + 1;
    }
    return { status: 200, data: { ok: true, count: n, totalIncome: totalIncome, totalQty: totalQty, chCount: chCount } };
  }

  // ---------- 新建单据 ----------
  function apiCreateDoc(user, body) {
    var type = body.type;
    if (type !== 'req' && type !== 'stk' && type !== 'ret') return { status: 400, data: { error: '不支持的单据类型' } };
    if (user.role === 'hq') return { status: 400, data: { error: '总部不直接建单' } };
    var store = findRow('stores', function (s) { return s.id === user.store_id; });
    if (!store || !store.active) return { status: 400, data: { error: '门店已停用，无法建单' } };
    var items = body.items || [];
    if (!items.length) return { status: 400, data: { error: '请至少填写一项' } };
    if (type === 'req') {
      var bad = [];
      T('materials').forEach(function (m) {
        var it = items.filter(function (x) { return x.mid === m.id; })[0];
        if (it && parseFloat(it.qty) < m.min_order) bad.push(m.name + ' 最低' + m.min_order + m.unit);
      });
      if (bad.length) return { status: 400, data: { error: '低于最低订购量: ' + bad.join('、') } };
    }
    var st = user.role === 'manager' ? 'pending_hq' : 'pending_manager';
    var id = uid(type.toUpperCase() + '-');
    var labels = { req: '订货单', stk: '盘点单', ret: '退货单' };
    var meta = body.meta || {};
    meta.log = [{ t: isoNow(), who: user.id, act: '发起' + labels[type] }];
    insertRow('docs', { id: id, type: type, store_id: user.store_id, status: st, creator: user.id, date: today(), items: JSON.stringify(items), meta: JSON.stringify(meta), created_at: isoNow(), updated_at: isoNow() });
    return { status: 200, data: { ok: true, id: id, status: st } };
  }

  // ---------- 总部配货 ----------
  function apiCreateAlloc(user, body) {
    if (user.role !== 'hq') return { status: 403, data: { error: '仅总部可配货' } };
    var req = findRow('docs', function (d) { return d.id === body.reqId && d.type === 'req'; });
    if (!req) return { status: 400, data: { error: '订货单不存在' } };
    if (req.status !== 'approved') return { status: 400, data: { error: '该订货单未通过或已配货' } };
    var items = body.items || [];
    var id = uid('ALO-');
    var meta = { fromReq: body.reqId, log: [{ t: isoNow(), who: user.id, act: '总部下发配货单（来自 ' + body.reqId + '）' }] };
    insertRow('docs', { id: id, type: 'alloc', store_id: req.store_id, status: 'pending_store_confirm', creator: user.id, date: today(), items: JSON.stringify(items), meta: JSON.stringify(meta), created_at: isoNow(), updated_at: isoNow() });
    updateRow('docs', function (d) { return d.id === body.reqId; }, function (d) { d.status = 'allocated'; d.updated_at = isoNow(); });
    return { status: 200, data: { ok: true, id: id } };
  }

  // ---------- 审批 ----------
  function applyStocktake(d) {
    JSON.parse(d.items || '[]').forEach(function (it) {
      upsertRow('inventory', { store_id: d.store_id, material_id: it.mid, qty: it.actual }, function (r) { return r.store_id + '|' + r.material_id; });
    });
  }
  function applyReturn(d) {
    JSON.parse(d.items || '[]').forEach(function (it) {
      var inv = findRow('inventory', function (r) { return r.store_id === d.store_id && r.material_id === it.mid; });
      var newq = (inv ? inv.qty : 0) - parseFloat(it.qty || 0);
      upsertRow('inventory', { store_id: d.store_id, material_id: it.mid, qty: newq }, function (r) { return r.store_id + '|' + r.material_id; });
    });
  }
  function apiApprove(user, id, decision, note) {
    var d = findRow('docs', function (x) { return x.id === id; });
    if (!d) return { status: 404, data: { error: '单据不存在' } };
    if (d.status === 'pending_manager') { if (user.role !== 'manager' || user.store_id !== d.store_id) return { status: 403, data: { error: '无审批权限' } }; }
    else if (d.status === 'pending_hq') { if (user.role !== 'hq') return { status: 403, data: { error: '仅总部可终审' } }; }
    else return { status: 400, data: { error: '当前状态不可审批' } };
    var meta = JSON.parse(d.meta || '{}');
    meta.log = meta.log || [];
    if (decision === 'reject') {
      d.status = 'rejected';
      meta.log.push({ t: isoNow(), who: user.id, act: '驳回' + (note ? ('：' + note) : '') });
    } else {
      if (d.status === 'pending_manager') { d.status = 'pending_hq'; meta.log.push({ t: isoNow(), who: user.id, act: '店长通过，转总部' }); }
      else if (d.status === 'pending_hq') {
        d.status = 'approved'; meta.log.push({ t: isoNow(), who: user.id, act: '总部通过' });
        if (d.type === 'stk') applyStocktake(d);
        if (d.type === 'ret') applyReturn(d);
      }
    }
    updateRow('docs', function (x) { return x.id === id; }, function (x) { x.status = d.status; x.meta = JSON.stringify(meta); x.updated_at = isoNow(); });
    return { status: 200, data: { ok: true, status: d.status } };
  }

  // ---------- 门店确认配货入库 ----------
  function apiConfirmAlloc(user, id) {
    var d = findRow('docs', function (x) { return x.id === id && x.type === 'alloc'; });
    if (!d) return { status: 404, data: { error: '配货单不存在' } };
    if (d.status !== 'pending_store_confirm') return { status: 400, data: { error: '非待确认状态' } };
    if (user.role === 'hq') return { status: 403, data: { error: '仅门店可确认' } };
    if (user.store_id !== d.store_id) return { status: 403, data: { error: '非本店配货单' } };
    JSON.parse(d.items || '[]').forEach(function (it) {
      var inv = findRow('inventory', function (r) { return r.store_id === d.store_id && r.material_id === it.mid; });
      var newq = (inv ? inv.qty : 0) + parseFloat(it.qty || 0);
      upsertRow('inventory', { store_id: d.store_id, material_id: it.mid, qty: newq }, function (r) { return r.store_id + '|' + r.material_id; });
    });
    var meta = JSON.parse(d.meta || '{}'); meta.log = meta.log || [];
    meta.log.push({ t: isoNow(), who: user.id, act: '门店确认收货，已自动入库' });
    updateRow('docs', function (x) { return x.id === id; }, function (x) { x.status = 'confirmed'; x.meta = JSON.stringify(meta); x.updated_at = isoNow(); });
    return { status: 200, data: { ok: true, status: 'confirmed' } };
  }

  // ---------- 物料维护 ----------
  function apiMaterial(user, body) {
    if (user.role !== 'hq') return { status: 403, data: { error: '仅总部可维护物料' } };
    var op = body.op;
    if (op === 'add') { var id = body.id || uid('m'); insertRow('materials', { id: id, name: body.name, unit: body.unit, price: parseFloat(body.price) || 0, min_order: parseFloat(body.min_order) || 0 }); return { status: 200, data: { ok: true, id: id } }; }
    if (op === 'edit') { updateRow('materials', function (m) { return m.id === body.id; }, function (m) { m.name = body.name; m.unit = body.unit; m.price = parseFloat(body.price) || 0; m.min_order = parseFloat(body.min_order) || 0; }); return { status: 200, data: { ok: true } }; }
    if (op === 'del') { deleteRows('boms', function (b) { return b.material_id === body.id; }); deleteRows('inventory', function (i) { return i.material_id === body.id; }); deleteRows('materials', function (m) { return m.id === body.id; }); return { status: 200, data: { ok: true } }; }
    return { status: 400, data: { error: '未知操作' } };
  }

  // ---------- 门店管理 ----------
  function apiStore(user, body) {
    if (user.role !== 'hq') return { status: 403, data: { error: '仅总部可管理门店' } };
    var op = body.op;
    if (op === 'add') {
      var id = body.id || uid('s');
      insertRow('stores', { id: id, name: body.name, active: 1, created_at: isoNow() });
      insertRow('users', { id: 'mgr_' + id, store_id: id, role: 'manager', name: body.name + '·店长', username: body.name + 'mgr', password: '123456', created_at: isoNow() });
      insertRow('users', { id: 'clerk_' + id, store_id: id, role: 'clerk', name: body.name + '·店员', username: body.name + 'clerk', password: '123456', created_at: isoNow() });
      return { status: 200, data: { ok: true, id: id } };
    }
    if (op === 'rename') {
      updateRow('stores', function (s) { return s.id === body.id; }, function (s) { s.name = body.name; });
      updateRow('users', function (u) { return u.id === 'mgr_' + body.id; }, function (u) { u.name = body.name + '·店长'; });
      updateRow('users', function (u) { return u.id === 'clerk_' + body.id; }, function (u) { u.name = body.name + '·店员'; });
      return { status: 200, data: { ok: true } };
    }
    if (op === 'toggle') { var st = body.active ? 1 : 0; updateRow('stores', function (s) { return s.id === body.id; }, function (s) { s.active = st; }); return { status: 200, data: { ok: true, active: st } }; }
    return { status: 400, data: { error: '未知操作' } };
  }

  // ---------- 商品与配方 ----------
  function apiProduct(user, body) {
    if (user.role !== 'hq') return { status: 403, data: { error: '仅总部可维护商品' } };
    var op = body.op;
    if (op === 'add') { var id = body.id || uid('p'); insertRow('products', { id: id, name: body.name, active: 1 }); return { status: 200, data: { ok: true, id: id } }; }
    if (op === 'bom') {
      var p = body.id;
      deleteRows('boms', function (b) { return b.pk.indexOf(p + '|') === 0; });
      var bomsData = body.boms || {};
      Object.keys(bomsData).forEach(function (k) {
        bomsData[k].forEach(function (bl) { insertRow('boms', { pk: p + '|' + k, material_id: bl.mid, qty: bl.qty }); });
      });
      return { status: 200, data: { ok: true } };
    }
    return { status: 400, data: { error: '未知操作' } };
  }

  // ---------- 加料维护 ----------
  function apiAddon(user, body) {
    if (user.role !== 'hq') return { status: 403, data: { error: '仅总部可维护加料' } };
    var op = body.op;
    if (op === 'add') { var id = body.id || uid('a'); insertRow('addons', { id: id, name: body.name, price: parseFloat(body.price) || 0, bom: JSON.stringify(body.bom || []) }); return { status: 200, data: { ok: true, id: id } }; }
    if (op === 'edit') {
      updateRow('addons', function (a) { return a.id === body.id; }, function (a) { a.name = body.name; a.price = parseFloat(body.price) || 0; a.bom = JSON.stringify(body.bom || []); });
      deleteRows('boms', function (b) { return b.pk === 'a|' + body.id; });
      (body.bom || []).forEach(function (ab) { insertRow('boms', { pk: 'a|' + body.id, material_id: ab.mid, qty: ab.qty }); });
      return { status: 200, data: { ok: true } };
    }
    if (op === 'del') { deleteRows('boms', function (b) { return b.pk === 'a|' + body.id; }); deleteRows('addons', function (a) { return a.id === body.id; }); return { status: 200, data: { ok: true } }; }
    return { status: 400, data: { error: '未知操作' } };
  }

  // ---------- 智能推荐订货 ----------
  function inTransitQty(storeId, mid) {
    var q = 0;
    filterRows('docs', function (r) { return r.store_id === storeId && r.type === 'req' && ['pending_manager', 'pending_hq', 'approved'].indexOf(r.status) >= 0; })
      .forEach(function (r) { JSON.parse(r.items || '[]').forEach(function (it) { if (it.mid === mid) q += parseFloat(it.qty || 0); }); });
    filterRows('docs', function (r) { return r.store_id === storeId && r.type === 'alloc' && r.status === 'pending_store_confirm'; })
      .forEach(function (r) { JSON.parse(r.items || '[]').forEach(function (it) { if (it.mid === mid) q += parseFloat(it.qty || 0); }); });
    return q;
  }
  function computeReco(storeId) {
    var boms = loadBoms();
    var since = dayAdd(today(), -14);
    var sales = filterRows('sales', function (s) { return s.store_id === storeId && s.date >= since; });
    var consume = {};
    sales.forEach(function (s) {
      var need = saleNeed(boms, s.pid, s.temp, s.size, JSON.parse(s.addons || '[]'), s.qty);
      Object.keys(need).forEach(function (mid) { consume[mid] = (consume[mid] || 0) + need[mid]; });
    });
    var items = [];
    T('materials').forEach(function (m) {
      var total = consume[m.id] || 0;
      var daily = total / 14;
      var need8 = Math.ceil(daily * 8);
      var inv = findRow('inventory', function (r) { return r.store_id === storeId && r.material_id === m.id; });
      var inT = inTransitQty(storeId, m.id);
      var suggest = Math.max(0, need8 - (inv ? inv.qty : 0) - inT);
      if (suggest > 0 && m.min_order > 0) suggest = Math.ceil(suggest / m.min_order) * m.min_order;
      items.push({ mid: m.id, name: m.name, unit: m.unit, daily: Math.round(daily * 100) / 100, need8: need8, have: Math.round(inv ? inv.qty : 0), inTransit: inT, suggest: suggest });
    });
    return items;
  }
  function apiReco(user, body) {
    if (body.op === 'gen') {
      if (user.role !== 'hq') return { status: 403, data: { error: '仅总部可生成推荐' } };
      var targets = (body.storeIds && body.storeIds.length) ? body.storeIds : filterRows('stores', function (s) { return s.active === 1; }).map(function (s) { return s.id; });
      var week = today();
      targets.forEach(function (sid) {
        var items = computeReco(sid);
        upsertRow('recos', { store_id: sid, week: week, data: JSON.stringify({ items: items }) }, function (r) { return r.store_id + '|' + r.week; });
      });
      return { status: 200, data: { ok: true } };
    }
    if (body.op === 'submit') {
      if (user.role === 'hq') return { status: 400, data: { error: '门店端提交' } };
      var store = findRow('stores', function (s) { return s.id === user.store_id; });
      if (!store || !store.active) return { status: 400, data: { error: '门店已停用' } };
      var items = (body.items || []).filter(function (x) { return parseFloat(x.qty) > 0; });
      if (!items.length) return { status: 400, data: { error: '请至少填写一项' } };
      var st = user.role === 'manager' ? 'pending_hq' : 'pending_manager';
      var id = uid('REQ-');
      var meta = { fromReco: true, log: [{ t: isoNow(), who: user.id, act: '据推荐订货单生成' }] };
      insertRow('docs', { id: id, type: 'req', store_id: user.store_id, status: st, creator: user.id, date: today(), items: JSON.stringify(items), meta: JSON.stringify(meta), created_at: isoNow(), updated_at: isoNow() });
      return { status: 200, data: { ok: true, id: id, status: st } };
    }
    return { status: 400, data: { error: '未知操作' } };
  }

  // ---------- 销售汇总 ----------
  function apiSummary(user, params) {
    var start = params.get('start') || dayAdd(today(), -7);
    var end = params.get('end') || today();
    var store = params.get('store');
    var sales = filterRows('sales', function (s) {
      if (s.date < start || s.date > end) return false;
      if (user.role !== 'hq') return s.store_id === user.store_id;
      if (store) return s.store_id === store;
      return true;
    });
    var byChannel = {}, byStore = {}, byDate = {};
    var totalIncome = 0, totalQty = 0;
    sales.forEach(function (s) {
      totalIncome += s.income; totalQty += s.qty;
      byChannel[s.channel] = byChannel[s.channel] || { income: 0, qty: 0 }; byChannel[s.channel].income += s.income; byChannel[s.channel].qty += s.qty;
      byStore[s.store_id] = byStore[s.store_id] || { income: 0, qty: 0 }; byStore[s.store_id].income += s.income; byStore[s.store_id].qty += s.qty;
      byDate[s.date] = byDate[s.date] || { income: 0, qty: 0 }; byDate[s.date].income += s.income; byDate[s.date].qty += s.qty;
    });
    return { status: 200, data: { ok: true, start: start, end: end, totalIncome: Math.round(totalIncome * 100) / 100, totalQty: totalQty, byChannel: byChannel, byStore: byStore, byDate: byDate, channels: CHANNELS } };
  }

  // ---------- 门店结算单 ----------
  function apiSettlement(user, params) {
    if (user.role !== 'hq') return { status: 403, data: { error: '仅总部可查看结算单' } };
    var month = params.get('month') || today().slice(0, 7);
    var docs = filterRows('docs', function (d) { return d.type === 'alloc' && d.date.indexOf(month) === 0; });
    var price = {}; T('materials').forEach(function (m) { price[m.id] = m.price; });
    var rows = [];
    docs.forEach(function (d) {
      var amt = 0;
      JSON.parse(d.items || '[]').forEach(function (it) { amt += parseFloat(it.qty || 0) * (price[it.mid] || 0); });
      rows.push({ id: d.id, store_id: d.store_id, date: d.date, status: d.status, amount: Math.round(amt * 100) / 100 });
    });
    var byStore = {};
    rows.forEach(function (r) { byStore[r.store_id] = byStore[r.store_id] || { amount: 0, count: 0 }; byStore[r.store_id].amount += r.amount; byStore[r.store_id].count++; });
    var total = 0; rows.forEach(function (r) { total += r.amount; });
    return { status: 200, data: { ok: true, month: month, rows: rows, byStore: byStore, total: Math.round(total * 100) / 100 } };
  }

  // ---------- 路由 ----------
  function dispatch(method, pathname, params, user, body) {
    // file:// 下 pathname 可能是 /C:/.../api/xxx，不能直接 slice(5)，需定位 /api/
    var idx = pathname.indexOf('/api/');
    var route = idx >= 0 ? pathname.slice(idx + 5) : pathname;
    if (route === 'login' && method === 'POST') return apiLogin(body);
    if (route === 'bootstrap' && method === 'GET') { if (!user) return { status: 401, data: { error: '未登录' } }; return { status: 200, data: bootstrap(user) }; }
    if (route === 'sale') { if (!user) return a401(); return apiCreateSale(user, body); }
    if (route === 'simulate') { if (!user) return a401(); return apiSimulate(user); }
    if (route === 'doc') { if (!user) return a401(); return apiCreateDoc(user, body); }
    if (route === 'alloc') { if (!user) return a401(); return apiCreateAlloc(user, body); }
    if (route === 'approve') { if (!user) return a401(); return apiApprove(user, params.get('id') || body.id, params.get('decision') || body.decision, params.get('note') || body.note); }
    if (route === 'confirm-alloc') { if (!user) return a401(); return apiConfirmAlloc(user, body.id || params.get('id')); }
    if (route === 'material') { if (!user) return a401(); return apiMaterial(user, body); }
    if (route === 'store') { if (!user) return a401(); return apiStore(user, body); }
    if (route === 'product') { if (!user) return a401(); return apiProduct(user, body); }
    if (route === 'addon') { if (!user) return a401(); return apiAddon(user, body); }
    if (route === 'reco') { if (!user) return a401(); return apiReco(user, body); }
    if (route === 'summary') { if (!user) return a401(); return apiSummary(user, params); }
    if (route === 'settlement') { if (!user) return a401(); return apiSettlement(user, params); }
    return { status: 404, data: { error: '未知接口: ' + route } };
  }
  function a401() { return { status: 401, data: { error: '未登录' } }; }

  // ---------- fetch 拦截 ----------
  function ResponseLike(body, status) {
    this.ok = (status >= 200 && status < 300);
    this.status = status;
    this._body = body;
  }
  ResponseLike.prototype.json = function () { return Promise.resolve(this._body); };
  ResponseLike.prototype.text = function () { return Promise.resolve(typeof this._body === 'string' ? this._body : JSON.stringify(this._body)); };

  var realFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null;
  function install() {
    window.fetch = function (input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (url.indexOf('/api/') === 0 || (realFetch && url.indexOf(location.origin + '/api/') === 0)) {
        var u = new URL(url, location.href);
        var method = (init && init.method) || 'GET';
        var auth = (init && init.headers && (init.headers['authorization'] || init.headers.Authorization)) || '';
        var token = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : null;
        var body = null;
        if (init && init.body) { try { body = JSON.parse(init.body); } catch (e) { body = {}; } }
        var user = getUser(token);
        var out = dispatch(method, u.pathname, u.searchParams, user, body || {});
        return Promise.resolve(new ResponseLike(out.data, out.status));
      }
      return realFetch ? realFetch(input, init) : Promise.reject(new Error('network unavailable'));
    };
    // 暴露重置入口（方便调试）
    window.__erpReset = function () { lsDel(LS_KEY); lsDel('erp_token'); STORE = loadStore(); return true; };
  }
  if (typeof window !== 'undefined') install();
})();

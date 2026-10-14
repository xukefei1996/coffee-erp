// 咖啡店进销存工作台 · 后端 Worker (Cloudflare Pages Functions)
// 处理 /api/* 全部请求；数据存 D1（绑定 env.DB）
// 权限模型：hq（总部）/ manager（店长）/ clerk（店员），按 store_id 隔离

const CHANNELS = [
  {id:"taobao", name:"淘宝闪购"}, {id:"meituan", name:"美团外卖"},
  {id:"miniapp", name:"堂食小程序"}, {id:"jd", name:"京东外卖"},
  {id:"group", name:"团购"}, {id:"cmb", name:"招商信用卡"},
  {id:"cash", name:"堂食现金"}, {id:"other", name:"其他"}
];

function json(data, status){ status = status || 200; return new Response(JSON.stringify(data), {status:status, headers:{"content-type":"application/json; charset=utf-8", "access-control-allow-origin":"*"}}); }
function uid(prefix){ return prefix + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }
function today(){ var d=new Date(); var m=("0"+(d.getMonth()+1)).slice(-2); var day=("0"+d.getDate()).slice(-2); return d.getFullYear()+"-"+m+"-"+day; }
function isoNow(){ return new Date().toISOString(); }
// 中国时区(UTC+8)辅助：周几(0=日..5=五) 与 日期字符串，避免 Worker 运行于 UTC 导致周五判定偏移
function cnDay(d){ var x=(d instanceof Date)?d:new Date(d); var y=new Date(x.getTime()+8*3600*1000); return y.getUTCDay(); }
function cnDate(d){ var x=(d instanceof Date)?d:new Date(d); var y=new Date(x.getTime()+8*3600*1000); return y.getUTCFullYear()+"-"+("0"+(y.getUTCMonth()+1)).slice(-2)+"-"+("0"+y.getUTCDate()).slice(-2); }
function dayAdd(dstr,n){ var p=dstr.split("-"); var dt=new Date(p[0],p[1]-1,p[2]); dt.setDate(dt.getDate()+n); return dt.getFullYear()+"-"+("0"+(dt.getMonth()+1)).slice(-2)+"-"+("0"+dt.getDate()).slice(-2); }

// D1 helpers
async function all(db,sql,params){ params=params||[]; return (await db.prepare(sql).bind.apply(db.prepare(sql), params).all()).results; }
async function get1(db,sql,params){ params=params||[]; return (await db.prepare(sql).bind.apply(db.prepare(sql), params).first()) || null; }
async function run(db,sql,params){ params=params||[]; await db.prepare(sql).bind.apply(db.prepare(sql), params).run(); }
async function runMeta(db,sql,params){ params=params||[]; return await db.prepare(sql).bind.apply(db.prepare(sql), params).run(); } // 返回 {meta:{changes}} 用于判断条件插入是否生效
// 订货单物料明细归一化签名：忽略顺序、忽略零数量，用于「两条一模一样」的重复判定
function normItems(items){ return (items||[]).filter(function(it){ return parseFloat(it.qty)>0; }).map(function(it){ return it.mid+":"+(parseFloat(it.qty)||0); }).sort().join("|"); }
function cleanUser(u){ if(!u) return u; var c={}; for(var k in u){ if(k!=="password") c[k]=u[k]; } return c; }

// 鉴权
function tokenFromReq(req){ var h=req.headers.get("authorization")||""; return h.indexOf("Bearer ")===0 ? h.slice(7) : null; }
async function getUser(env,token){
  if(!token) return null;
  var s=await get1(env.DB,"select user_id,expires from sessions where token=?",[token]);
  if(!s) return null;
  if(new Date(s.expires) < new Date()) return null;
  return await get1(env.DB,"select * from users where id=?",[s.user_id]);
}
function roleOf(u){ return u ? u.role : null; }
function ownStore(u, storeId){ return u.role==="hq" || u.store_id===storeId; }

// ==================================================================
// 钉钉提醒（事件触发，无轮询）
// 说明：钉钉/微信内置浏览器均不支持网页推送，消息只能走钉钉自身通道。
// 当前阶段：自定义群机器人（加签）；后续可加企业内部应用「工作通知」。
// ==================================================================
var APP_URL_DEFAULT = "https://coffee-erp-8cv.pages.dev";
async function getSettings(env){
  var rows=await all(env.DB,"select k,v from settings");
  var s={};
  rows.forEach(function(r){ s[r.k]=r.v; });
  return s;
}
async function setSetting(env,k,v){
  await run(env.DB,"insert into settings(k,v) values(?,?) on conflict(k) do update set v=excluded.v",[k,v]);
}
function b64fromBytes(arr){
  var s="";
  for(var i=0;i<arr.length;i++) s+=String.fromCharCode(arr[i]);
  return btoa(s);
}
// 钉钉自定义机器人加签：HMAC-SHA256(timestamp + "\n" + secret) → base64 → urlencode
async function dingSignUrl(hook, secret){
  if(!secret) return hook;
  var ts=Date.now();
  var enc=new TextEncoder();
  var key=await crypto.subtle.importKey("raw", enc.encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  var sig=await crypto.subtle.sign("HMAC", key, enc.encode(ts+"\n"+secret));
  return hook + (hook.indexOf("?")>=0 ? "&" : "?") + "timestamp=" + ts + "&sign=" + encodeURIComponent(b64fromBytes(new Uint8Array(sig)));
}
// 发送钉钉消息（text 类型：text 才支持 @ 到具体手机号，markdown 不支持 @）
async function dingSend(env, content, atMobiles){
  var st=await getSettings(env);
  var hook=(st.ding_webhook||"").trim();
  if(!hook) return {sent:false, reason:"未配置机器人地址"};
  if(st.ding_on==="0") return {sent:false, reason:"提醒已关闭"};
  var url=await dingSignUrl(hook, (st.ding_secret||"").trim());
  var at=[];
  (atMobiles||[]).forEach(function(p){ p=(p||"").trim(); if(p && at.indexOf(p)<0) at.push(p); });
  var payload={ msgtype:"text", text:{ content: content }, at:{ atMobiles:at, isAtAll:false } };
  var resp=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  var txt=""; try{ txt=await resp.text(); }catch(e){}
  return {sent:true, ok:resp.ok, resp:txt.slice(0,300)};
}
// 单据事件推送：按单据状态自动解析要 @ 的人（总部 / 本店店长 / 本店店长+店员）
var DOC_LABEL={req:"订货单", stk:"盘点单", ret:"退货单", alloc:"配货单"};
var STATUS_TITLE={pending_manager:"待店长审批", pending_hq:"待总部审批", pending_store_confirm:"待门店收货", diff_pending_hq:"收货差异·待复核"};
async function notifyDoc(env, d, note){
  try{
    var st=await getSettings(env);
    if(!(st.ding_webhook||"").trim() || st.ding_on==="0") return;
    var q=null, args=[];
    if(d.status==="pending_hq" || d.status==="diff_pending_hq"){ q="select phone from users where role='hq'"; }
    else if(d.status==="pending_manager"){ q="select phone from users where store_id=? and role='manager'"; args=[d.store_id]; }
    else if(d.status==="pending_store_confirm"){ q="select phone from users where store_id=? and role in ('manager','clerk')"; args=[d.store_id]; }
    var phones=[];
    if(q){
      var us=await all(env.DB,q,args);
      us.forEach(function(u){ var p=(u.phone||"").trim(); if(p && phones.indexOf(p)<0) phones.push(p); });
    }
    var sto=await get1(env.DB,"select name from stores where id=?",[d.store_id]);
    var items=(typeof d.items==="string") ? JSON.parse(d.items||"[]") : (d.items||[]);
    var title="【"+(STATUS_TITLE[d.status]||"单据提醒")+"】"+(DOC_LABEL[d.type]||d.type)+" "+d.id;
    var base=(st.app_url||"").trim()||APP_URL_DEFAULT;
    var lines=[
      "门店："+(sto?sto.name:d.store_id),
      "日期："+d.date+" · 共 "+items.length+" 项"
    ];
    if(note) lines.push(note);
    lines.push("点击处理："+base+"/?doc="+encodeURIComponent(d.id));
    var content=title+"\n"+lines.join("\n");
    if(phones.length) content+="\n"+phones.map(function(p){ return "@"+p; }).join(" ");
    await dingSend(env, content, phones);
  }catch(e){ /* 提醒失败不影响业务主流程 */ }
}

// BOM
async function loadBoms(db){
  var rows=await all(db,"select pk, material_id, qty from boms");
  var map={};
  rows.forEach(function(r){ (map[r.pk]=map[r.pk]||[]).push({mid:r.material_id, qty:r.qty}); });
  return map;
}
function saleNeed(boms, pid, temp, size, addonIds, qty){
  var t = (temp === "less" || temp === "noice") ? "ice" : temp; // 少冰/去冰沿用「冰」的配方（仅冰量不同，咖啡/牛奶/包装用量不变）
  var need={};
  var list=boms[pid+"|"+t+"|"+size]||[];
  list.forEach(function(b){ need[b.mid]=(need[b.mid]||0)+b.qty*qty; });
  (addonIds||[]).forEach(function(aid){
    var list2=boms["a|"+aid]||[];
    list2.forEach(function(b){ need[b.mid]=(need[b.mid]||0)+b.qty*qty; });
  });
  return need;
}

// bootstrap：按角色返回前端可见数据切片
async function bootstrap(env, user){
  var db=env.DB;
  // 性能索引（IF NOT EXISTS，每次启动检查代价仅数行）：D1 免费版按「扫描行数」计费配额，
  // 无索引时 where store_id=? and date>=? 会全表扫描，实际消耗是返回行数的数十倍
  try { await run(db, "create index if not exists idx_sales_store_date on sales(store_id, date)"); } catch(e){}
  try { await run(db, "create index if not exists idx_sales_date on sales(date)"); } catch(e){}
  try { await run(db, "create index if not exists idx_docs_store_created on docs(store_id, created_at)"); } catch(e){}
  try { await run(db, "create index if not exists idx_docs_created on docs(created_at)"); } catch(e){}
  // 增量(delta)拉取索引：前端只拉「上次同步后变化的单据/销售」，避免每次版本变化全量重拉历史
  try { await run(db, "create index if not exists idx_docs_updated_at on docs(updated_at)"); } catch(e){}
  try { await run(db, "create index if not exists idx_sales_store_created on sales(store_id, created_at)"); } catch(e){}
  try { await run(db, "create index if not exists idx_sales_created_at on sales(created_at)"); } catch(e){}
  // 新增列（幂等）：物料排序顺序 + 是否参与每周盘点（旧库无列时不阻断启动）
  try { await run(db, "ALTER TABLE materials ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch(e){}
  try { await run(db, "ALTER TABLE materials ADD COLUMN in_stocktake INTEGER DEFAULT 1"); } catch(e){}
  // 一次性迁移：给包材设置独立盘点单位=基础单位(个/根/只)，避免按订货"箱"盘点出现"几百箱"
  // 仅在首次启动执行一次（settings 标记 mig_stk_pkg_v1 守卫），之后跳过
  try{
    var _ms=await getSettings(env);
    if(!_ms["mig_stk_pkg_v1"]){
      var mats=await all(db,"select id,name,unit,stk_unit from materials where stk_unit is null or stk_unit=''");
      var PKG=["杯托","单杯袋","双杯袋","吸管","封口","杯盖","盖","勺","纸巾","手套","打包","搅拌","签","棒","膜","杯套","外卖袋","保温袋","取杯","叉子","叉"];
      for(var i=0;i<mats.length;i++){
        var nm=mats[i].name||"";
        var isPkg=PKG.some(function(k){ return nm.indexOf(k)>=0; });
        if(isPkg){ await run(db,"update materials set stk_unit=?, stk_qty=1 where id=?",[(mats[i].unit||"个"), mats[i].id]); }
      }
      await setSetting(env,"mig_stk_pkg_v1","1");
    }
  }catch(e){ /* 迁移失败不阻断启动 */ }
  // 一次性迁移：恢复物料原始顺序（按入库 rowid），修正此前 sort_order 默认 0 导致按 id 字典序乱序的问题
  try{
    var _ms2=await getSettings(env);
    if(!_ms2["mig_sort_orig_v1"]){
      var _mats=await all(db,"select id from materials order by rowid");
      for(var z=0;z<_mats.length;z++){ await run(db,"update materials set sort_order=? where id=?",[z+1,_mats[z].id]); }
      await setSetting(env,"mig_sort_orig_v1","1");
    }
  }catch(e){ /* 迁移失败不阻断启动 */ }
  // 一次性迁移：门店7（一个短篇手冲特别店 / store_id=sywdiwtf6t3hc）账号改为短账号 s7mgr/s7clerk，符合「S+编号」规则，便于记忆与输入
  try{
    var _ms3=await getSettings(env);
    if(!_ms3["mig_store7_short_acct_v1"]){
      await run(db,"update users set username='s7mgr' where store_id='sywdiwtf6t3hc' and role='manager'");
      await run(db,"update users set username='s7clerk' where store_id='sywdiwtf6t3hc' and role='clerk'");
      await setSetting(env,"mig_store7_short_acct_v1","1");
    }
  }catch(e){ /* 迁移失败不阻断启动 */ }
  // 一次性迁移：门店7 的 store_id 从随机串 sywdiwtf6t3hc 统一为 s7（与账号 s7mgr 对齐，新店无业务数据，安全）；避免将来自动编号到 s7 时撞号
  try{
    var _ms4=await getSettings(env);
    if(!_ms4["mig_store7_id_v1"]){
      var _s7=await get1(db,"select id from stores where id='s7'");
      if(!_s7){
        await run(db,"update stores set id='s7' where id='sywdiwtf6t3hc'");
        await run(db,"update users set id='mgr_s7', store_id='s7' where id='mgr_sywdiwtf6t3hc'");
        await run(db,"update users set id='clerk_s7', store_id='s7' where id='clerk_sywdiwtf6t3hc'");
        // 同步该店可能已有的单据/销售/库存引用，防止孤儿数据
        await run(db,"update docs set store_id='s7' where store_id='sywdiwtf6t3hc'");
        await run(db,"update sales set store_id='s7' where store_id='sywdiwtf6t3hc'");
        await run(db,"update inventory set store_id='s7' where store_id='sywdiwtf6t3hc'");
      }
      await setSetting(env,"mig_store7_id_v1","1");
    }
  }catch(e){ /* 迁移失败不阻断启动 */ }
  var vers=await scopeVers(db);
  var base=await bsBase(db), ops=await bsOps(db, user), inv=await bsInv(db, user);
  return Object.assign({}, base, ops, inv, { currentUser:cleanUser(user), vers:vers, dataVer:vers.ver });
}

// ---------- 分域数据（供 /api/bs 按需拉取 + bootstrap 复用） ----------
// 背景：D1 免费版每日 500 万行读取。营业时段销售单持续写入 → 若每次写都让所有在线设备拉全量，
// 单次全量约 2300+ 行（销售占大头），多设备 × 每分钟即烧光配额。拆成三个独立版本域：
//   base = 门店/物料/商品/加料/BOM（极少变化）；ops = 单据/推荐（审批实时性要求高）；
//   inv  = 库存/销售（变化频繁但对实时性要求低，前端做节流）
async function scopeVers(db){
  var rows=await all(db,"select k,v from settings where k in ('data_ver','ver_base','ver_docs','ver_inv')");
  var m={};
  rows.forEach(function(r){ m[r.k]=r.v; });
  return { ver:m.data_ver||"0", base:m.ver_base||"0", docs:m.ver_docs||"0", inv:m.ver_inv||"0" };
}
async function bsBase(db){
  var stores=await all(db,"select * from stores");
  var materials=await all(db,"select * from materials order by sort_order, id");
  var products=await all(db,"select * from products");
  var addons=await all(db,"select * from addons");
  var boms=await loadBoms(db);
  return { stores:stores, materials:materials, products:products, addons:addons, boms:boms };
}
async function bsOps(db, user, since){
  var docs, recos={};
  // 增量(delta)：since 非空时只返回「该时间之后变化」的单据（历史已审批/驳回的单据 updated_at 不再变化，不会被重拉）
  var cond, params=[];
  if(user.role==="hq"){ cond="(status != 'draft' or (type='req' and json_extract(meta,'$.byHq')=1))"; }
  else { cond="store_id=?"; params=[user.store_id]; }
  if(since){ cond+=" and updated_at > ?"; params.push(since); }
  var lim = user.role==="hq" ? 600 : 300;
  docs=await all(db,"select * from docs where "+cond+" order by created_at desc limit "+lim, params);
  var recoRows=await all(db,"select store_id, week, data from recos");
  recoRows.forEach(function(r){ var d=JSON.parse(r.data||"{}"); recos[r.store_id]={week:r.week, items:d.items||[]}; });
  docs.forEach(function(d){ d.items=JSON.parse(d.items||"[]"); d.meta=JSON.parse(d.meta||"{}"); });
  return { docs:docs, recos:recos };
}
async function bsInv(db, user, salesSince){
  var inventory={};
  var invRows=await all(db,"select store_id, material_id, qty from inventory");
  invRows.forEach(function(r){ (inventory[r.store_id]=inventory[r.store_id]||{})[r.material_id]=r.qty; });
  var sales;
  if(salesSince){
    // 增量(delta)：只返回该时间之后新上报的销售（含店长 7 天内补录，因其 created_at=now），不拉历史销售
    if(user.role==="hq"){ sales=await all(db,"select * from sales where created_at > ?",[salesSince]); }
    else { sales=await all(db,"select * from sales where store_id=? and created_at > ?",[user.store_id,salesSince]); }
  } else {
    // 销售窗口：门店端仅用于「最近销售」列表，3 天足够（30 天汇总走 /api/summary 服务端聚合）；
    // 总部看板毛利分析依赖 30 天明细，保留（HQ 在线设备少，拉取频次低）
    var since = user.role==="hq" ? dayAdd(today(),-30) : dayAdd(today(),-3);
    if(user.role==="hq"){ sales=await all(db,"select * from sales where date>=?",[since]); }
    else { sales=await all(db,"select * from sales where store_id=? and date>=?",[user.store_id,since]); }
  }
  sales.forEach(function(s){ s.addons=JSON.parse(s.addons||"[]"); });
  return { inventory:inventory, sales:sales };
}

// 登录
async function apiLogin(env, body){
  var u=await get1(env.DB,"select * from users where username=?",[body.username||""]);
  if(!u || u.password!==(body.password||"")){ return json({error:"用户名或密码错误"}, 401); }
  var token=uid("tok_");
  var expires=new Date(Date.now()+1000*60*60*24*7).toISOString();
  await run(env.DB,"insert into sessions(token,user_id,expires) values(?,?,?)",[token,u.id,expires]);
  return json({token:token, user:cleanUser(u)});
}

// 销售出库（支持一单多品批次 + 外卖实付分摊）
async function apiCreateSale(env, user, body){
  if(user.role==="hq") return json({error:"总部账号无门店销售"}, 400);
  var store=await get1(env.DB,"select * from stores where id=?",[user.store_id]);
  if(!store || !store.active) return json({error:"门店已停用，无法出库"}, 400);
  // 营业日期：默认今天；店长可补录近 7 天历史（不能未来、不能超 7 天、店员不可补录）
  var reqDate = body.date ? (''+body.date).trim() : '';
  var saleDate = today();
  if(reqDate && reqDate !== today()){
    if(user.role!=="manager") return json({error:"仅店长可补录历史销售"}, 403);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(reqDate)) return json({error:"营业日期格式错误"}, 400);
    if(reqDate > today()) return json({error:"营业日期不能晚于今天"}, 400);
    if(reqDate < dayAdd(today(), -7)) return json({error:"仅允许补录近 7 天销售，更早需总部协助"}, 400);
    saleDate = reqDate;
  }
  // 兼容旧接口（单品 body.pid）与多品（body.items[]）
  var items = (body.items && body.items.length) ? body.items : null;
  if(!items){
    items = [{ pid: body.pid, temp: body.temp||"hot", size: body.size||"M", addons: body.addons||[], qty: (parseInt(body.qty,10)||1), income: parseFloat(body.income)||0 }];
  }
  if(!items.length) return json({error:"请至少选择一件商品"}, 400);
  var products = await all(env.DB,"select * from products");
  var addons = await all(env.DB,"select * from addons");
  var boms = await loadBoms(env.DB);
  var byId = function(arr,id){ for(var i=0;i<arr.length;i++){ if(arr[i].id===id) return arr[i]; } return null; };
  // 计算每行的标准小计（用于外卖实付分摊权重）
  var stdSum = 0;
  items.forEach(function(it){
    var p = byId(products, it.pid);
    var std = (p && p.price ? p.price : 25) * (it.size==="L" ? 1.15 : 1) * (parseInt(it.qty,10)||1);
    (it.addons||[]).forEach(function(aid){ var a=byId(addons,aid); if(a) std += a.price*(parseInt(it.qty,10)||1); });
    it._std = std; stdSum += std;
  });
  // 大杯校验：L 杯必须有对应配方。未配 L 配方时出库不扣料、成本按 0 计，毛利率会虚高，故直接拦截
  for(var k0=0;k0<items.length;k0++){
    var it0=items[k0];
    if((it0.size||"M")==="L"){
      var t0=(it0.temp==="less"||it0.temp==="noice")?"ice":(it0.temp||"hot");
      if(!(boms[it0.pid+"|"+t0+"|L"]||[]).length){
        var p0=byId(products, it0.pid);
        return json({error:"「"+(p0?p0.name:it0.pid)+"」未配置大杯配方（大杯出库将按 0 成本核算，毛利率虚高），暂仅支持标准杯型。如需启用大杯，请先在总部「商品与配方」补配大杯配方。"}, 400);
      }
    }
  }
  // 负库存预检：扣减后将不足的物料，要求前端二次确认（confirm_shortage）后方可出库；
  // 确认后保留负库存记录——负库存是「店员漏登记/配方配错/入库漏记」最有价值的预警信号，供盘点校准
  if(!body.confirm_shortage){
    var needAll={};
    items.forEach(function(it){
      var nd=saleNeed(boms, it.pid, it.temp||"hot", it.size||"M", it.addons||[], parseInt(it.qty,10)||1);
      Object.keys(nd).forEach(function(mid){ needAll[mid]=(needAll[mid]||0)+nd[mid]; });
    });
    var shorts=[];
    var mids=Object.keys(needAll);
    for(var s0=0;s0<mids.length;s0++){
      var mid0=mids[s0];
      var have0=(await get1(env.DB,"select qty from inventory where store_id=? and material_id=?",[user.store_id,mid0]))||{qty:0};
      if(needAll[mid0]>(have0.qty||0)) shorts.push({mid:mid0, have:have0.qty||0, need:needAll[mid0]});
    }
    if(shorts.length){
      var mats=await all(env.DB,"select * from materials");
      var detail=shorts.map(function(x){ var m=byId(mats,x.mid); return (m?m.name:x.mid)+"（现存"+x.have+"，本单需"+x.need+"）"; }).join("、");
      return json({error:"库存不足："+detail+"。负库存是漏登记/配错预警信号，如确认仍要出库请重试并二次确认。", shortage:shorts}, 400);
    }
  }
  var orderTotal = (body.order_total!=null && body.order_total!=="") ? parseFloat(body.order_total) : null;
  var channel = body.channel||"other";
  var orderNo = uid("ord_");
  var ids = [];
  for(var k=0;k<items.length;k++){
    var it = items[k];
    var pid = it.pid, temp = it.temp||"hot", size = it.size||"M";
    var addonIds = it.addons||[];
    var qty = parseInt(it.qty,10)||1;
    // 收入：有实付总额则按标准占比分摊（外卖折扣场景）；否则用传入 income 或标准小计
    var income;
    if(orderTotal != null && stdSum > 0){ income = Math.round(it._std/stdSum*orderTotal*100)/100; }
    else { income = (it.income!=null && it.income!=="") ? parseFloat(it.income) : it._std; }
    var need = saleNeed(boms, pid, temp, size, addonIds, qty);
    var keys = Object.keys(need);
    for(var i=0;i<keys.length;i++){
      var mid = keys[i];
      var have = (await get1(env.DB,"select qty from inventory where store_id=? and material_id=?",[user.store_id,mid]))||{qty:0};
      var newq = (have.qty||0) - need[mid];
      await run(env.DB,"insert into inventory(store_id,material_id,qty) values(?,?,?) on conflict(store_id,material_id) do update set qty=excluded.qty",[user.store_id,mid,newq]);
    }
    var id = uid("sale_");
    await run(env.DB,"insert into sales(id,store_id,date,pid,temp,size,addons,qty,income,channel,created_at,order_no) values(?,?,?,?,?,?,?,?,?,?,?,?)",[id,user.store_id,saleDate,pid,temp,size,JSON.stringify(addonIds),qty,income,channel,isoNow(),orderNo]);
    ids.push(id);
  }
  return json({ok:true, ids:ids, order_no:orderNo});
}

// 模拟渠道同步（演示自动出库）
async function apiSimulate(env, user){
  if(user.role==="hq") return json({error:"请在门店账号下演示"}, 400);
  var boms=await loadBoms(env.DB);
  var prods=await all(env.DB,"select * from products where active=1");
  var adds=await all(env.DB,"select * from addons");
  var temps=["hot","ice","less"], sizes=["M","L"];
  var basePrice={p1:28,p2:22,p3:26,p4:30,p5:32};
  var n=14+Math.floor(Math.random()*8);
  var totalIncome=0,totalQty=0,chCount={};
  for(var i=0;i<n;i++){
    var p=prods[Math.floor(Math.random()*prods.length)];
    var temp=temps[Math.floor(Math.random()*2)];
    var size=sizes[Math.floor(Math.random()*2)];
    var ch=CHANNELS[Math.floor(Math.random()*CHANNELS.length)].id;
    var addonIds=[];
    adds.forEach(function(a){ if(Math.random()<0.25) addonIds.push(a.id); });
    var qty=1+Math.floor(Math.random()*2);
    var gross=(p.price||basePrice[p.id]||25)+(size==="L"?4:0);
    adds.forEach(function(a){ if(addonIds.indexOf(a.id)>=0) gross+=a.price; });
    var net=Math.round(gross*(0.82+Math.random()*0.08)*qty*100)/100;
    var need=saleNeed(boms,p.id,temp,size,addonIds,qty);
    var keys=Object.keys(need);
    for(var j=0;j<keys.length;j++){
      var mid=keys[j];
      var have=(await get1(env.DB,"select qty from inventory where store_id=? and material_id=?",[user.store_id,mid]))||{qty:0};
      var newq=(have.qty||0)-need[mid];
      await run(env.DB,"insert into inventory(store_id,material_id,qty) values(?,?,?) on conflict(store_id,material_id) do update set qty=excluded.qty",[user.store_id,mid,newq]);
    }
    var id=uid("sale_");
    await run(env.DB,"insert into sales(id,store_id,date,pid,temp,size,addons,qty,income,channel,created_at) values(?,?,?,?,?,?,?,?,?,?,?)",[id,user.store_id,today(),p.id,temp,size,JSON.stringify(addonIds),qty,net,ch,isoNow()]);
    totalIncome+=net; totalQty+=qty; chCount[ch]=(chCount[ch]||0)+1;
  }
  return json({ok:true, count:n, totalIncome:totalIncome, totalQty:totalQty, chCount:chCount});
}

// 撤销销售出库：反向加回 BOM 消耗的库存，再删除销售记录（支持整单 order_no 撤销）
async function apiDeleteSale(env, user, body){
  if(user.role==="hq") return json({error:"总部不可操作门店出库"}, 400);
  var list;
  if(body.order_no){
    list = await all(env.DB,"select * from sales where order_no=? and store_id=?",[body.order_no, user.store_id]);
  } else {
    var s = await get1(env.DB,"select * from sales where id=?",[body.id]);
    list = s ? [s] : [];
  }
  if(!list.length) return json({error:"记录不存在"}, 404);
  var boms = await loadBoms(env.DB);
  for(var n=0;n<list.length;n++){
    var s = list[n];
    if(s.store_id !== user.store_id) return json({error:"无权限"}, 403);
    var addonIds = JSON.parse(s.addons || "[]");
    var need = saleNeed(boms, s.pid, s.temp, s.size, addonIds, s.qty);
    var keys = Object.keys(need);
    for(var i=0;i<keys.length;i++){
      var mid = keys[i];
      var have = (await get1(env.DB,"select qty from inventory where store_id=? and material_id=?",[user.store_id, mid])) || {qty:0};
      var newq = (have.qty||0) + need[mid];
      await run(env.DB,"insert into inventory(store_id,material_id,qty) values(?,?,?) on conflict(store_id,material_id) do update set qty=excluded.qty",[user.store_id, mid, newq]);
    }
    await run(env.DB,"delete from sales where id=?",[s.id]);
  }
  return json({ok:true, removed:list.length});
}

// 本周一（中国时区）以来该店已提交的常规订货单（非草稿/非驳回/非紧急）；返回单号或 null
async function regularReqThisWeek(env, storeId){
  var y=new Date(Date.now()+8*3600*1000);
  var dow=y.getUTCDay();            // 0=周日
  var minus=(dow+6)%7;              // 距本周一的天数
  var monday=new Date(y.getTime()-minus*86400000);
  var mondayStr=monday.getUTCFullYear()+"-"+("0"+(monday.getUTCMonth()+1)).slice(-2)+"-"+("0"+(monday.getUTCDate())).slice(-2);
  var rows=await all(env.DB,"select id from docs where store_id=? and type='req' and date>=? and status not in ('draft','rejected') and (meta is null or json_extract(meta,'$.urgent') is not 1) and (meta is null or json_extract(meta,'$.byHq') is not 1) order by created_at limit 1",[storeId,mondayStr]);
  return rows.length?rows[0].id:null;
}

// ===== 物流费规则 =====
// 常规订货：单门店每周一次免费配送，永不收物流费（含撤回后重新提交，仍视为同一次免费配送）。
// 紧急订货：默认加收 FEE_STANDARD 元；但当订货总价达到 FEE_FREE_MIN_TOTAL 时免收物流费。
var FEE_STANDARD = 80;
var FEE_FREE_MIN_TOTAL = 2000; // 紧急订货总价达到此值（含）免物流费
// 单据项快照开关：临时隔离时置 false（用户手动恢复历史原价期间，避免新单被快照写死）
var SNAPSHOT_ENABLED = true; // 快照机制已重新开启（用户已于 coffee-erp-git 站改回物料原价，机制恢复）
// 单据项快照：建单/改单时把物料名称与单价写入 items，避免后续改物料价/名污染历史单据与结算
// （业务规则：历史订货/配货/退货单的内容与价格冻结，禁止被后续物料变更篡改；仅新建单以当时最新为准）
function snapItems(items, matsMap){
  if(!SNAPSHOT_ENABLED) return items; // 隔离态：不写快照，新单实时引用物料价
  return (items||[]).map(function(it){
    var m = matsMap[it.mid];
    var o = {}; for(var k in it) o[k]=it[k];
    o.name  = (it.name  != null) ? it.name  : (m ? m.name  : it.mid);
    o.price = (it.price != null) ? it.price : (m ? m.price : 0);
    return o;
  });
}

// 读取单据项单价：优先用快照，缺则回退实时（兼容历史未快照单据）
function itemPrice(it, matsMap){
  if(it.price != null) return parseFloat(it.price) || 0;
  var m = matsMap && matsMap[it.mid]; return m ? (parseFloat(m.price)||0) : 0;
}
// 读取单据项名称：优先快照
function itemName(it, matsMap){
  if(it.name != null) return it.name;
  var m = matsMap && matsMap[it.mid]; return m ? m.name : it.mid;
}
// 返回本次应加收的物流费（0 表示免收）
function decideLogisticsFee(urgent, items, matsMap){
  if(!urgent) return 0; // 常规订货免费
  var total=calcOrderTotal(items, matsMap);
  return total>=FEE_FREE_MIN_TOTAL ? 0 : FEE_STANDARD;
}

// 新建单据（订货 / 盘点 / 退货）
// 门店撤回已提交的单据（盘点/订货/退货通用）：待审状态 → 草稿，可修改后重新提交
// 删除草稿/已驳回单据：门店（本店，店长+店员）与总部均可。草稿未入库、驳回未入账，删除无库存影响
async function apiDelDoc(env, user, body){
  var id=body.id;
  if(!id) return json({error:"缺少单据号"}, 400);
  var d=await get1(env.DB,"select * from docs where id=?",[id]);
  if(!d) return json({error:"单据不存在"}, 404);
  if(user.role!=="hq" && d.store_id!==user.store_id) return json({error:"仅可删除本店单据"}, 403);
  if(d.status!=="draft" && d.status!=="rejected") return json({error:"仅草稿或已驳回的单据可删除（已通过单据请走撤回/作废流程）"}, 400);
  await run(env.DB,"delete from docs where id=?",[id]);
  return json({ok:true});
}

async function apiWithdrawDoc(env, user, body){
  var id=body.id;
  if(!id) return json({error:"缺少单据号"}, 400);
  var d=await get1(env.DB,"select * from docs where id=?",[id]);
  if(!d) return json({error:"单据不存在"}, 404);
  // 总部：撤回自己直发、且尚未生成配货单的订货单（已配货的单需先作废配货单，避免账目对不上）
  if(user.role==="hq"){
    var hm=JSON.parse(d.meta||"{}");
    if(d.type!=="req" || !hm.byHq) return json({error:"总部仅可撤回自己直发的订货单"}, 400);
    if(d.status!=="approved") return json({error:"该直发单当前状态不可撤回（"+d.status+"）。已生成配货单的单据请先作废配货单再撤回"}, 400);
    hm.log=hm.log||[];
    hm.log.push({t:isoNow(), who:user.id, act:"总部撤回直发订货单，转为草稿（可修改后重新下发）"});
    await run(env.DB,"update docs set status='draft', meta=?, updated_at=? where id=?",[JSON.stringify(hm),isoNow(),id]);
    return json({ok:true, status:"draft"});
  }
  if(d.store_id!==user.store_id) return json({error:"非本店单据"}, 403);
  if(d.status!=="pending_manager" && d.status!=="pending_hq") return json({error:"仅待审核状态的单据可撤回（当前："+d.status+"）"}, 400);
  // 当前审批人不应撤回自己的待审单，应直接通过或驳回
  if(d.status==="pending_manager" && user.role==="manager") return json({error:"您是此单审批人，请直接通过或驳回"}, 400);
  var meta=JSON.parse(d.meta||"{}"); meta.log=meta.log||[];
  meta.log.push({t:isoNow(), who:user.id, act:"门店撤回单据，转为草稿"});
  await run(env.DB,"update docs set status='draft', meta=?, updated_at=? where id=?",[JSON.stringify(meta),isoNow(),id]);
  return json({ok:true, status:"draft"});
}

async function apiCreateDoc(env, user, body){
  if(body.op==="withdraw") return await apiWithdrawDoc(env, user, body);
  if(body.op==="del") return await apiDelDoc(env, user, body);
  var type=body.type;
  if(type!=="req" && type!=="stk" && type!=="ret") return json({error:"不支持的单据类型"}, 400);
  // 总部直接下发订货单：仅限订货单，指定门店，免审批直接「已通过」，可立即配货；
  // 不占门店每周常规订货次数（不加收紧急物流费），豁免最低订货量（总部裁量）
  if(user.role==="hq"){
    // 物料价/名表（snapItems 需要，供总部直发单快照 name+price；此前漏建导致 undefined 报错）
    var hqMats=await all(env.DB,"select * from materials"); var matsMap={}; hqMats.forEach(function(m){matsMap[m.id]=m;});
    if(type!=="req") return json({error:"总部仅可直接下发订货单"}, 400);
    // 编辑总部自己撤回的直发草稿：修改数量/门店后重新下发，仍免审批、不占门店常规次数、豁免最低订货量
    if(body.id){
      var hqEx=await get1(env.DB,"select * from docs where id=?",[body.id]);
      if(!hqEx || hqEx.type!=="req" || hqEx.status!=="draft") return json({error:"仅可编辑总部撤回的直发草稿"}, 400);
      var edItems=body.items||[];
      if(!edItems.length) return json({error:"请至少填写一项"}, 400);
      var edSid=body.store_id||hqEx.store_id;
      var edSto=await get1(env.DB,"select * from stores where id=?",[edSid]);
      if(!edSto || !edSto.active) return json({error:"门店不存在或已停用"}, 400);
      var edMeta=JSON.parse(hqEx.meta||"{}");
      edMeta.byHq=true; edMeta.log=edMeta.log||[];
      edMeta.log.push({t:isoNow(), who:user.id, act:"总部修改后重新下发直发订货单"});
      await run(env.DB,"update docs set store_id=?, items=?, meta=?, status='approved', updated_at=? where id=?",[edSid,JSON.stringify(snapItems(edItems, matsMap)),JSON.stringify(edMeta),isoNow(),body.id]);
      return json({ok:true, id:body.id, status:"approved"});
    }
    if(body.draft) return json({error:"总部直发单无需保存草稿"}, 400);
    var sid=body.store_id;
    if(!sid) return json({error:"请选择门店"}, 400);
    var sto=await get1(env.DB,"select * from stores where id=?",[sid]);
    if(!sto || !sto.active) return json({error:"门店不存在或已停用"}, 400);
    var hqItems=body.items||[];
    if(!hqItems.length) return json({error:"请至少填写一项"}, 400);
    // 防重复：同一门店已存在内容相同的未完结总部直发单，则阻断重复下发（避免「两条一模一样」的订货单）
    var hqSig = normItems(hqItems);
    var dupHq = await all(env.DB,"select id,status,items from docs where store_id=? and type='req' and status in ('pending_manager','pending_hq','approved') and json_extract(meta,'$.byHq')=1",[sid]);
    var sameHq = dupHq.find(function(r){ return normItems(JSON.parse(r.items||"[]"))===hqSig; });
    if(sameHq){ return json({error:"该门店已存在内容相同的未完结总部直发订货单（"+sameHq.id+" · "+sameHq.status+"），请勿重复下发"}, 400); }
    var hqMeta=body.meta||{};
    hqMeta.byHq=true;
    hqMeta.log=[{t:isoNow(), who:user.id, act:"总部直接下发订货单（免审批，指定门店）"}];
    var hqId=uid("REQ-");
    await run(env.DB,"insert into docs(id,type,store_id,status,creator,date,items,meta,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)",[hqId,"req",sid,"approved",user.id,today(),JSON.stringify(snapItems(hqItems, matsMap)),JSON.stringify(hqMeta),isoNow(),isoNow()]);
    return json({ok:true, id:hqId, status:"approved"});
  }
  var store=await get1(env.DB,"select * from stores where id=?",[user.store_id]);
  if(!store || !store.active) return json({error:"门店已停用，无法建单"}, 400);
  // 盘点单防重复：同一时间一家门店只允许一张未完结盘点单（草稿/待店长审/待总部审）。
  // 已完结（已入库/已驳回）或撤回后可再建；编辑既有草稿（body.id）不受影响
  if(type==="stk" && !body.id){
    var inflight=await get1(env.DB,"select id,status from docs where store_id=? and type='stk' and status in ('draft','pending_manager','pending_hq') order by created_at desc limit 1",[user.store_id]);
    if(inflight){
      var stLbl=inflight.status==="draft"?"草稿":(inflight.status==="pending_manager"?"待店长审":"待总部审");
      return json({error:"本店已有未完结的盘点单（"+inflight.id+" · "+stLbl+"），请先编辑草稿、等待审核，或撤回修改后再提交"}, 400);
    }
  }
  var items=body.items||[];
  var isDraft = !!body.draft;
  if(!isDraft && !items.length) return json({error:"请至少填写一项"}, 400);
  // 物料单价表（供最低订货量校验与物流费计算共用，避免重复查询）
  var mats=await all(env.DB,"select * from materials"); var matsMap={}; mats.forEach(function(m){matsMap[m.id]=m;});
  // 最低订购量校验（仅正式提交；草稿不校验）。抽为函数，供新建与编辑草稿提交共用
  async function checkMinOrder(){
    var bad=[];
    mats.forEach(function(m){ var it=items.filter(function(x){return x.mid===m.id;})[0]; if(it && parseFloat(it.qty)<m.min_order){ var pu = (m.pack_qty>0) ? (Math.ceil(m.min_order/m.pack_qty)+m.pack_unit) : (m.min_order+m.unit); bad.push(m.name+" 最低"+pu); } });
    return bad;
  }
  var urgent=false, regularReqId=null;
  if(type==="req" && !isDraft){
    var bad=await checkMinOrder();
    if(bad.length) return json({error:"低于最低订购量: "+bad.join("、")}, 400);
    // 防重复：本店已存在内容相同的未完结订货单（含总部直发 / 紧急单），阻断重复提交。
    // 注：每周常规订货的拦截（regularReqThisWeek）刻意排除 byHq 单，故这里用「物料明细签名」兜底，避免与总部直发单撞出两条一模一样的单。
    if(!body.id){
      var newSig = normItems(items);
      var openReqs = await all(env.DB,"select id,status,items from docs where store_id=? and type='req' and status in ('pending_manager','pending_hq','approved')",[user.store_id]);
      var dupOpen = openReqs.find(function(r){ return normItems(JSON.parse(r.items||"[]"))===newSig; });
      if(dupOpen){ return json({error:"本店已存在内容相同的未完结订货单（"+dupOpen.id+" · "+dupOpen.status+"），请勿重复提交"}, 400); }
    }
    // 紧急订货：仅当门店主动选择「紧急订货」入口（meta.urgent=true）才走紧急通道；
    // 否则执行「每店每周仅一次常规订货」限制，重复提交直接拦截
    if(body.meta && body.meta.urgent){
      urgent=true;
    } else {
      regularReqId=await regularReqThisWeek(env, user.store_id);
      if(regularReqId){
        return json({error:"本周常规订货单（"+regularReqId+"）已提交，每店每周仅可提交一次常规订货。如需紧急补货，请使用「紧急订货」入口。"}, 400);
      }
    }
  }
  // 编辑本人草稿：更新 items 与状态（继续保存草稿→draft；提交→进入审批流）
  if(body.id){
    var ex=await get1(env.DB,"select * from docs where id=?",[body.id]);
    if(ex && ex.type===type && ex.store_id===user.store_id && ex.status==="draft"){
      // 修复：编辑草稿正式提交时同样须校验最低订货量（此前该路径直接 update 绕过校验）
      if(type==="req" && !isDraft){
        var bad=await checkMinOrder();
        if(bad.length) return json({error:"低于最低订购量: "+bad.join("、")}, 400);
      }
      var st2 = isDraft ? "draft" : (user.role==="manager" ? "pending_hq" : "pending_manager");
      var metaEx=JSON.parse(ex.meta||"{}");
      if(urgent && !metaEx.urgent){
        metaEx.urgent=true;
        var fee1=decideLogisticsFee(true, items, matsMap);
        if(fee1>0){ metaEx.logistics_fee=fee1; metaEx.log=(metaEx.log||[]).concat([{t:isoNow(), who:"system", act:"紧急订货（加收"+fee1+"元物流费）"}]); }
        else { metaEx.log=(metaEx.log||[]).concat([{t:isoNow(), who:"system", act:"紧急订货（总价≥"+FEE_FREE_MIN_TOTAL+"，免物流费）"}]); }
      }
      await run(env.DB,"update docs set items=?, status=?, meta=?, updated_at=? where id=?",[JSON.stringify(snapItems(items, matsMap)), st2, JSON.stringify(metaEx), isoNow(), body.id]);
      if(!isDraft) await notifyDoc(env,{id:body.id, type:type, store_id:user.store_id, status:st2, date:today(), items:items}, urgent?(metaEx.logistics_fee>0?"紧急订货：本周常规单已用，将加收 "+metaEx.logistics_fee+" 元物流费":"紧急订货：总价达免运费标准，免物流费"):"");
      return json({ok:true, id:body.id, status:st2, urgent:urgent});
    }
  }
  var st = isDraft ? "draft" : (user.role==="manager" ? "pending_hq" : "pending_manager");
  var id=uid(type.toUpperCase()+"-");
  var labels={req:"订货单",stk:"盘点单",ret:"退货单"};
  var meta=body.meta||{};
  meta.log=[{t:isoNow(), who:user.id, act:(isDraft?"保存草稿":"发起")+labels[type]}];
  if(urgent){
    meta.urgent=true;
    var fee2=decideLogisticsFee(true, items, matsMap);
    if(fee2>0){ meta.logistics_fee=fee2; meta.log.push({t:isoNow(), who:"system", act:"紧急订货（加收"+fee2+"元物流费）"}); }
    else { meta.log.push({t:isoNow(), who:"system", act:"紧急订货（总价≥"+FEE_FREE_MIN_TOTAL+"，免物流费）"}); }
  }
  if(type==="stk"){
    // 原子防重复：检查「本店是否已有未完结盘点单」与插入在同一条 SQL 内完成，
    // 并发连点也只会成功插入一张（此前检查与插入分离存在竞态窗口，导致出现多张盘点单）
    var r=await runMeta(env.DB,"insert into docs(id,type,store_id,status,creator,date,items,meta,created_at,updated_at) select ?,?,?,?,?,?,?,?,?,? where not exists (select 1 from docs where store_id=? and type='stk' and status in ('draft','pending_manager','pending_hq'))",[id,type,user.store_id,st,user.id,today(),JSON.stringify(items),JSON.stringify(meta),isoNow(),isoNow(),user.store_id]);
    if(!r || !r.meta || !(r.meta.changes>0)) return json({error:"本店已有未完结的盘点单，请勿重复新建（可编辑草稿、等待审核或撤回修改）"}, 400);
  } else {
    await run(env.DB,"insert into docs(id,type,store_id,status,creator,date,items,meta,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)",[id,type,user.store_id,st,user.id,today(),JSON.stringify(snapItems(items, matsMap)),JSON.stringify(meta),isoNow(),isoNow()]);
  }
  // 钉钉提醒：草稿不发，正式提交按状态 @ 到对应审批人
  if(!isDraft) await notifyDoc(env,{id:id, type:type, store_id:user.store_id, status:st, date:today(), items:items}, urgent?((meta.logistics_fee>0)?"紧急订货：本周常规单已用，将加收 "+meta.logistics_fee+" 元物流费":"紧急订货：总价达免运费标准，免物流费"):"");
  return json({ok:true, id:id, status:st, urgent:urgent, logistics_fee: meta.logistics_fee||0});
}

// 总部从已通过订货单生成配货单（op=revise 撤回修改 / op=cancel 作废）
async function apiCreateAlloc(env, user, body){
  if(user.role!=="hq") return json({error:"仅总部可配货"}, 403);
  if(body.op==="revise") return await apiReviseAlloc(env, user, body);
  if(body.op==="cancel") return await apiCancelAlloc(env, user, body);
  var mats=await all(env.DB,"select * from materials"); var matsMap={}; mats.forEach(function(m){matsMap[m.id]=m;});
  var req=await get1(env.DB,"select * from docs where id=? and type=?",[body.reqId,"req"]);
  if(!req) return json({error:"订货单不存在"}, 400);
  if(req.status!=="approved") return json({error:"该订货单未通过或已配货"}, 400);
  var items=body.items||[];
  var id=uid("ALO-");
  var meta={fromReq:body.reqId, log:[{t:isoNow(), who:user.id, act:"总部下发配货单（来自 "+body.reqId+"）"}]};
  await run(env.DB,"insert into docs(id,type,store_id,status,creator,date,items,meta,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)",[id,"alloc",req.store_id,"pending_store_confirm",user.id,today(),JSON.stringify(snapItems(items, matsMap)),JSON.stringify(meta),isoNow(),isoNow()]);
  await run(env.DB,"update docs set status='allocated', updated_at=? where id=?",[isoNow(),body.reqId]);
  // 钉钉提醒：通知门店店长/店员收货
  await notifyDoc(env,{id:id, type:"alloc", store_id:req.store_id, status:"pending_store_confirm", date:today(), items:items}, "请在收货时按实收数量确认");
  return json({ok:true, id:id});
}

// 总部撤回修改未确认的配货单（重新下发，留痕）
async function apiReviseAlloc(env, user, body){
  var mats=await all(env.DB,"select * from materials"); var matsMap={}; mats.forEach(function(m){matsMap[m.id]=m;});
  var d=await get1(env.DB,"select * from docs where id=? and type=?",[body.id,"alloc"]);
  if(!d) return json({error:"配货单不存在"}, 404);
  if(d.status!=="pending_store_confirm") return json({error:"该配货单已被门店收货，无法撤回修改"}, 400);
  var items=body.items||[];
  if(!items.length) return json({error:"请至少填写一项数量"}, 400);
  var meta=JSON.parse(d.meta||"{}"); meta.log=meta.log||[];
  meta.log.push({t:isoNow(), who:user.id, act:"总部撤回修改数量并重新下发"});
  await run(env.DB,"update docs set items=?, meta=?, updated_at=? where id=?",[JSON.stringify(snapItems(items, matsMap)),JSON.stringify(meta),isoNow(),body.id]);
  return json({ok:true});
}

// 总部作废未确认的配货单（来源订货单恢复为已通过，可重新下发）
async function apiCancelAlloc(env, user, body){
  var d=await get1(env.DB,"select * from docs where id=? and type=?",[body.id,"alloc"]);
  if(!d) return json({error:"配货单不存在"}, 404);
  if(d.status!=="pending_store_confirm") return json({error:"该配货单已被门店收货，无法作废"}, 400);
  var meta=JSON.parse(d.meta||"{}"); meta.log=meta.log||[];
  meta.log.push({t:isoNow(), who:user.id, act:"总部作废配货单"});
  await run(env.DB,"update docs set status='cancelled', meta=?, updated_at=? where id=?",[JSON.stringify(meta),isoNow(),body.id]);
  if(meta.fromReq){
    await run(env.DB,"update docs set status='approved', updated_at=? where id=? and status='allocated'",[isoNow(),meta.fromReq]);
  }
  return json({ok:true});
}

// 审批
async function apiApprove(env, user, id, decision, note){
  var d=await get1(env.DB,"select * from docs where id=?",[id]);
  if(!d) return json({error:"单据不存在"}, 404);
  // 配货差异复核：总部可确认处理（按实收数入库）或驳回退回门店重收
  if(d.type==="alloc" && d.status==="diff_pending_hq"){
    if(user.role!=="hq") return json({error:"仅总部可复核收货差异"}, 403);
    var metaD=JSON.parse(d.meta||"{}"); metaD.log=metaD.log||[];
    if(decision==="approve"){
      // 复核通过：按门店实收数入库并结案
      var items=JSON.parse(d.items||"[]");
      await applyAllocReceived(env, d, items);
      metaD.log.push({t:isoNow(), who:user.id, act:"总部复核收货差异，确认处理完毕，已按实收数入库"+(note?("："+note):"")});
      await run(env.DB,"update docs set status='confirmed', meta=?, updated_at=? where id=?",[JSON.stringify(metaD),isoNow(),id]);
      return json({ok:true, status:"confirmed"});
    } else if(decision==="reject"){
      // 驳回：库存尚未入账，安全退回门店重新收货
      delete metaD.diff;
      metaD.log.push({t:isoNow(), who:user.id, act:"总部驳回差异复核，退回门店重新收货"+(note?("："+note):"")});
      await run(env.DB,"update docs set status='pending_store_confirm', items=?, meta=?, updated_at=? where id=?",[d.items,JSON.stringify(metaD),isoNow(),id]);
      return json({ok:true, status:"pending_store_confirm"});
    }
    return json({error:"未知操作"}, 400);
  }
  if(d.status==="pending_manager"){ if(user.role!=="manager" || user.store_id!==d.store_id) return json({error:"无审批权限"}, 403); }
  else if(d.status==="pending_hq"){ if(user.role!=="hq") return json({error:"仅总部可终审"}, 403); }
  else return json({error:"当前状态不可审批"}, 400);
  var meta=JSON.parse(d.meta||"{}");
  meta.log=meta.log||[];
  if(decision==="reject"){
    d.status="rejected";
    meta.log.push({t:isoNow(), who:user.id, act:"驳回"+(note?("："+note):"")});
  } else {
    if(d.status==="pending_manager"){
      d.status="pending_hq";
      meta.log.push({t:isoNow(), who:user.id, act:"店长通过，转总部"});
      // 店长审核通过即入账并生成推荐订货单（不等总部终审）
      if(d.type==="stk"){ await applyStocktake(env, d); await maybeAutoReco(env, d); }
    } else if(d.status==="pending_hq"){
      d.status="approved";
      meta.log.push({t:isoNow(), who:user.id, act:"总部通过"});
      if(d.type==="stk"){ await applyStocktake(env, d); await maybeAutoReco(env, d); }
      if(d.type==="ret"){ await applyReturn(env, d); }
    }
  }
  await run(env.DB,"update docs set status=?, meta=?, updated_at=? where id=?",[d.status, JSON.stringify(meta), isoNow(), id]);
  return json({ok:true, status:d.status});
}
// 周五盘点单审核通过后，自动生成草稿订货单（未提交，操作人=系统推荐）
async function maybeAutoReco(env, stk){
  // 中国时区周五判定：提交当天、审核当天均为周五且为同一天；盘点经营日也为周五
  var now = new Date();
  if (cnDay(now) !== 5) return;                          // 审核当天须为中国周五
  var created = new Date(stk.created_at);
  if (cnDay(created) !== 5) return;                     // 提交当天须为中国周五
  if (cnDate(now) !== cnDate(created)) return;          // 提交与审核须为同一天（周五当天提交+当天审核）
  var dt = new Date(stk.date + "T00:00:00Z");
  if (cnDay(dt) !== 5) return;                          // 盘点经营日须为中国周五（订货前盘点）
  var storeId = stk.store_id;
  // 防重复：该店已有未完结的自动推荐单则跳过
  var ex = await all(env.DB,"select * from docs where store_id=? and type='req' and status in ('draft','pending_manager','pending_hq')",[storeId]);
  for (var i=0;i<ex.length;i++){ var m=JSON.parse(ex[i].meta||"{}"); if(m && m.autoGenerated) return; }
  var items = await computeReco(env, storeId);
  var orderItems = items.filter(function(it){ return it.suggest>0; }).map(function(it){ return { mid: it.mid, qty: it.suggest }; });
  if (!orderItems.length) return; // 无需订货则不生成
  // 写推荐快照（供智能推荐视图展示）
  await run(env.DB,"insert into recos(store_id,week,data) values(?,?,?) on conflict(store_id,week) do update set data=excluded.data",[storeId, today(), JSON.stringify({items:items})]);
  // 建草稿订货单（状态 draft=未提交；meta.operator=系统推荐）
  var id = uid("REQ-");
  var meta = { fromReco:true, autoGenerated:true, fromStocktake:stk.id, operator:"系统推荐", log:[{t:isoNow(), who:"system", act:"据周五盘点("+stk.date+")自动生成推荐订货单"}] };
  await run(env.DB,"insert into docs(id,type,store_id,status,creator,date,items,meta,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)",[id,"req",storeId,"draft","system",today(),JSON.stringify(orderItems),JSON.stringify(meta),isoNow(),isoNow()]);
}
async function applyStocktake(env, d){
  var items=JSON.parse(d.items||"[]");
  items.forEach(function(it){ run(env.DB,"insert into inventory(store_id,material_id,qty) values(?,?,?) on conflict(store_id,material_id) do update set qty=excluded.qty",[d.store_id,it.mid,it.actual]); });
}
async function applyReturn(env, d){
  var items=JSON.parse(d.items||"[]");
  for(var i=0;i<items.length;i++){
    var it=items[i];
    var have=(await get1(env.DB,"select qty from inventory where store_id=? and material_id=?",[d.store_id,it.mid]))||{qty:0};
    var newq=have.qty-parseFloat(it.qty||0);
    await run(env.DB,"insert into inventory(store_id,material_id,qty) values(?,?,?) on conflict(store_id,material_id) do update set qty=excluded.qty",[d.store_id,it.mid,newq]);
  }
}
// 配货收货入库：按实收数(actual，缺省取配货数 qty)累加库存
async function applyAllocReceived(env, d, items){
  for(var i=0;i<items.length;i++){
    var it=items[i];
    var actual=parseFloat(it.actual!==undefined?it.actual:it.qty||0);
    if(isNaN(actual)) actual=0;
    var have=(await get1(env.DB,"select qty from inventory where store_id=? and material_id=?",[d.store_id,it.mid]))||{qty:0};
    var newq=have.qty+actual;
    await run(env.DB,"insert into inventory(store_id,material_id,qty) values(?,?,?) on conflict(store_id,material_id) do update set qty=excluded.qty",[d.store_id,it.mid,newq]);
  }
}

// 门店确认配货入库（支持差异收货：按实收数量入账，差异自动记录待总部复核）
async function apiConfirmAlloc(env, user, body){
  var id=body.id;
  var d=await get1(env.DB,"select * from docs where id=? and type=?",[id,"alloc"]);
  if(!d) return json({error:"配货单不存在"}, 404);
  if(d.status!=="pending_store_confirm") return json({error:"非待确认状态"}, 400);
  if(user.role==="hq") return json({error:"仅门店可确认"}, 403);
  if(user.store_id!==d.store_id) return json({error:"非本店配货单"}, 403);
  var items=JSON.parse(d.items||"[]");
  var actualMap={};
  (body.items||[]).forEach(function(b){ if(b && b.mid!=null){ var v=parseFloat(b.qty); if(!isNaN(v)) actualMap[b.mid]=v; } });
  var note=(body.note||"").trim();
  var diffs=[];
  for(var i=0;i<items.length;i++){
    var it=items[i];
    var allocQty=parseFloat(it.qty||0);
    var actual=(actualMap[it.mid]!==undefined)?actualMap[it.mid]:allocQty;
    it.actual=actual;
    if(Math.abs(actual-allocQty)>1e-9) diffs.push({mid:it.mid, alloc:allocQty, actual:actual});
  }
  var meta=JSON.parse(d.meta||"{}"); meta.log=meta.log||[];
  var newStatus;
  if(diffs.length){
    // 差异收货：先不入库，仅记录实收数与差异，待总部复核通过后按实收数入库
    meta.diff={items:diffs, note:note};
    meta.log.push({t:isoNow(), who:user.id, act:"门店差异收货（"+diffs.length+" 项与配货数不符，已记录实收数，待总部复核通过后入库）"+(note?("："+note):"")});
    newStatus="diff_pending_hq";
  } else {
    // 无差异：按实收数（=配货数）直接入库
    await applyAllocReceived(env, d, items);
    meta.log.push({t:isoNow(), who:user.id, act:"门店确认收货，已自动入库"});
    newStatus="confirmed";
  }
  await run(env.DB,"update docs set items=?, status=?, meta=?, updated_at=? where id=?",[JSON.stringify(items),newStatus,JSON.stringify(meta),isoNow(),id]);
  return json({ok:true, status:newStatus, diffs:diffs.length});
}

// 物料维护
async function apiMaterial(env, user, body){
  if(user.role!=="hq") return json({error:"仅总部可维护物料"}, 403);
  var op=body.op;
  var packQty = (body.pack_qty===""||body.pack_qty==null||body.pack_qty===undefined)?null:parseFloat(body.pack_qty);
  var packPrice = (body.pack_price===""||body.pack_price==null||body.pack_price===undefined)?null:parseFloat(body.pack_price);
  var stkQty = (body.stk_qty===""||body.stk_qty==null||body.stk_qty===undefined)?null:parseFloat(body.stk_qty);
  var stkUnit = (body.stk_unit||"").trim()||null; // 盘点二级单位（未填时盘点沿用包装单位）
  if(stkUnit && !(stkQty!=null && stkQty>0)) return json({error:"填写了盘点单位时，必须同时填写盘点规格（每盘点单位=多少基础单位）"}, 400);
  var minOrder = parseFloat(body.min_order)||0;
  var denom = (packQty!=null && packQty>0) ? packQty : (minOrder>0 ? minOrder : 0);
  // 单价(每基础单位) = 采购总价 ÷ 包装规格(无则÷最低订购量)；无采购总价时兼容旧 price 字段
  var price = (packPrice!=null && packPrice>0 && denom>0) ? (packPrice/denom) : (parseFloat(body.price)||0);
  if(op==="add"){ var id=body.id||uid("m"); var inStk=(body.in_stocktake==="0"||body.in_stocktake===0)?0:1; var soMax=(await get1(env.DB,"select max(sort_order) as m from materials"))||{m:0}; var so=((soMax.m||0)+1); await run(env.DB,"insert into materials(id,name,unit,price,min_order,pack_qty,pack_unit,pack_price,stk_unit,stk_qty,sort_order,in_stocktake) values(?,?,?,?,?,?,?,?,?,?,?,?)",[id,body.name,body.unit,price,minOrder,packQty,body.pack_unit||null,packPrice||0,stkUnit,stkQty,so,inStk]); return json({ok:true, id:id}); }
  if(op==="edit"){ var inStk2=(body.in_stocktake==="0"||body.in_stocktake===0)?0:1; await run(env.DB,"update materials set name=?, unit=?, price=?, min_order=?, pack_qty=?, pack_unit=?, pack_price=?, stk_unit=?, stk_qty=?, in_stocktake=? where id=?",[body.name,body.unit,price,minOrder,packQty,body.pack_unit||null,packPrice||0,stkUnit,stkQty,inStk2,body.id]); return json({ok:true}); }
  if(op==="reorder"){
    var ids = body.ids;
    if(!Array.isArray(ids) || !ids.length) return json({error:"ids 必填"},400);
    for(var k=0;k<ids.length;k++){ await run(env.DB,"update materials set sort_order=? where id=?",[k+1, ids[k]]); }
    return json({ok:true});
  }
  // 隔离期使用：清除所有历史单据 items 里的 name/price 快照字段，使其回退实时引用（配合 SNAPSHOT_ENABLED=false）
  if(op==="snapshotClear"){
    if(user.role!=="hq") return json({error:"仅总部可操作"},403);
    var docs=await all(env.DB,"select id,items from docs where items like '%\"mid\"%'");
    var n=0;
    for(var di=0;di<docs.length;di++){
      var arr=JSON.parse(docs[di].items||"[]");
      var changed=false;
      for(var xi=0;xi<arr.length;xi++){
        var it=arr[xi]; if(!it || !it.mid) continue;
        if('price' in it){ delete it.price; changed=true; }
        if('name' in it){ delete it.name; changed=true; }
      }
      if(changed){ await run(env.DB,"update docs set items=? where id=?",[JSON.stringify(arr),docs[di].id]); n++; }
    }
    return json({ok:true, docs_scanned:docs.length, docs_cleared:n});
  }
  // 一次性回填：把历史单据 items 补上 name/price 快照（仅缺则补，幂等）。冻结历史单据，使其不再随物料变更漂移
  if(op==="snapshotBackfill"){
    var allMats=await all(env.DB,"select * from materials"); var mMap={}; allMats.forEach(function(m){ mMap[m.id]=m; });
    var docs=await all(env.DB,"select id,items from docs where items like '%\"mid\"%'");
    var n=0;
    for(var di=0;di<docs.length;di++){
      var arr=JSON.parse(docs[di].items||"[]");
      var changed=false;
      for(var xi=0;xi<arr.length;xi++){
        var it=arr[xi]; if(!it || !it.mid) continue;
        var mm=mMap[it.mid];
        if(it.name==null){ it.name=(mm?mm.name:it.mid); changed=true; }
        if(it.price==null){ it.price=(mm?mm.price:0); changed=true; }
      }
      if(changed){ await run(env.DB,"update docs set items=? where id=?",[JSON.stringify(arr),docs[di].id]); n++; }
    }
    return json({ok:true, docs_scanned:docs.length, docs_updated:n});
  }
  if(op==="move"){
    var dir = body.dir==="up" ? "up" : "down";
    var mats = await all(env.DB,"select id, sort_order from materials order by sort_order, id");
    var ids = mats.map(function(x){ return x.id; });
    var i = ids.indexOf(body.id);
    if(i<0) return json({error:"物料不存在"},400);
    var j = (dir==="up" ? i-1 : i+1);
    if(j<0 || j>=ids.length) return json({ok:true});
    ids.splice(j,0,ids.splice(i,1)[0]);
    for(var k=0;k<ids.length;k++){ await run(env.DB,"update materials set sort_order=? where id=?",[k+1, ids[k]]); }
    return json({ok:true});
  }
  if(op==="del"){ await run(env.DB,"delete from boms where material_id=?",[body.id]); await run(env.DB,"delete from inventory where material_id=?",[body.id]); await run(env.DB,"delete from materials where id=?",[body.id]); return json({ok:true}); }
  return json({error:"未知操作"}, 400);
}

// 门店管理
async function apiStore(env, user, body){
  if(user.role!=="hq") return json({error:"仅总部可管理门店"}, 403);
  var op=body.op;
  if(op==="add"){
    // 自动分配下一个 sN 编号（仅匹配 s+数字 的门店，避开随机 id / 中文名门店，避免撞号）
    var exist = await all(env.DB,"select id from stores where id glob 's[0-9]*'");
    var maxN=0; exist.forEach(function(r){ var m=/^s(\d+)$/.exec(r.id); if(m){ var n=parseInt(m[1],10); if(n>maxN) maxN=n; } });
    var num = maxN+1;
    // 允许总部显式指定合法编号（s+数字），否则自动递增
    var id = (body.id && /^s\d+$/.test(body.id)) ? body.id : ("s"+num);
    await run(env.DB,"insert into stores(id,name,active,created_at) values(?,?,1,?)",[id,body.name,isoNow()]);
    await run(env.DB,"insert into users(id,store_id,role,name,username,password,created_at) values(?,?,?,?,?,?,?)",["mgr_"+id,id,"manager",body.name+"·店长",id+"mgr","123456",isoNow()]);
    await run(env.DB,"insert into users(id,store_id,role,name,username,password,created_at) values(?,?,?,?,?,?,?)",["clerk_"+id,id,"clerk",body.name+"·店员",id+"clerk","123456",isoNow()]);
    return json({ok:true, id:id, mgr:id+"mgr", clerk:id+"clerk", password:"123456"});
  }
  if(op==="rename"){
    await run(env.DB,"update stores set name=? where id=?",[body.name,body.id]);
    await run(env.DB,"update users set name=? where id=?",[body.name+"·店长","mgr_"+body.id]);
    await run(env.DB,"update users set name=? where id=?",[body.name+"·店员","clerk_"+body.id]);
    return json({ok:true});
  }
  if(op==="toggle"){ var st=body.active?1:0; await run(env.DB,"update stores set active=? where id=?",[st,body.id]); return json({ok:true, active:st}); }
  return json({error:"未知操作"}, 400);
}

// 账号：自助改密 + 总部重置
async function apiUser(env, user, body){
  var op=body.op;
  if(op==="password"){
    var oldP=body.old_password||"", newP=body.new_password||"";
    if(!newP || newP.length<6) return json({error:"新密码至少 6 位"}, 400);
    if(oldP!==user.password) return json({error:"原密码不正确"}, 400);
    await run(env.DB,"update users set password=? where id=?",[newP,user.id]);
    return json({ok:true});
  }
  if(op==="reset"){
    if(user.role!=="hq") return json({error:"仅总部可重置密码"}, 403);
    if(!body.id) return json({error:"缺少目标账号"}, 400);
    await run(env.DB,"update users set password=? where id=?",["123456",body.id]);
    return json({ok:true});
  }
  if(op==="phone"){
    var phone=(body.phone||"").trim();
    if(phone && !/^1\d{10}$/.test(phone)) return json({error:"请输入正确的 11 位手机号"}, 400);
    await run(env.DB,"update users set phone=? where id=?",[phone,user.id]);
    user.phone=phone;
    return json({ok:true, phone:phone});
  }
  return json({error:"未知操作"}, 400);
}

// 钉钉消息提醒配置（仅总部可访问）
async function apiNotifySettings(env, user, req, body){
  if(user.role!=="hq") return json({error:"仅总部可配置消息提醒"}, 403);
  if(req.method==="GET" || !body || !body.op){
    var st=await getSettings(env);
    return json({ ok:true, ding_webhook:st.ding_webhook||"", ding_secret:st.ding_secret||"", ding_on:st.ding_on||"1", app_url:st.app_url||"" });
  }
  var op=body.op;
  if(op==="save"){
    if("ding_webhook" in body) await setSetting(env,"ding_webhook",(body.ding_webhook||"").trim());
    if("ding_secret" in body) await setSetting(env,"ding_secret",(body.ding_secret||"").trim());
    if("app_url" in body) await setSetting(env,"app_url",(body.app_url||"").trim());
    if("ding_on" in body) await setSetting(env,"ding_on", (body.ding_on==="1"||body.ding_on===true) ? "1":"0");
    return json({ok:true});
  }
  if(op==="test"){
    var st2=await getSettings(env);
    if(!(st2.ding_webhook||"").trim()) return json({error:"请先填写机器人 Webhook 地址"}, 400);
    var r=await dingSend(env, "【测试】Maray Coffee 钉钉提醒已连通\n这是一条测试消息，收到即代表配置正确。", []);
    return json({ok:true, result:r});
  }
  return json({error:"未知操作"}, 400);
}

// 商品与配方
async function apiProduct(env, user, body){
  if(user.role!=="hq") return json({error:"仅总部可维护商品"}, 403);
  var op=body.op;
  if(op==="add"){ var id=body.id||uid("p"); await run(env.DB,"insert into products(id,name,active,price) values(?,?,1,?)",[id,body.name,parseFloat(body.price)||0]); return json({ok:true, id:id}); }
  if(op==="edit"){ await run(env.DB,"update products set name=?, price=? where id=?",[body.name, parseFloat(body.price)||0, body.id]); return json({ok:true}); }
  if(op==="del"){ await run(env.DB,"delete from boms where pk like ?",[body.id+"|%"]); await run(env.DB,"delete from products where id=?",[body.id]); return json({ok:true}); }
  if(op==="bom"){
    var p=body.id;
    await run(env.DB,"delete from boms where pk like ?",[p+"|%"]);
    var bomsData=body.boms||{};
    var ks=Object.keys(bomsData);
    for(var ki=0;ki<ks.length;ki++){
      var k=ks[ki];
      var bl=bomsData[k];
      for(var bi=0;bi<bl.length;bi++){ await run(env.DB,"insert into boms(pk,material_id,qty) values(?,?,?)",[p+"|"+k,bl[bi].mid,bl[bi].qty]); }
    }
    return json({ok:true});
  }
  return json({error:"未知操作"}, 400);
}

// 加料维护
async function apiAddon(env, user, body){
  if(user.role!=="hq") return json({error:"仅总部可维护加料"}, 403);
  var op=body.op;
  if(op==="add"){ var id=body.id||uid("a"); await run(env.DB,"insert into addons(id,name,price,bom) values(?,?,?,?)",[id,body.name,parseFloat(body.price)||0,JSON.stringify(body.bom||[])]); return json({ok:true, id:id}); }
  if(op==="edit"){ await run(env.DB,"update addons set name=?, price=?, bom=? where id=?",[body.name,parseFloat(body.price)||0,JSON.stringify(body.bom||[]),body.id]); await run(env.DB,"delete from boms where pk=?",["a|"+body.id]); var ab=body.bom||[]; for(var ai=0;ai<ab.length;ai++){ await run(env.DB,"insert into boms(pk,material_id,qty) values(?,?,?)",["a|"+body.id,ab[ai].mid,ab[ai].qty]); } return json({ok:true}); }
  if(op==="del"){ await run(env.DB,"delete from boms where pk=?",["a|"+body.id]); await run(env.DB,"delete from addons where id=?",[body.id]); return json({ok:true}); }
  return json({error:"未知操作"}, 400);
}

// 智能推荐订货
async function inTransitQty(env, storeId, mid){
  var q=0;
  var reqs=await all(env.DB,"select items from docs where store_id=? and type='req' and status in ('pending_manager','pending_hq','approved')",[storeId]);
  reqs.forEach(function(r){ JSON.parse(r.items||"[]").forEach(function(it){ if(it.mid===mid) q+=parseFloat(it.qty||0); }); });
  var alos=await all(env.DB,"select items from docs where store_id=? and type='alloc' and status='pending_store_confirm'",[storeId]);
  alos.forEach(function(r){ JSON.parse(r.items||"[]").forEach(function(it){ if(it.mid===mid) q+=parseFloat(it.qty||0); }); });
  return q;
}
async function computeReco(env, storeId){
  var boms=await loadBoms(env.DB);
  var since=dayAdd(today(),-14);
  var sales=await all(env.DB,"select * from sales where store_id=? and date>=?",[storeId,since]);
  var consume={};
  sales.forEach(function(s){ var need=saleNeed(boms, s.pid, s.temp, s.size, JSON.parse(s.addons||"[]"), s.qty); Object.keys(need).forEach(function(mid){ consume[mid]=(consume[mid]||0)+need[mid]; }); });
  var items=[];
  var mats=await all(env.DB,"select * from materials");
  for(var mi=0;mi<mats.length;mi++){
    var m=mats[mi];
    var total=consume[m.id]||0;
    var daily=total/14;
    var need8=Math.ceil(daily*8);
    var have=(await get1(env.DB,"select qty from inventory where store_id=? and material_id=?",[storeId,m.id]))||{qty:0};
    var inT=await inTransitQty(env, storeId, m.id);
    var suggest=Math.max(0, need8 - have.qty - inT);
    var step = (m.pack_qty>0) ? m.pack_qty : (m.min_order>0 ? m.min_order : 0);
    if(suggest>0 && step>0){ suggest=Math.ceil(suggest/step)*step; }
    items.push({mid:m.id, name:m.name, unit:m.unit, daily:Math.round(daily*100)/100, need8:need8, have:Math.round(have.qty), inTransit:inT, suggest:suggest});
  }
  return items;
}
async function apiReco(env, user, body){
  if(body.op==="gen"){
    if(user.role!=="hq") return json({error:"仅总部可生成推荐"}, 403);
    var targets = (body.storeIds && body.storeIds.length) ? body.storeIds : (await all(env.DB,"select id from stores where active=1")).map(function(s){return s.id;});
    var week=today();
    for(var i=0;i<targets.length;i++){
      var items=await computeReco(env, targets[i]);
      await run(env.DB,"insert into recos(store_id,week,data) values(?,?,?) on conflict(store_id,week) do update set data=excluded.data",[targets[i],week,JSON.stringify({items:items})]);
    }
    return json({ok:true});
  }
  if(body.op==="submit"){
    var storeId = body.store_id || user.store_id;
    if(user.role !== "hq" && storeId !== user.store_id) return json({error:"只能提交本店订单"}, 403);
    if(!ownStore(user, storeId)) return json({error:"无权限"}, 403);
    var store=await get1(env.DB,"select * from stores where id=?",[storeId]);
    if(!store || !store.active) return json({error:"门店已停用"}, 400);
    var items=(body.items||[]).filter(function(x){return parseFloat(x.qty)>0;});
    if(!items.length) return json({error:"请至少填写一项"}, 400);
    // 最低订购量校验（推荐转正式订货单同样适用）
    var mats=await all(env.DB,"select * from materials"); var matsMap={}; mats.forEach(function(m){matsMap[m.id]=m;});
    var bad=[];
    mats.forEach(function(m){ var it=items.filter(function(x){return x.mid===m.id;})[0]; if(it && parseFloat(it.qty)<m.min_order){ var pu = (m.pack_qty>0) ? (Math.ceil(m.min_order/m.pack_qty)+m.pack_unit) : (m.min_order+m.unit); bad.push(m.name+" 最低"+pu); } });
    if(bad.length) return json({error:"低于最低订购量: "+bad.join("、")}, 400);
    // 每周每店仅一次常规订货：推荐转正式订货同样适用；重复提交直接拦截（紧急通道需显式 meta.urgent）
    var regularReqId=await regularReqThisWeek(env, storeId);
    if(regularReqId && !(body.meta && body.meta.urgent)){
      return json({error:"本周常规订货单（"+regularReqId+"）已提交，每店每周仅可提交一次常规订货。如需紧急补货，请使用「紧急订货」入口。"}, 400);
    }
    var st = user.role==="manager" ? "pending_hq" : "pending_manager";
    var id=uid("REQ-");
    var meta={fromReco:true, log:[{t:isoNow(), who:user.id, act:"据推荐订货单生成"}]};
    if(body.meta && body.meta.urgent){
      meta.urgent=true;
      var fee3=decideLogisticsFee(true, items, matsMap);
      if(fee3>0){ meta.logistics_fee=fee3; meta.log.push({t:isoNow(), who:"system", act:"紧急订货（加收"+fee3+"元物流费）"}); }
      else { meta.log.push({t:isoNow(), who:"system", act:"紧急订货（总价≥"+FEE_FREE_MIN_TOTAL+"，免物流费）"}); }
    }
    await run(env.DB,"insert into docs(id,type,store_id,status,creator,date,items,meta,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)",[id,"req",storeId,st,user.id,today(),JSON.stringify(items),JSON.stringify(meta),isoNow(),isoNow()]);
    return json({ok:true, id:id, status:st, logistics_fee: meta.logistics_fee||0});
  }
  return json({error:"未知操作"}, 400);
}

// ===== Block4b：销售汇总（按渠道） + 门店结算单 + 路由入口 =====

// 销售汇总：按渠道 / 按门店 / 按天聚合（带日期范围）
async function apiSummary(env, user, url){
  var start = url.searchParams.get("start") || dayAdd(today(), -7);
  var end = url.searchParams.get("end") || today();
  var store = url.searchParams.get("store");
  var where = ["date>=?", "date<=?"], params = [start, end];
  if(user.role !== "hq"){ where.push("store_id=?"); params.push(user.store_id); }
  else if(user.role === "hq" && store){ where.push("store_id=?"); params.push(store); }
  var sales = await all(env.DB, "select * from sales where " + where.join(" and "), params);
  var byChannel = {}, byStore = {}, byDate = {}, totalIncome = 0, totalQty = 0;
  sales.forEach(function(s){
    totalIncome += s.income; totalQty += s.qty;
    byChannel[s.channel] = byChannel[s.channel] || {income:0, qty:0}; byChannel[s.channel].income += s.income; byChannel[s.channel].qty += s.qty;
    byStore[s.store_id] = byStore[s.store_id] || {income:0, qty:0}; byStore[s.store_id].income += s.income; byStore[s.store_id].qty += s.qty;
    byDate[s.date] = byDate[s.date] || {income:0, qty:0}; byDate[s.date].income += s.income; byDate[s.date].qty += s.qty;
  });
  return json({ok:true, start:start, end:end, totalIncome:Math.round(totalIncome*100)/100, totalQty:totalQty, byChannel:byChannel, byStore:byStore, byDate:byDate, channels:CHANNELS});
}

// 门店结算单：按门店 × 月汇总配货单（alloc）金额
async function apiSettlement(env, user, url){
  if(user.role !== "hq") return json({error:"仅总部可查看结算单"}, 403);
  var month = url.searchParams.get("month") || today().slice(0,7);
  var docs = await all(env.DB, "select * from docs where type='alloc' and date like ?", [month + "%"]);
  var mats = await all(env.DB, "select * from materials");
  var price = {}; mats.forEach(function(m){ price[m.id] = m.price; });
  var rows = [];
  docs.forEach(function(d){
    var items = JSON.parse(d.items || "[]");
    var amt = 0;
    // 有实收数（差异收货）按实收结算，否则按配货数
    items.forEach(function(it){ var q = (it.actual != null) ? parseFloat(it.actual) : parseFloat(it.qty || 0); amt += q * (it.price != null ? parseFloat(it.price) : (price[it.mid] || 0)); });
    rows.push({id:d.id, store_id:d.store_id, date:d.date, status:d.status, amount:Math.round(amt*100)/100});
  });
  var byStore = {};
  rows.forEach(function(r){ byStore[r.store_id] = byStore[r.store_id] || {amount:0, count:0}; byStore[r.store_id].amount += r.amount; byStore[r.store_id].count++; });
  var total = 0; rows.forEach(function(r){ total += r.amount; });
  return json({ok:true, month:month, rows:rows, byStore:byStore, total:Math.round(total*100)/100});
}

// 总部导出指定月份的所有门店配货明细（按物料展开）
async function apiExportAlloc(env, user, url){
  if(user.role !== "hq") return json({error:"仅总部可导出配货明细"}, 403);
  var month = url.searchParams.get("month") || today().slice(0,7);
  var docs = await all(env.DB, "select * from docs where type='alloc' and date like ?", [month + "%"]);
  var mats = await all(env.DB, "select * from materials");
  var mmap = {}; mats.forEach(function(m){ mmap[m.id] = m; });
  var stores = await all(env.DB, "select * from stores");
  var smap = {}; stores.forEach(function(s){ smap[s.id] = s.name; });
  var STATUS = { allocated:'已配货', pending_store_confirm:'待门店收货', confirmed:'已入库', diff_pending_hq:'差异待复核', cancelled:'已作废', draft:'草稿' };
  var rows = [];
  docs.forEach(function(d){
    var items = JSON.parse(d.items || "[]");
    var storeName = smap[d.store_id] || d.store_id;
    var statusCn = STATUS[d.status] || d.status;
    items.forEach(function(it){
      var m = mmap[it.mid] || {};
      var pq = (m.pack_qty > 0) ? m.pack_qty : 0;
      var packUnit = pq > 0 ? (m.pack_unit || '件') : (m.unit || '');
      var allocBase = parseFloat(it.qty || 0);
      var actualBase = (it.actual != null && it.actual !== '') ? parseFloat(it.actual) : null;
      var allocPack = pq > 0 ? Math.round(allocBase / pq * 1000) / 1000 : allocBase;
      var actualPack = (actualBase != null) ? (pq > 0 ? Math.round(actualBase / pq * 1000) / 1000 : actualBase) : '';
      var diffPack = (actualBase != null) ? (pq > 0 ? Math.round((actualBase - allocBase) / pq * 1000) / 1000 : Math.round((actualBase - allocBase) * 1000) / 1000) : '';
      var price = (it.price != null) ? parseFloat(it.price) : parseFloat(m.price || 0);
      var qForAmt = (actualBase != null) ? actualBase : allocBase;
      var amount = Math.round(qForAmt * price * 100) / 100;
      var spec = pq > 0 ? (m.pack_qty + (m.unit || '') + '/' + (m.pack_unit || '件')) : (m.unit || '');
      rows.push({ doc_id:d.id, store:storeName, date:d.date, status:statusCn, mid:it.mid, mat_name:(it.name || m.name || it.mid), spec:spec, unit_price:price, alloc_pack:allocPack, pack_unit:packUnit, actual_pack:actualPack, diff_pack:diffPack, amount:amount });
    });
  });
  return json({ok:true, month:month, rows:rows});
}

// ===== Block5：三方外卖平台对接（淘宝闪购等）=====
// 凭证（仅总部可配置，含 AppKey/Secret/Token）
async function apiPlatformCred(env, user, body){
  if(user.role !== "hq") return json({error:"仅总部可配置平台凭证"}, 403);
  var platform = body.platform || "taobao";
  if(body.op === "get"){
    var c = await get1(env.DB, "select id,platform,app_key,access_token,token_expire,created_at from platform_credentials where platform=?", [platform]);
    return json({ok:true, cred:c||null});
  }
  var id = platform + "_cred";
  var existing = await get1(env.DB, "select id from platform_credentials where platform=?", [platform]);
  if(existing){
    await run(env.DB, "update platform_credentials set app_key=?, app_secret=?, access_token=?, refresh_token=?, token_expire=?, created_at=? where platform=?", [body.app_key||"", body.app_secret||"", body.access_token||"", body.refresh_token||"", body.token_expire||"", isoNow(), platform]);
  } else {
    await run(env.DB, "insert into platform_credentials(id,platform,app_key,app_secret,access_token,refresh_token,token_expire,created_at) values(?,?,?,?,?,?,?,?)", [id, platform, body.app_key||"", body.app_secret||"", body.access_token||"", body.refresh_token||"", body.token_expire||"", isoNow()]);
  }
  return json({ok:true});
}

// 店铺映射：平台店铺 ↔ ERP 门店
async function apiPlatformShops(env, user, body){
  if(user.role !== "hq") return json({error:"仅总部可配置"}, 403);
  if(body.op === "list"){ var rows = await all(env.DB, "select * from platform_shops order by platform, platform_shop_name"); return json({ok:true, rows:rows}); }
  if(body.op === "add"){ var id = uid("ps_"); await run(env.DB, "insert into platform_shops(id,platform,platform_shop_id,platform_shop_name,store_id,created_at) values(?,?,?,?,?,?)", [id, body.platform||"taobao", body.platform_shop_id||"", body.platform_shop_name||"", body.store_id||"", isoNow()]); return json({ok:true, id:id}); }
  if(body.op === "del"){ await run(env.DB, "delete from platform_shops where id=?", [body.id]); return json({ok:true}); }
  return json({error:"未知操作"}, 400);
}

// 商品映射：平台商品/SKU ↔ ERP 商品(pid+temp+size+addons)
async function apiPlatformItems(env, user, body){
  if(user.role !== "hq") return json({error:"仅总部可配置"}, 403);
  if(body.op === "list"){ var rows = await all(env.DB, "select * from platform_items order by platform, platform_title"); return json({ok:true, rows:rows}); }
  if(body.op === "add"){ var id = uid("pi_"); await run(env.DB, "insert into platform_items(id,platform,platform_item_id,platform_sku,platform_title,pid,temp,size,addons,created_at) values(?,?,?,?,?,?,?,?,?,?)", [id, body.platform||"taobao", body.platform_item_id||"", body.platform_sku||"", body.platform_title||"", body.pid||"", body.temp||"hot", body.size||"M", JSON.stringify(body.addons||[]), isoNow()]); return json({ok:true, id:id}); }
  if(body.op === "del"){ await run(env.DB, "delete from platform_items where id=?", [body.id]); return json({ok:true}); }
  return json({error:"未知操作"}, 400);
}

// 淘宝订单推送接收：先落库原始 JSON（签名校验 TODO，待开放平台文档补充）
async function apiTbCallback(env, user, body){
  try {
    // 淘宝闪购推送地址校验要求：HTTP 200 且 body 为 {"message":"ok"}，否则保存失败
    // 空包/校验探测包直接应答，不落库
    if(!body || !Object.keys(body).length){ return json({message:"ok"}); }
    var raw = JSON.stringify(body);
    var poId = (body.tid || body.order_id || body.id) ? String(body.tid || body.order_id || body.id) : ("raw_"+Date.now());
    var shopId = (body.shop_id || body.seller_id || body.seller_nick) ? String(body.shop_id || body.seller_id || body.seller_nick) : "";
    var id = uid("po_");
    await run(env.DB, "insert into platform_orders(id,platform,platform_order_id,raw,shop_id,store_id,parsed,created_at) values(?,?,?,?,?,?,?,?)", [id, "taobao", poId, raw, shopId, "", 0, isoNow()]);
    return json({message:"ok", ok:true, id:id});
  } catch(e){ return json({error:String(e)}, 500); }
}

// 拉取对账（占位：待接入淘宝 trade API 后实现具体拉取与自动出库）
async function apiPlatformPull(env, user, body){
  if(user.role !== "hq") return json({error:"仅总部可拉取"}, 403);
  return json({ok:true, todo:true, message:"拉取对账与自动出库待接入订单样本后实现"});
}

// 写操作 → 受影响的数据域（用于按域递增版本号，避免高频销售写入惊动全部在线设备拉全量）
function scopeKeyForRoute(r){
  if(r === "sale") return ["ver_inv"];
  if(r === "doc" || r === "alloc" || r === "reco") return ["ver_docs"];
  if(r === "approve" || r === "confirm-alloc") return ["ver_docs", "ver_inv"]; // 审批/收货复核可能写库存
  if(r === "material" || r === "product" || r === "addon" || r === "store" || r === "user" || r === "platform-cred" || r === "platform-shops" || r === "platform-items") return ["ver_base"];
  return ["ver_base", "ver_docs", "ver_inv"]; // 未知写操作兜底：全域递增
}

// 路由入口：分发 /api/* 全部端点（外层统一捕获异常）
// 此前无 try/catch，任何偶发/持续性 D1 错误会直接打穿 Worker，
// Cloudflare 返回纯文本 "error code: 1101"（非 JSON），前端只能显示"响应解析失败"。
async function onRequest(context){
  try {
    var resp = await handleApi(context);
    // 成功的业务写操作后递增数据版本号（fire-and-forget，不阻塞响应）：
    // 按影响「域」递增——营业时段销售单高频写入只 bump ver_inv（库存/销售域，前端节流拉取），
    // 不再触发所有在线设备重拉单据/目录数据，避免耗尽 D1 每日读取配额。
    // data_ver 同时递增：兼容仍在线跑旧版前端（只认 ver 字段）的设备。
    try {
      var creq = context.request;
      if(creq.method === "POST" && resp && resp.status < 400){
        var curl_ = new URL(creq.url).pathname.slice(5);
        if(curl_ !== "login" && curl_ !== "poll" && curl_ !== "tb-callback" && curl_ !== "notify-settings" && curl_ !== "simulate"){
          var scopes = scopeKeyForRoute(curl_);
          context.waitUntil((async function(){
            for(var i=0;i<scopes.length;i++){ await setSetting(context.env, scopes[i], String(Date.now())).catch(function(){}); }
            await setSetting(context.env, "data_ver", String(Date.now())).catch(function(){});
          })());
        }
      }
    } catch(e2){ /* 版本号递增失败不影响主响应 */ }
    return resp;
  } catch(e){
    var msg = (e && e.message) ? e.message : String(e);
    return json({error:"服务器错误: " + msg}, 500);
  }
}
async function handleApi(context){
  var req = context.request, env = context.env;
  var url = new URL(req.url);
  var p = url.pathname;
  if(req.method === "OPTIONS"){ return new Response(null, {status:204, headers:{"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,authorization"}}); }
  var route = p.slice(5); // 去除 "/api/" 前缀
  var token = tokenFromReq(req);
  var user = await getUser(env, token);
  var body = {};
  if(req.method === "POST"){ try { body = await req.json(); } catch(e){ body = {}; } }
  if(route === "login" && req.method === "POST") return await apiLogin(env, body);
  // 轻量轮询：一条 SQL（扫描 4 行 settings）返回三域版本号，前端据此只拉发生变化的域
  if(route === "poll" && req.method === "GET"){ if(!user) return json({error:"未登录"}, 401); var pv=await scopeVers(env.DB); return json(pv); }
  // 分域拉取：前端 poll 发现某域版本变化后，只拉该域数据（base=目录配置 / ops=单据推荐 / inv=库存销售）
  // 增量(delta)：带 since=上次同步ISO时间 时，只返回该时间之后变化的单据；带 salesSince= 时只返回该时间之后新上报的销售
  if(route === "bs" && req.method === "GET"){
    if(!user) return json({error:"未登录"}, 401);
    var scope = url.searchParams.get("scope") || "";
    var since = url.searchParams.get("since") || "";
    var salesSince = url.searchParams.get("salesSince") || "";
    if(scope === "base") return json(await bsBase(env.DB));
    if(scope === "ops") return json(await bsOps(env.DB, user, since));
    if(scope === "inv") return json(await bsInv(env.DB, user, salesSince));
    return json({error:"未知 scope"}, 400);
  }
  if(route === "bootstrap" && req.method === "GET"){ if(!user) return json({error:"未登录"}, 401); return json(await bootstrap(env, user)); }
  if(route === "sale"){ if(!user) return json({error:"未登录"}, 401); if(body.op==="delete") return await apiDeleteSale(env, user, body); return await apiCreateSale(env, user, body); }
  if(route === "simulate"){ if(!user) return json({error:"未登录"}, 401); return await apiSimulate(env, user); }
  if(route === "doc"){ if(!user) return json({error:"未登录"}, 401); return await apiCreateDoc(env, user, body); }
  if(route === "alloc"){ if(!user) return json({error:"未登录"}, 401); return await apiCreateAlloc(env, user, body); }
  if(route === "approve"){ if(!user) return json({error:"未登录"}, 401); var id = url.searchParams.get("id") || body.id; var decision = url.searchParams.get("decision") || body.decision; var note = url.searchParams.get("note") || body.note; return await apiApprove(env, user, id, decision, note); }
  if(route === "confirm-alloc"){ if(!user) return json({error:"未登录"}, 401); return await apiConfirmAlloc(env, user, body); }
  if(route === "material"){ if(!user) return json({error:"未登录"}, 401); return await apiMaterial(env, user, body); }
  if(route === "store"){ if(!user) return json({error:"未登录"}, 401); return await apiStore(env, user, body); }
  if(route === "user"){ if(!user) return json({error:"未登录"}, 401); return await apiUser(env, user, body); }
  if(route === "notify-settings"){ if(!user) return json({error:"未登录"}, 401); return await apiNotifySettings(env, user, req, body); }
  if(route === "product"){ if(!user) return json({error:"未登录"}, 401); return await apiProduct(env, user, body); }
  if(route === "addon"){ if(!user) return json({error:"未登录"}, 401); return await apiAddon(env, user, body); }
  if(route === "reco"){ if(!user) return json({error:"未登录"}, 401); return await apiReco(env, user, body); }
  if(route === "summary"){ if(!user) return json({error:"未登录"}, 401); return await apiSummary(env, user, url); }
  if(route === "settlement"){ if(!user) return json({error:"未登录"}, 401); return await apiSettlement(env, user, url); }
  if(route === "export-alloc"){ if(!user) return json({error:"未登录"}, 401); return await apiExportAlloc(env, user, url); }
  if(route === "platform-cred"){ if(!user) return json({error:"未登录"}, 401); return await apiPlatformCred(env, user, body); }
  if(route === "platform-shops"){ if(!user) return json({error:"未登录"}, 401); return await apiPlatformShops(env, user, body); }
  if(route === "platform-items"){ if(!user) return json({error:"未登录"}, 401); return await apiPlatformItems(env, user, body); }
  if(route === "tb-callback" && req.method === "GET"){ return json({message:"ok"}); } // 推送地址连通性探测
  if(route === "tb-callback" && req.method === "POST"){ return await apiTbCallback(env, user, body); }
  if(route === "platform-pull"){ if(!user) return json({error:"未登录"}, 401); return await apiPlatformPull(env, user, body); }
  return json({error:"未知接口: " + route}, 404);
}
export { onRequest };

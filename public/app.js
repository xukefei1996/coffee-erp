/* 咖啡店进销存工作台 · 前端（API 驱动，直连 Cloudflare D1）
   与后端 functions/api/[[path]].js 协同：数据全部经 /api/* 读写，本地仅做缓存镜像。 */
(function () {
  'use strict';

  // ---------- 常量 ----------
  var CHANNELS = [
    { id: 'taobao', name: '淘宝闪购' }, { id: 'meituan', name: '美团外卖' },
    { id: 'miniapp', name: '堂食小程序' }, { id: 'jd', name: '京东外卖' },
    { id: 'group', name: '团购' }, { id: 'cmb', name: '招商信用卡' },
    { id: 'cash', name: '堂食现金' }, { id: 'other', name: '其他' }
  ];
  var CHANNEL_NAME = {};
  CHANNELS.forEach(function (c) { CHANNEL_NAME[c.id] = c.name; });
  var PRODUCT_PRICE = { p1: 28, p2: 22, p3: 26, p4: 30, p5: 32 };
  var STATUS_LABEL = {
    pending_manager: '待店长审', pending_hq: '待总部审', approved: '已通过', rejected: '已驳回',
    allocated: '已配货', pending_store_confirm: '待门店收货', confirmed: '已入库', draft: '草稿',
    diff_pending_hq: '差异待复核', cancelled: '已作废'
  };
  var STATUS_CLASS = {
    pending_manager: 'pending', pending_hq: 'pending', approved: 'approved', rejected: 'rejected',
    allocated: 'pending', pending_store_confirm: 'pending', confirmed: 'approved', draft: 'draft',
    diff_pending_hq: 'pending', cancelled: 'rejected'
  };
  var DOC_TYPE = { req: '订货单', alloc: '配货单', stk: '盘点单', ret: '退货单' };

  // ---------- 状态 ----------
  var TOKEN = localStorage.getItem('erp_token') || '';
  var DB = null;     // 后端镜像：{stores,materials,products,addons,boms,inventory,sales,docs,recos,currentUser}
  var USER = null;
  var VIEW = 'sales';
  var VIEW_STATE = {};

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return (n == null ? 0 : n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
  function money(n) { return '¥' + fmt(n); }
  function byId(arr, id) { return (arr || []).filter(function (x) { return x.id === id; })[0] || null; }
  function todayStr() { var d = new Date(); var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function unitOf(mid) { var m = byId(DB.materials, mid); return m ? m.unit : ''; }
  function matName(mid) { var m = byId(DB.materials, mid); return m ? m.name : mid; }
  // 规格中转站：包装换算（库存/BOM 仍为基础单位，仅在订货输入与库存显示时换算）
  function matPack(m) { return (m && m.pack_qty > 0) ? { qty: m.pack_qty, unit: m.pack_unit || '件' } : null; }
  function packOf(mid) { return matPack(byId(DB.materials, mid)); }
  // 包装值 → 基础单位数量（订货保存时用）
  function packToBase(mid, packVal) { var p = packOf(mid); return p ? packVal * p.qty : packVal; }
  // 盘点单位（如 1罐=330ml / 1盒=1000ml）：未单独设置时回退「订货包装单位」（沿用当前便利做法）
  // —— 盘点与订货是两套独立算法：盘点按盘点单位（无则回退订货单位），订货按包装单位+最低订货量
  function matStk(m) { return (m && m.stk_unit && m.stk_qty > 0) ? { qty: m.stk_qty, unit: m.stk_unit } : matPack(m); }
  function stkOf(mid) { return matStk(byId(DB.materials, mid)); }
  function stkToBase(mid, stkVal) { var p = stkOf(mid); return p ? stkVal * p.qty : stkVal; }
  // 盘点数量的友好显示（优先二级单位，如 "12 罐 150 ml"）
  function stkShow(qty, mid) {
    var m = byId(DB.materials, mid); if (!m) return fmt(qty);
    var p = stkOf(mid);
    if (!p || !qty) return fmt(qty) + ' ' + m.unit;
    var whole = Math.floor(qty / p.qty);
    var rem = qty - whole * p.qty;
    var s = whole > 0 ? (whole + ' ' + p.unit) : '';
    if (rem > 0) s += (s ? ' ' : '') + fmt(rem) + ' ' + m.unit;
    return s || ('0 ' + m.unit);
  }
  // 基础单位数量 → 友好显示（如 "3 箱" / "4 箱 11750 ml"）
  function packShow(qty, mid) {
    var m = byId(DB.materials, mid); if (!m) return fmt(qty);
    var p = packOf(mid);
    if (!p || !qty) return fmt(qty) + ' ' + m.unit;
    var whole = Math.floor(qty / p.qty);
    var rem = qty - whole * p.qty;
    var s = whole > 0 ? (whole + ' ' + p.unit) : '';
    if (rem > 0) s += (s ? ' ' : '') + fmt(rem) + ' ' + m.unit;
    return s || ('0 ' + m.unit);
  }
  function matPrice(mid){ var m = byId(DB.materials, mid); return m ? (parseFloat(m.price)||0) : 0; }
  function recipeCost(bomArr){
    var t = 0;
    (bomArr||[]).forEach(function(b){ t += (parseFloat(b.qty)||0) * matPrice(b.mid); });
    return t;
  }
  function recipeCostAll(pid){
    var total = 0;
    [["hot","M"],["ice","M"]].forEach(function(c){ total += recipeCost(DB.boms[pid+"|"+c[0]+"|"+c[1]]||[]); });
    return total;
  }
  function costBadge(cost){
    return cost > 0
      ? '<span class="reco-cost">成本 ' + money(cost) + '</span>'
      : '<span class="reco-cost reco-cost-muted">未设成本</span>';
  }
  // 单笔销售的理论成本（含加料）。
  // temp=less（少冰）复用冰配方；size=L（大杯）为未来预留位、暂无配方，回退用 12OZ 核算。
  function saleUnitCost(s){
    var t = (s.temp === 'less' || s.temp === 'noice') ? 'ice' : s.temp;
    var z = (s.size === 'L') ? 'M' : s.size;
    var c = recipeCost(DB.boms[s.pid + '|' + t + '|' + z] || []);
    var ad = s.addons || [];
    if (typeof ad === 'string') { try { ad = JSON.parse(ad); } catch (e) { ad = []; } }
    ad.forEach(function(a){
      var aid = (a && typeof a === 'object') ? a.id : a;
      c += recipeCost(DB.boms['a|' + aid] || []);
    });
    return c;
  }
  // 汇总一批销售记录：收入、理论成本、毛利、毛利率
  function profitOf(list){
    var r = { qty:0, income:0, cost:0, profit:0, rate:0, noBom:0 };
    (list||[]).forEach(function(s){
      var q = s.qty || 1, u = saleUnitCost(s);
      if (u <= 0) r.noBom++;
      r.qty += q; r.income += (s.income || 0); r.cost += u * q;
    });
    r.profit = r.income - r.cost;
    r.rate = r.income > 0 ? (r.profit / r.income * 100) : 0;
    return r;
  }
  function tempLabel(t) { return t === 'hot' ? '标准热' : (t === 'ice' ? '标准冰' : (t === 'noice' ? '去冰' : '少冰')); }
  function sizeLabel(s) { return s === 'L' ? '大杯' : (s === 'M' ? '12OZ' : (s || '')); }
  // 录入时间（created_at 为 UTC ISO，转本地时区 HH:mm）
  function timeHM(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // ---------- API ----------
  function apiCall(path, body, method) {
    return new Promise(function (resolve, reject) {
      var opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
      if (TOKEN) opt.headers['authorization'] = 'Bearer ' + TOKEN;
      if (body || method === 'POST') { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body || {}); }
      fetch('/api/' + path, opt).then(function (res) {
        res.json().then(function (data) {
          if (!res.ok) reject(new Error((data && data.error) || ('请求失败 (' + res.status + ')')));
          else resolve(data);
        }).catch(function () { reject(new Error('响应解析失败')); });
      }).catch(function (e) { reject(e); });
    });
  }
  function apiGet(p) { return apiCall(p, null, 'GET'); }
  function apiPost(p, b) {
    return apiCall(p, b, 'POST').then(function (r) {
      // 用户操作成功 → 视为一次有效活动，并立即触发一次增量同步（审批结果/新单据及时可见）
      markActivity();
      if (!document.hidden) backgroundSync();
      return r;
    });
  }
  async function downloadAllocDetail() {
    var mi = document.getElementById('allocExportMonth');
    var month = mi ? mi.value : '';
    if (!month) { toast('请选择月份'); return; }
    toast('正在导出 ' + month + ' 配货明细…');
    var d = await apiGet('export-alloc?month=' + encodeURIComponent(month));
    if (!d || !d.ok) { toast(d && d.error ? d.error : '导出失败'); return; }
    if (!d.rows || !d.rows.length) { toast(month + ' 没有配货明细'); return; }
    var headers = ['单号','门店','日期','状态','物料编码','物料名称','规格','单价(元)','配货数','单位','实收数','差异数','金额(元)'];
    var lines = [headers.map(csvCell).join(',')];
    d.rows.forEach(function (r) {
      lines.push([r.doc_id, r.store, r.date, r.status, r.mid, r.mat_name, r.spec, r.unit_price, r.alloc_pack, r.pack_unit, r.actual_pack, r.diff_pack, r.amount].map(csvCell).join(','));
    });
    triggerCsv('配货明细_' + month + '.csv', lines.join('\n'));
  }

  async function refresh() { var d = await apiGet('bootstrap'); DB = d; USER = d.currentUser; if (d && d.vers) LAST_VER = { base: String(d.vers.base || ''), docs: String(d.vers.docs || ''), inv: String(d.vers.inv || '') }; lastDocsSync = new Date().toISOString(); lastSalesSync = new Date().toISOString(); }
  // 登录态后台自动同步（分域版）：每 60 秒调一次 /api/poll（一条 SQL 扫 4 行 settings），
  // 只拉发生变化的域——base(目录/物料)/ops(单据/推荐)/inv(库存/销售)。
  // 背景：D1 免费版每日 500 万行读取。全量 bootstrap 单次 2300+ 行，营业时段销售高频写入，
  // 若每次写都全量刷新，多台在线设备一天即烧光配额（10-10 全系统 500 的事故根因）。
  // 因此：单据域实时拉（审批结果及时可见）；库存/销售域节流（5 分钟最多一次，门店对它无秒级要求）。
  var AUTO_SYNC_MS = 60000;
  var INV_THROTTLE_MS = 300000; // 库存/销售域节流：5 分钟
  var LAST_VER = { base: '', docs: '', inv: '' };
  var lastInvPull = 0;
  // 空闲停止：超过 IDLE_STOP_MS 无任何操作（点击/触摸/按键）则不再轮询，避免手机页面长时间停留空耗 D1 配额；
  // 重新操作一次即恢复（见 markActivity / apiPost 成功钩子）
  var IDLE_STOP_MS = 300000; // 5 分钟
  var lastActivity = Date.now();
  // 增量(delta)同步游标：记录上次成功拉取单据/销售的时间(ISO)，仅向服务端要「此后的变化」，不重拉历史
  var lastDocsSync = '';
  var lastSalesSync = '';
  function markActivity() { lastActivity = Date.now(); }
  function mergeById(existing, incoming, sortKey) {
    var map = {};
    (existing || []).forEach(function (x) { if (x && x.id) map[x.id] = x; });
    (incoming || []).forEach(function (x) { if (x && x.id) map[x.id] = x; });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    if (sortKey) arr.sort(function (a, b) { return (b[sortKey] || '').localeCompare(a[sortKey] || ''); });
    return arr;
  }
  async function bsPullScopes(pv, want) {
    // want: {base,docs,inv} 需要拉取的域；逐域调 /api/bs 并合并进 DB（单据/销售走增量 delta，只拉变化行）
    if (want.base) { var b = await apiGet('bs?scope=base'); DB.stores = b.stores; DB.materials = b.materials; DB.products = b.products; DB.addons = b.addons; DB.boms = b.boms; }
    if (want.docs) {
      var o = await apiGet('bs?scope=ops&since=' + encodeURIComponent(lastDocsSync));
      DB.docs = mergeById(DB.docs, o.docs, 'created_at'); // 历史已审批/驳回单据保留，仅合并变化行
      DB.recos = o.recos;
      if ((o.docs || []).length) lastDocsSync = new Date().toISOString();
    }
    if (want.inv) {
      var iv = await apiGet('bs?scope=inv&salesSince=' + encodeURIComponent(lastSalesSync));
      DB.inventory = iv.inventory;
      DB.sales = mergeById(DB.sales, iv.sales, 'created_at'); // 历史销售保留，仅合并新上报行
      lastInvPull = Date.now();
      if ((iv.sales || []).length) lastSalesSync = new Date().toISOString();
    }
    // 只把「实际拉取过的域」的版本号推进到服务端值；被节流跳过的域保留旧值，下个周期到点后重拉
    if (want.base) LAST_VER.base = String(pv.base || '');
    if (want.docs) LAST_VER.docs = String(pv.docs || '');
    if (want.inv) LAST_VER.inv = String(pv.inv || '');
  }
  async function backgroundSync() {
    if (!TOKEN) return; // 未登录不轮询
    if (document.hidden) return; // 页面不可见（锁屏/切后台）不轮询，节省 D1 配额；切回可见时由 visibilitychange 触发
    if (Date.now() - lastActivity > IDLE_STOP_MS) return; // 空闲超过 5 分钟（手机页面停留无人操作）停止轮询，省配额；操作一次即恢复
    try {
      var pv = await apiGet('poll'); // {ver, base, docs, inv}
      if (!pv) return;
      var want = {
        base: String(pv.base || '') !== LAST_VER.base,
        docs: String(pv.docs || '') !== LAST_VER.docs,
        inv: String(pv.inv || '') !== LAST_VER.inv && (Date.now() - lastInvPull >= INV_THROTTLE_MS)
      };
      if (!want.base && !want.docs && !want.inv) return; // 数据无变化
      await bsPullScopes(pv, want);
      // 仅在没有弹窗、且用户当前没有在输入框里打字时才重绘，避免打断正在填写的表单/盘点
      var modalOpen = !!document.querySelector('#modal-root .modal-mask');
      if (modalOpen) return;
      var ae = document.activeElement;
      var typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
      if (typing) return;
      var c = document.getElementById('content');
      var st = c ? c.scrollTop : 0;
      render();
      if (c) c.scrollTop = st; // 尽量保留滚动位置，减少跳动
    } catch (e) { /* 网络抖动忽略，下个周期再试 */ }
  }
  function logout() { TOKEN = ''; localStorage.removeItem('erp_token'); USER = null; render(); }

  async function doLogin(username, password) {
    var d = await apiPost('login', { username: username, password: password });
    TOKEN = d.token; localStorage.setItem('erp_token', TOKEN); USER = d.user;
    await refresh(); VIEW = defaultView(); render(); maybeOpenDocFromUrl();
  }
  // 深链：从钉钉消息点击 /?doc=单号 进入时，自动打开对应单据
  function maybeOpenDocFromUrl() {
    try {
      var p = new URLSearchParams(location.search);
      var id = p.get('doc');
      if (id && DB && DB.docs) {
        var doc = byId(DB.docs, id);
        if (doc) setTimeout(function () { openDocDetail(id); }, 300);
      }
    } catch (e) { /* 忽略 URL 解析异常 */ }
  }

  // ---------- 导航（门店：销售出库 → 销售分析 → 门店盘点 → 订货管理；总部：管理 → 盘点 → 订货 → 销售） ----------
  function moduleList(role) {
    var mgmtChildren = (role === 'hq')
      ? [
          { view: 'dashboard', label: '总部总览' },
          { view: 'catalog', label: '商品与配方' },
          { view: 'materials', label: '物料目录' },
          { view: 'stores', label: '门店管理' },
          { view: 'notify', label: '消息提醒' },
          { view: 'summary', label: '销售汇总' },
          { view: 'settlement', label: '结算单' },
          { view: 'platform', label: '淘宝闪购对接' }
        ]
      : [{ view: 'mgmt', label: '设置' }];
    if (role === 'hq') {
      return [
        { id: 'mgmt', label: '管理', icon: 'gear', roles: ['manager', 'clerk', 'hq'], children: mgmtChildren },
        { id: 'inv', label: '门店盘点', icon: 'clip', roles: ['manager', 'clerk', 'hq'], children: [
          { view: 'inventory', label: '库存查询' },
          { view: 'stk', label: '盘点单' }
        ] },
        { id: 'order', label: '订货管理', icon: 'box', roles: ['manager', 'clerk', 'hq'], children: [
          { view: 'reco', label: '智能推荐' },
          { view: 'req', label: '订货单' },
          { view: 'alloc', label: '配货单' },
          { view: 'ret', label: '退货单' }
        ] },
        { id: 'sales', label: '销售出库', icon: 'cup', view: 'sales', roles: ['manager', 'clerk', 'hq'] }
      ];
    }
    // 店长/店员：销售出库放第一位（高频操作），其余顺延
    return [
      { id: 'sales', label: '销售出库', icon: 'cup', view: 'sales', roles: ['manager', 'clerk', 'hq'] },
      { id: 'analysis', label: '销售分析', icon: 'chart', view: 'salesAnalysis', roles: ['manager', 'clerk', 'hq'] },
      { id: 'inv', label: '门店盘点', icon: 'clip', roles: ['manager', 'clerk', 'hq'], children: [
        { view: 'inventory', label: '库存查询' },
        { view: 'stk', label: '盘点单' }
      ] },
      { id: 'order', label: '订货管理', icon: 'box', roles: ['manager', 'clerk', 'hq'], children: [
        { view: 'reco', label: '智能推荐' },
        { view: 'req', label: '订货单' },
        { view: 'alloc', label: '配货单' },
        { view: 'ret', label: '退货单' }
      ] }
    ];
  }
  function moduleOfView(v) {
    var tree = moduleList(USER.role);
    for (var i = 0; i < tree.length; i++) {
      var m = tree[i];
      if (m.view === v) return m.id;
      if (m.children) for (var j = 0; j < m.children.length; j++) if (m.children[j].view === v) return m.id;
    }
    return 'sales';
  }
  function goModule(modId) {
    var tree = moduleList(USER.role);
    for (var i = 0; i < tree.length; i++) {
      if (tree[i].id === modId) {
        var m = tree[i];
        if (m.view) VIEW = m.view;
        else if (m.children && m.children.length) VIEW = m.children[0].view;
        break;
      }
    }
    render();
  }
  function roleLabel(r) { return r === 'hq' ? '总部' : (r === 'manager' ? '店长' : '店员'); }
  // 单据未完结数（草稿+在途审核；配货单统计差异待复核），用于导航红色徽标
  function docBadgeCount(type) {
    var docs = DB.docs || [];
    var list = USER.role === 'hq' ? docs : docs.filter(function (d) { return d.store_id === USER.store_id; });
    var n = 0;
    list.forEach(function (d) {
      if (d.type !== type) return;
      if (type === 'alloc') { if (d.status === 'diff_pending_hq') n++; }
      else if (d.status === 'draft' || d.status === 'pending_manager' || d.status === 'pending_hq') n++;
    });
    return n;
  }
  function docBadgeHTML(type) { var n = docBadgeCount(type); return n > 0 ? '<span class="nav-badge">' + n + '</span>' : ''; }
  function modBadgeHTML(modId) {
    var n = 0;
    if (modId === 'inv') n = docBadgeCount('stk');
    else if (modId === 'order') n = docBadgeCount('req') + docBadgeCount('ret') + docBadgeCount('alloc');
    return n > 0 ? '<span class="nav-badge">' + n + '</span>' : '';
  }
  function defaultView() { return USER.role === 'hq' ? 'dashboard' : 'sales'; }

  // ---------- 弹窗 / 提示 ----------
  function openModal(html) {
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-mask"><div class="modal">' + html + '</div></div>';
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#23290f;color:#fff;padding:10px 16px;border-radius:8px;z-index:99;box-shadow:0 6px 18px rgba(0,0,0,.2);font-size:13px'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, ms || 2600);
  }

  // ---------- 渲染骨架（render/renderNav/renderContent 见下方拆分实现） ----------
  function loginView() {
    var brandSVG = '<svg class="brand-mark" viewBox="0 0 72 72" aria-hidden="true"><rect x="4" y="4" width="64" height="64" rx="14" fill="#ffffff"/><path d="M22 52V22h6l8 16 8-16h6v30h-6V34l-8 16-8-16v18z" fill="#586528"/><text x="36" y="62" text-anchor="middle" font-size="8" font-weight="700" fill="#586528" font-family="Arial,sans-serif">SPACE</text></svg>';
    return '<div class="login-wrap"><div class="login-card">' +
      '<div class="login-brand">' + brandSVG + '<div><div class="login-title">Maray Coffee</div><div class="login-tagline">Single Origin Coffee · 单产地咖啡</div></div></div>' +
      '<div class="login-sub">MARAY SPACE · 咖啡店进销存工作台</div>' +
      '<div class="field"><label>账号</label><input id="login_user" class="in" placeholder="请输入账号" autocomplete="username"></div>' +
      '<div class="field"><label>密码</label><input id="login_pass" class="in" type="password" placeholder="请输入密码" autocomplete="current-password"></div>' +
      '<button class="btn btn-primary" style="width:100%;justify-content:center" data-act="login">登录</button>' +
      '</div></div>';
  }
  // 渲染拆分：骨架(shellSkeleton)只建一次；renderNav/renderContent 局部更新。
  // 这样每次提交后 refresh()+render() 只重绘导航徽标与内容区，不再重建整个页面（提升移动端响应速度）。
  var SHELL_BUILT = false;
  function render() {
    var app = document.getElementById('app');
    if (!USER) { app.innerHTML = loginView(); SHELL_BUILT = false; return; }
    if (!SHELL_BUILT) { app.innerHTML = shellSkeleton(); SHELL_BUILT = true; }
    renderNav();
    renderContent();
  }
  function shellSkeleton() {
    return '<div class="layout">' +
      '<aside class="sidebar" id="sidebar"></aside>' +
      '<div class="main">' +
      '<div class="topbar" id="topbar"></div>' +
      '<div id="subtabs-host"></div>' +
      '<div class="content" id="content"></div>' +
      '</div>' +
      '<nav class="mobile-tabs" id="mobile-tabs"></nav>' +
      '</div>';
  }
  function renderNav() {
    var tree = moduleList(USER.role);
    var curMod = moduleOfView(VIEW);
    var who = esc(USER.name) + ' · ' + roleLabel(USER.role) + (USER.store_id ? (' · ' + (byId(DB.stores, USER.store_id) ? byId(DB.stores, USER.store_id).name : '')) : '');
    var side = tree.map(function (m) {
      var body = (m.view) ? navBtn(m.view, m.label, docBadgeHTML(m.view))
        : (m.children ? m.children.map(function (c) { return navBtn(c.view, c.label, docBadgeHTML(c.view)); }).join('') : '');
      return '<div class="nav-group"><div class="nav-group-head">' + m.label + '</div><div class="nav-group-body">' + body + '</div></div>';
    }).join('');
    var sb = document.getElementById('sidebar');
    if (sb) sb.innerHTML =
      '<div class="brand"><div class="logo">M</div><div class="brand-text"><b>Maray Coffee</b><span>Single Origin Coffee</span></div></div>' +
      side +
      '<div class="nav-spacer"></div>' +
      '<div class="who"><b>' + who + '</b><button class="btn-link" data-act="userCenter">用户中心</button></div>';
    // 底部 Tab（移动端显示）：品牌主色块 + 反白文字，无图标
    var tabs = tree.map(function (m) {
      return '<button class="nav-tab ' + (curMod === m.id ? 'active' : '') + '" data-act="module" data-mod="' + m.id + '">' +
        '<span class="tab-label">' + m.label + '</span>' + modBadgeHTML(m.id) + '</button>';
    }).join('');
    var mt = document.getElementById('mobile-tabs');
    if (mt) mt.innerHTML = tabs;
  }
  function renderContent() {
    var tree = moduleList(USER.role);
    var curMod = moduleOfView(VIEW);
    var curModObj = null;
    for (var i = 0; i < tree.length; i++) if (tree[i].id === curMod) curModObj = tree[i];
    // 子标签（当前模块含多个子项时显示）
    var subtabs = '';
    if (curModObj && curModObj.children && curModObj.children.length > 1) {
      subtabs = '<div class="subtabs">' + curModObj.children.map(function (c) {
        return '<button class="subchip ' + (VIEW === c.view ? 'active' : '') + '" data-act="nav" data-view="' + c.view + '">' + c.label + docBadgeHTML(c.view) + '</button>';
      }).join('') + '</div>';
    }
    var tb = document.getElementById('topbar');
    if (tb) tb.innerHTML =
      '<h1>' + viewTitle() + '</h1><div class="crumb">' + crumb() + '</div><div class="spacer"></div>' +
      '<div class="top-actions"><button class="btn-user" data-act="userCenter">' + esc(USER.name) + ' · 用户中心</button></div>';
    var sh = document.getElementById('subtabs-host');
    if (sh) sh.innerHTML = subtabs;
    var ct = document.getElementById('content');
    if (ct) ct.innerHTML = viewHTML();
  }
  function navBtn(view, label, badge) {
    return '<button class="nav-item ' + (VIEW === view ? 'active' : '') + '" data-act="nav" data-view="' + view + '">' + label + (badge || '') + '</button>';
  }
  function viewTitle() {
    var m = { sales: '销售出库', inventory: '库存查询', req: '订货单', alloc: '配货单', stk: '盘点单', ret: '退货单', reco: '智能推荐订货', catalog: '商品与配方', materials: '物料目录', stores: '门店管理', notify: '消息提醒', summary: '销售汇总', dashboard: '总部总览', settlement: '结算单', salesAnalysis: '销售分析', platform: '淘宝闪购对接' };
    return m[VIEW] || '';
  }
  function crumb() { return USER.role === 'hq' ? '总部视角' : (byId(DB.stores, USER.store_id) ? byId(DB.stores, USER.store_id).name : ''); }

  function viewHTML() {
    switch (VIEW) {
      case 'sales': return viewSales();
      case 'inventory': return viewInventory();
      case 'req': return viewDocList('req');
      case 'alloc': return viewDocList('alloc');
      case 'stk': return viewDocList('stk');
      case 'ret': return viewDocList('ret');
      case 'reco': return viewReco();
      case 'catalog': return viewCatalog();
      case 'materials': return viewMaterials();
      case 'stores': return viewStores();
      case 'summary': return viewSummary();
      case 'dashboard': return viewDashboard();
      case 'settlement': return viewSettlement();
      case 'notify': return viewNotify();
      case 'mgmt': return viewMgmt();
      case 'salesAnalysis': return viewSalesAnalysis();
      case 'platform': return viewPlatform();
      default: return '<div class="empty">未找到该页面</div>';
    }
  }

  // ---------- 销售出库（购物车：一单多品 + 外卖实付分摊） ----------
  // 某商品在某温度下可用的杯型（有配方才可选；L 杯全线未配配方时自动隐藏）
  function sizesFor(pid, temp) {
    var t = (temp === 'less' || temp === 'noice') ? 'ice' : temp;
    var out = [];
    if ((DB.boms[pid + '|' + t + '|M'] || []).length) out.push('M');
    if ((DB.boms[pid + '|' + t + '|L'] || []).length) out.push('L');
    if (!out.length) out.push('M');
    return out;
  }
  function sizeOptionsHTML(pid, temp) {
    return sizesFor(pid, temp).map(function (s) {
      return '<option value="' + s + '">' + sizeLabel(s) + '</option>';
    }).join('');
  }
  function prodStd(pid, size, qty) {
    var p = byId(DB.products, pid);
    var base = (p && p.price > 0) ? p.price : (PRODUCT_PRICE[pid] || 25);
    return Math.round(base * (size === 'L' ? 1.15 : 1) * (parseInt(qty, 10) || 1) * 100) / 100;
  }
  function viewSales() {
    if (USER.role === 'hq') return '<div class="empty">总部账号不直接出库，请在门店账号下操作。</div>';
    if (!VIEW_STATE.salesCart) VIEW_STATE.salesCart = [];
    var cart = VIEW_STATE.salesCart;
    var prods = (DB.products || []).filter(function (p) { return p.active; }).map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + (p.price > 0 ? '（' + money(p.price) + '）' : '') + '</option>';
    }).join('');
    var adds = (DB.addons || []).map(function (a) {
      return '<label class="check"><input type="checkbox" class="sale-addon" value="' + a.id + '"> ' + esc(a.name) + '（+' + fmt(a.price) + '）</label>';
    }).join('');
    var chOpts = CHANNELS.map(function (c) { return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('');
    var cartRows = '', cartCards = '';
    cart.forEach(function (it, idx) {
      var p = byId(DB.products, it.pid);
      var addonNames = (it.addons || []).map(function (a) { var x = byId(DB.addons, a); return x ? x.name : a; }).join('、') || '—';
      var std = prodStd(it.pid, it.size, it.qty);
      (it.addons || []).forEach(function (aid) { var a = byId(DB.addons, aid); if (a) std += a.price * (parseInt(it.qty, 10) || 1); });
      var amt = money(Math.round(std * 100) / 100);
      var specTxt = esc(tempLabel(it.temp)) + '/' + esc(sizeLabel(it.size));
      cartRows += '<tr><td>' + esc(p ? p.name : it.pid) + '</td><td>' + specTxt + '</td><td>' + esc(addonNames) + '</td><td class="num">' + it.qty + '</td><td class="num">' + amt + '</td><td class="ops"><button class="btn btn-sm btn-danger" data-act="delCartRow" data-idx="' + idx + '">删除</button></td></tr>';
      cartCards += '<div class="flow-card"><div class="flow-head"><div><div class="flow-title">' + esc(p ? p.name : it.pid) + ' <span class="flow-spec">' + specTxt + '</span></div>' +
        '<div class="flow-sub">加料：' + esc(addonNames) + '</div></div>' +
        '<button class="btn btn-sm btn-danger" data-act="delCartRow" data-idx="' + idx + '">删除</button></div>' +
        '<div class="flow-meta"><span>× ' + it.qty + ' 件</span><b>' + amt + '</b></div></div>';
    });
    var stdSum = cart.reduce(function (s, it) {
      var std = prodStd(it.pid, it.size, it.qty);
      (it.addons || []).forEach(function (aid) { var a = byId(DB.addons, aid); if (a) std += a.price * (parseInt(it.qty, 10) || 1); });
      return s + std;
    }, 0);
    // 最新录入排最上方（按录入时间倒序，方便核对与撤销）
    var recent = (DB.sales || []).slice().sort(function (a, b) {
      var ka = String(a.created_at || a.date || ''), kb = String(b.created_at || b.date || '');
      return kb.localeCompare(ka);
    }).slice(0, 30);
    var rows = '', flowCards = '';
    recent.forEach(function (s) {
      var p = byId(DB.products, s.pid);
      var back = (s.date < todayStr()) ? ' <span class="tag-pill reco">补录</span>' : '';
      var ord = s.order_no ? ' <span class="tag-pill">单</span>' : '';
      var tm = timeHM(s.created_at);
      var addonTxt = (s.addons || []).map(function (a) { var x = byId(DB.addons, a); return x ? x.name : a; }).join('、') || '—';
      var specTxt = esc(tempLabel(s.temp)) + '/' + esc(sizeLabel(s.size));
      var chTxt = esc(CHANNEL_NAME[s.channel] || s.channel);
      var amt = money(s.income);
      rows += '<tr><td class="nowrap">' + s.date + (tm ? ' <span class="flow-time">' + tm + '</span>' : '') + back + ord + '</td><td>' + esc(p ? p.name : s.pid) + '</td><td>' + specTxt + '</td><td>' + esc(addonTxt) + '</td><td class="num">' + s.qty + '</td><td class="num">' + amt + '</td><td>' + chTxt + '</td><td class="ops"><button class="btn btn-sm btn-danger" data-act="voidSale" data-id="' + s.id + '" data-ord="' + esc(s.order_no || '') + '">撤销</button></td></tr>';
      flowCards += '<div class="flow-card"><div class="flow-head"><div><div class="flow-title">' + esc(p ? p.name : s.pid) + ' <span class="flow-spec">' + specTxt + ' · ×' + s.qty + '</span></div>' +
        (addonTxt !== '—' ? '<div class="flow-sub">加料：' + esc(addonTxt) + '</div>' : '') + '</div>' +
        '<button class="btn btn-sm btn-danger" data-act="voidSale" data-id="' + s.id + '" data-ord="' + esc(s.order_no || '') + '">撤销</button></div>' +
        '<div class="flow-meta"><span>' + s.date + (tm ? ' ' + tm : '') + back + ord + ' · ' + chTxt + '</span><b>' + amt + '</b></div></div>';
    });
    return '<div class="grid-2"><div class="card"><h3>登记一笔销售 <span class="tag">自动按配方扣库存</span></h3>' +
      '<div class="hint">一笔订单可含多件商品：逐一选择商品+加料后加入明细，每件可独立选不同加料。<b>「订单实付总额」为必填项</b>：整单顾客实付金额，漏填将无法提交。</div>' +
      '<div class="form-grid" style="margin-top:10px">' +
      '<div><label class="fld">商品</label><select id="cart_pid" class="in">' + prods + '</select></div>' +
      '<div><label class="fld">温度</label><select id="cart_temp" class="in"><option value="hot">标准热</option><option value="ice">标准冰</option><option value="less">少冰</option><option value="noice">去冰</option></select></div>' +
      '<div><label class="fld">杯型</label><select id="cart_size" class="in">' + sizeOptionsHTML((DB.products || []).filter(function (p) { return p.active; })[0] ? ((DB.products || []).filter(function (p) { return p.active; })[0]).id : '', 'hot') + '</select></div>' +
      '<div><label class="fld">数量</label><input id="cart_qty" class="in" type="number" min="1" value="1"></div>' +
      '<div style="grid-column:1/-1"><label class="fld">加料（本行）</label><div style="display:flex;flex-wrap:wrap;gap:8px">' + adds + '</div></div>' +
      '<div style="grid-column:1/-1"><button class="btn" data-act="addCartRow">+ 加入明细</button></div>' +
      '</div>' +
      (cartRows ? '<div class="pc-only"><table style="margin-top:10px"><thead><tr><th>商品</th><th>规格</th><th>加料</th><th class="num">数量</th><th class="num">标准小计</th><th class="ops">操作</th></tr></thead><tbody>' + cartRows + '</tbody></table></div><div class="m-only" style="margin-top:10px">' + cartCards + '</div>' : '<div class="cart-empty" style="margin-top:10px"><span class="cart-empty-icon">🛒</span>暂时未加入商品<span class="cart-empty-sub">请在上方选择「商品 / 温度 / 杯型 / 数量」后，点击「+ 加入明细」</span></div>') +
      '<div class="form-grid" style="margin-top:12px">' +
      '<div><label class="fld">渠道</label><select id="sale_channel" class="in">' + chOpts + '</select></div>' +
      '<div><label class="fld">营业日期</label><input id="sale_date" class="in" type="date" value="' + todayStr() + '"' + (USER.role !== "manager" ? ' disabled' : '') + ' min="' + dayAddJS(todayStr(), -7) + '" max="' + todayStr() + '"></div>' +
      '<div><label class="fld">订单实付总额(元) <span class="req-star">必填</span></label><input id="sale_order_total" class="in" type="number" step="0.01" min="0.01" placeholder="请填写整单实收金额"></div>' +
      '</div>' +
      '<div class="hint" style="margin-top:6px">标准合计：<b>' + money(Math.round(stdSum * 100) / 100) + '</b>（含加料）。「订单实付总额」必填：无优惠时直接填标准合计；外卖满减/券后填顾客实付，系统按标准价占比分摊。</div>' +
      '<div class="toolbar" style="margin-top:14px"><button class="btn btn-warn" data-act="saveSale">确认提交出库（' + cart.length + ' 件）</button>' +
      (cart.length ? '<button class="btn" data-act="clearCart">清空</button>' : '') +
      '<button class="btn btn-disabled" data-act="noop" disabled title="演示功能已禁用">模拟渠道同步（演示）</button></div>' +
      '<div class="hint">“模拟渠道同步”演示功能已禁用，避免误触随机生成订单、污染销售流水与营收/毛利核算。</div>' +
      '</div>' +
      '<div class="card"><h3>近期销售流水</h3>' + (rows ? '<div class="pc-only tbl-scroll"><table><thead><tr><th>日期 · 时间</th><th>商品</th><th>规格</th><th>加料</th><th class="num">数量</th><th class="num">收入</th><th>渠道</th><th class="ops">操作</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="m-only">' + flowCards + '</div>' : '<div class="empty">暂无销售</div>') + '</div></div>';
  }
  async function addCartRow() {
    var pid = val('cart_pid'); if (!pid) { toast('请选择商品'); return; }
    var addons = Array.prototype.slice.call(document.querySelectorAll('.sale-addon:checked')).map(function (e) { return e.value; });
    VIEW_STATE.salesCart = VIEW_STATE.salesCart || [];
    VIEW_STATE.salesCart.push({ pid: pid, temp: val('cart_temp'), size: val('cart_size'), qty: parseInt(val('cart_qty'), 10) || 1, addons: addons });
    render();
  }
  async function delCartRow(idx) { VIEW_STATE.salesCart.splice(idx, 1); render(); }
  async function clearCart() { VIEW_STATE.salesCart = []; render(); }
  // 前端复刻后端 saleNeed：单行商品（含加料）的物料需求
  function saleNeedOf(it) {
    var t = (it.temp === 'less' || it.temp === 'noice') ? 'ice' : it.temp;
    var need = {};
    var qty = parseInt(it.qty, 10) || 1;
    (DB.boms[it.pid + '|' + t + '|' + it.size] || []).forEach(function (b) { need[b.mid] = (need[b.mid] || 0) + b.qty * qty; });
    (it.addons || []).forEach(function (aid) {
      (DB.boms['a|' + aid] || []).forEach(function (b) { need[b.mid] = (need[b.mid] || 0) + b.qty * qty; });
    });
    return need;
  }
  // 购物车整体扣减后将出现负库存的物料清单（负库存=漏登记/配方配错的预警信号）
  function shortageOf(cart) {
    var total = {};
    cart.forEach(function (it) {
      var need = saleNeedOf(it);
      Object.keys(need).forEach(function (mid) { total[mid] = (total[mid] || 0) + need[mid]; });
    });
    var inv = (DB.inventory && DB.inventory[USER.store_id]) || {};
    var out = [];
    Object.keys(total).forEach(function (mid) {
      var have = (inv[mid] != null) ? inv[mid] : 0;
      if (total[mid] > have) {
        var m = byId(DB.materials, mid);
        out.push({ name: m ? m.name : mid, have: Math.round(have * 100) / 100, need: Math.round(total[mid] * 100) / 100 });
      }
    });
    return out;
  }
  async function saveSale() {
    var cart = VIEW_STATE.salesCart || [];
    if (!cart.length) { toast('请先加入至少一件商品'); return; }
    var d = val('sale_date') || todayStr();
    if (d < todayStr()) {
      if (!window.confirm('确认为历史营业日 ' + d + ' 补录这笔销售？补录将按配方扣减当前库存。')) return;
    }
    // 负库存预检：扣减后不足的物料强制确认（负库存是漏登记/配方配错的预警信号，保留记录供盘点校准）
    var short = shortageOf(cart);
    if (short.length) {
      var msg = '以下 ' + short.length + ' 项物料库存不足：\n' +
        short.map(function (x) { return '· ' + x.name + '：现存 ' + x.have + '，本单需 ' + x.need + '，缺 ' + Math.round((x.need - x.have) * 100) / 100; }).join('\n') +
        '\n\n负库存常见原因：销售漏登记、配方配错、入库漏记。\n确认仍要出库？（系统将保留负库存记录，供盘点时校准）';
      if (!window.confirm(msg)) return;
    }
    var items = cart.map(function (it) { return { pid: it.pid, temp: it.temp, size: it.size, qty: it.qty, addons: it.addons || [] }; });
    // 实付总额强制填写（防止新员工误以为留空即可，导致营收按标准价虚记）
    var ot = val('sale_order_total');
    var otNum = parseFloat(ot);
    if (ot === '' || isNaN(otNum) || otNum <= 0) {
      var stdSum = cart.reduce(function (s, it) {
        var std = prodStd(it.pid, it.size, it.qty);
        (it.addons || []).forEach(function (aid) { var a = byId(DB.addons, aid); if (a) std += a.price * (parseInt(it.qty, 10) || 1); });
        return s + std;
      }, 0);
      toast('请先填写「订单实付总额」：整单顾客实付金额（无优惠时填标准合计 ' + money(Math.round(stdSum * 100) / 100) + '）');
      return;
    }
    var body = { items: items, channel: val('sale_channel'), date: d, order_total: otNum };
    if (short.length) body.confirm_shortage = true;
    await apiPost('sale', body);
    VIEW_STATE.salesCart = [];
    await refresh(); render();
    toast(d < todayStr() ? ('已补录 ' + d + ' 销售') : '已登记销售');
  }
  async function voidSale(id, ord) {
    if (ord) {
      if (!window.confirm('确认撤销整笔订单（含全部商品）？库存将自动加回。')) return;
      await apiPost('sale', { op: 'delete', order_no: ord });
    } else {
      if (!window.confirm('确认撤销该笔销售？库存将自动加回。')) return;
      await apiPost('sale', { op: 'delete', id: id });
    }
    await refresh(); render(); toast('已撤销并加回库存');
  }
  async function doSimulate() {
    var r = await apiPost('simulate', {}); await refresh(); render();
    toast('模拟同步 ' + r.count + ' 笔渠道订单，已自动扣库存');
  }

  // ---------- 库存查询 ----------
  function viewInventory() {
    var isHq = USER.role === 'hq';
    var storeId = USER.store_id;
    if (isHq) {
      storeId = (VIEW_STATE.inventory && VIEW_STATE.inventory.store) || (DB.stores[0] ? DB.stores[0].id : '');
    }
    var sel = '';
    if (isHq) {
      sel = '<select class="in" style="width:200px" id="inv_store">' + DB.stores.map(function (s) {
        return '<option value="' + s.id + '" ' + (s.id === storeId ? 'selected' : '') + '>' + esc(s.name) + (s.active ? '' : '（停用）') + '</option>';
      }).join('') + '</select>';
    }
    var inv = (DB.inventory && DB.inventory[storeId]) || {};
    var rows = (DB.materials || []).map(function (m) {
      var q = inv[m.id] || 0;
      var neg = q < 0;
      var low = !neg && m.min_order && q < m.min_order;
      var pill = neg ? '<span class="tag-pill low">负库存 · 待盘点校准</span>' : (low ? '<span class="tag-pill low">低于安全库存</span>' : '<span class="tag-pill ok">正常</span>');
      return '<tr class="' + (neg || low ? 'row-danger' : '') + '"><td>' + esc(m.name) + '</td><td>' + esc(m.unit) + '</td><td class="num">' + packShow(q, m.id) + '</td><td class="num">' + money(m.price) + '</td><td class="num">' + fmt(m.min_order) + '</td><td>' + pill + '</td></tr>';
    }).join('');
    var title = isHq ? (byId(DB.stores, storeId) ? byId(DB.stores, storeId).name : '全部') : (byId(DB.stores, storeId) ? byId(DB.stores, storeId).name : '');
    return '<div class="toolbar"><div class="search">' + (isHq ? sel : '<b>' + esc(title) + '</b>') + '</div></div>' +
      '<div class="card"><h3>' + esc(title) + ' · 理论库存</h3><table><thead><tr><th>物料</th><th>单位</th><th class="num">库存</th><th class="num">单价</th><th class="num">最低订购</th><th>状态</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ---------- 单据列表（订货/配货/盘点/退货） ----------
  function docActions(d) {
    var u = USER; var h = '';
    var isStoreOf = u.role !== 'hq' && d.store_id === u.store_id;
    if (d.type === 'req' && u.role === 'hq' && d.status === 'approved') {
      h += '<button class="btn btn-sm btn-primary" data-act="openAlloc" data-req="' + d.id + '">下发配货</button>';
      // 总部直发单撤回修改：仅限总部自己直发、且尚未生成配货单的单据
      if (d.meta && d.meta.byHq) {
        h += ' <button class="btn btn-sm" data-act="withdrawDoc" data-id="' + d.id + '">撤回修改</button>';
      }
    }
    if (d.type === 'alloc' && isStoreOf && d.status === 'pending_store_confirm') {
      h += '<button class="btn btn-sm btn-warn" data-act="openConfirmAlloc" data-id="' + d.id + '">确认收货</button>';
    }
    if (d.type === 'alloc' && u.role === 'hq' && d.status === 'pending_store_confirm') {
      h += '<button class="btn btn-sm" data-act="reviseAlloc" data-id="' + d.id + '">撤回修改</button> ';
      h += '<button class="btn btn-sm btn-danger" data-act="cancelAlloc" data-id="' + d.id + '">作废</button>';
    }
    if (d.type === 'alloc' && u.role === 'hq' && d.status === 'diff_pending_hq') {
      h += '<button class="btn btn-sm btn-primary" data-act="resolveDiff" data-id="' + d.id + '">复核通过</button>';
      h += '<button class="btn btn-sm btn-danger" data-act="rejectDiff" data-id="' + d.id + '">驳回退回门店</button>';
    }
    if ((d.status === 'pending_manager' && u.role === 'manager' && isStoreOf) || (d.status === 'pending_hq' && u.role === 'hq')) {
      h += '<button class="btn btn-sm btn-primary" data-act="approve" data-id="' + d.id + '">通过</button>';
      h += '<button class="btn btn-sm btn-danger" data-act="reject" data-id="' + d.id + '">驳回</button>';
    }
    // 门店撤回已提交单据：待审状态可撤回为草稿（盘点/订货/退货通用）；
    // 当前审批人除外——审批人应直接通过/驳回（店长审店员提交的单时不显示撤回）
    if (isStoreOf && (d.status === 'pending_manager' || d.status === 'pending_hq') && !(d.status === 'pending_manager' && u.role === 'manager')) {
      h += '<button class="btn btn-sm" data-act="withdrawDoc" data-id="' + d.id + '">撤回修改</button> ';
    }
    // 草稿：门店用户可编辑/提交；总部也可编辑自己撤回的直发草稿（byHq）
    var hqDraft = u.role === 'hq' && d.type === 'req' && !!(d.meta && d.meta.byHq);
    if (d.status === 'draft' && (isStoreOf || hqDraft)) {
      h += '<button class="btn btn-sm" data-act="editDraft" data-type="' + d.type + '" data-id="' + d.id + '">继续编辑</button>';
      h += '<button class="btn btn-sm btn-primary" data-act="submitDraft" data-type="' + d.type + '" data-id="' + d.id + '">' + (hqDraft ? '重新下发' : '提交') + '</button>';
    }
    // 删除草稿/已驳回单据：本店门店用户（店长+店员）与总部均可；草稿未入库、驳回未入账，删除无库存影响
    if ((d.status === 'draft' || d.status === 'rejected') && (isStoreOf || u.role === 'hq')) {
      h += '<button class="btn btn-sm btn-danger" data-act="delDoc" data-id="' + d.id + '">删除</button>';
    }
    if (d.type === 'stk') {
      h += '<button class="btn btn-sm" data-act="viewStk" data-id="' + d.id + '">查看</button>';
    }
    return h || '<span class="muted">—</span>';
  }
  // ---------- 单据列表（总部端：状态筛选 + 待办置顶；草稿后端已隔离） ----------
  var hqDocFilter = 'all'; // all | todo | approved | rejected
  function viewDocList(type) {
    var isHq = USER.role === 'hq';
    var docs = (DB.docs || []).filter(function (d) { return d.type === type; });
    if (!isHq) docs = docs.filter(function (d) { return d.store_id === USER.store_id; });
    // 总部端：按所选筛选项过滤
    if (isHq) {
      if (hqDocFilter === 'todo') docs = docs.filter(function (d) { return d.status === 'pending_hq' || d.status === 'diff_pending_hq'; });
      else if (hqDocFilter === 'approved') docs = docs.filter(function (d) { return ['approved', 'allocated', 'pending_store_confirm', 'confirmed'].indexOf(d.status) >= 0; });
      else if (hqDocFilter === 'rejected') docs = docs.filter(function (d) { return d.status === 'rejected'; });
    }
    // 排序：总部端待办置顶（待总部审/差异待复核），其余按日期倒序；门店端保持日期倒序
    var isTodo = function (d) { return d.status === 'pending_hq' || d.status === 'diff_pending_hq'; };
    docs = docs.slice().sort(function (a, b) {
      if (isHq) { var pa = isTodo(a) ? 0 : 1, pb = isTodo(b) ? 0 : 1; if (pa !== pb) return pa - pb; }
      return (b.date || '').localeCompare(a.date || '') || String(b.created_at || '').localeCompare(String(b.created_at || ''));
    });
    var canCreate = (type === 'req' && USER.role === 'hq') || ((type === 'req' || type === 'stk' || type === 'ret') && USER.role !== 'hq');
    var createLabel = (type === 'req' && USER.role === 'hq') ? '新建订货单（直发门店）' : ('新建' + (DOC_TYPE[type] || ''));
    var exportBar = (type === 'alloc' && isHq)
      ? '<div class="export-bar">月份 <input type="month" id="allocExportMonth" class="in" value="' + (new Date().getFullYear() + '-' + ('0' + (new Date().getMonth() + 1)).slice(-2)) + '"> <button class="btn btn-sm" data-act="downloadAllocDetail">下载明细 CSV</button></div>' : '';
    var toolbar = '<div class="toolbar"><h2 style="margin:0;font-size:18px">' + (DOC_TYPE[type] || type) + '</h2><div class="spacer"></div>' +
      (canCreate ? '<button class="btn btn-primary" data-act="openDoc" data-type="' + type + '">' + createLabel + '</button>' : '') +
      (type === 'req' && USER.role !== 'hq' ? '<button class="btn btn-warn" data-act="openUrgentOrder">紧急订货</button>' : '') + '</div>' + exportBar;
    // 总部端：状态筛选 chips（含计数）
    if (isHq) {
      var allDocs = (DB.docs || []).filter(function (d) { return d.type === type; });
      var cTodo = allDocs.filter(isTodo).length;
      var cOk = allDocs.filter(function (d) { return ['approved', 'allocated', 'pending_store_confirm', 'confirmed'].indexOf(d.status) >= 0; }).length;
      var cRej = allDocs.filter(function (d) { return d.status === 'rejected'; }).length;
      // 徽标语义：红色 = 有事待我处理；灰 = 中性计数（仅供了解数量，不催办）
      var chip = function (val, label, num, red) {
        var b = (num > 0 && val !== 'all') ? (' <span class="' + (red ? 'nav-badge' : 'chip-count') + '">' + num + '</span>') : '';
        return '<button class="subchip' + (hqDocFilter === val ? ' active' : '') + '" data-act="docFilter" data-val="' + val + '">' + label + b + '</button>';
      };
      toolbar += '<div class="toolbar" style="margin-bottom:10px">' +
        chip('all', '全部') + chip('todo', '待我处理', cTodo, true) + chip('approved', '已通过', cOk) + chip('rejected', '已驳回', cRej) + '</div>';
    }
    // 单号即超链接：点击弹出明细（移动端无需左右滑动）；明细列不再平铺在表格里
    var rows = docs.map(function (d) {
      var store = byId(DB.stores, d.store_id);
      var urgentFee = (d.meta && d.meta.urgent) ? (parseFloat(d.meta.logistics_fee) || 0) : 0;
      var urgentTag = urgentFee>0 ? ' <span class="tag-pill rejected">紧急·+'+urgentFee+'运费</span>' : ((d.meta && d.meta.urgent) ? ' <span class="tag-pill rejected">紧急·免运费</span>' : '');
      var recoTag = (d.meta && d.meta.fromReco) ? ' <span class="tag-pill reco">系统推荐</span>' : '';
      var byHqTag = (d.meta && d.meta.byHq) ? ' <span class="tag-pill approved">总部直发</span>' : '';
      var sub = '共 ' + (d.items || []).length + ' 项' + urgentTag + recoTag + byHqTag;
      // 订货单：列表即显示估算合计，店长审核/查看时一眼可见总价
      if (type === 'req') {
        var ta = (d.items || []).reduce(function (s, it) { var m = byId(DB.materials, it.mid); var pr = (it.price != null) ? parseFloat(it.price) : (m ? parseFloat(m.price) || 0 : 0); return s + (parseFloat(it.qty) || 0) * pr; }, 0);
        var totalTxt = money(Math.round(ta * 100) / 100);
        if (urgentFee>0) totalTxt += ' +运费¥'+urgentFee; else if (d.meta && d.meta.urgent) totalTxt += ' ·免运费';
        sub += ' · 估算合计 ' + totalTxt;
      }
      return '<tr><td><a class="doc-link" data-act="viewDoc" data-id="' + esc(d.id) + '">' + esc(d.id) + ' ›</a>' +
        '<div class="doc-link-sub">' + sub + '</div></td>' +
        (isHq ? '<td>' + esc(store ? store.name : d.store_id) + '</td>' : '') +
        '<td><span class="tag-pill ' + (STATUS_CLASS[d.status] || 'draft') + '">' + esc(STATUS_LABEL[d.status] || d.status) + '</span></td>' +
        '<td class="nowrap">' + d.date + '</td><td class="ops">' + docActions(d) + '</td></tr>';
    }).join('');
    var head = '<th>单号（点击看明细）</th>' + (isHq ? '<th>门店</th>' : '') + '<th>状态</th><th>日期</th><th class="ops">操作</th>';
    return toolbar + '<div class="card"><table><thead><tr>' + head + '</tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="empty">暂无单据</td></tr>') + '</tbody></table></div>';
  }

  // ---------- 审批中心 ----------
  // ---------- 盘点单明细（卡片列 + 盘盈/盘亏） ----------
  function openStkModal(id) {
    var d = byId(DB.docs, id); if (!d) return;
    var inv = (USER.role === 'hq') ? (DB.inventory[d.store_id] || {}) : (DB.inventory[USER.store_id] || {});
    var cards = (d.items || []).map(function (it) {
      var m = byId(DB.materials, it.mid);
      var name = m ? m.name : it.mid;
      var sys = (inv[it.mid] || 0);
      var act = parseFloat(it.actual || 0);
      var diff = Math.round((act - sys) * 1000) / 1000;
      var sp = stkOf(it.mid);
      var diffU = (sp && sp.qty > 0) ? (Math.round(diff / sp.qty * 100) / 100) : diff;
      var diffTxt = sp ? (fmt(diffU) + ' ' + sp.unit) : (fmt(diff) + (m ? m.unit : ''));
      var badge = diff === 0 ? '<span class="tag-pill ok">持平</span>'
        : (diff > 0 ? '<span class="tag-pill approved">盘盈 +' + esc(diffTxt) + '</span>'
          : '<span class="tag-pill rejected">盘亏 ' + esc(diffTxt) + '</span>');
      return '<div class="stk-card"><div class="stk-name">' + esc(name) + '</div>' +
        '<div class="stk-row"><span>系统库存</span><b>' + stkShow(sys, it.mid) + '</b></div>' +
        '<div class="stk-row"><span>实盘</span><b>' + stkShow(act, it.mid) + '</b></div>' +
        '<div class="stk-diff">差异 ' + badge + '</div></div>';
    }).join('');
    var store = byId(DB.stores, d.store_id);
    openModal('<h2>盘点单明细 · ' + esc(store ? store.name : d.store_id) + '</h2>' +
      '<div class="hint">' + d.date + ' · 共 ' + (d.items || []).length + ' 项 · 绿=盘盈 红=盘亏</div>' +
      '<div class="stk-cards" style="margin:12px 0;max-height:56vh;overflow:auto">' + (cards || '<div class="empty">无明细</div>') + '</div>' +
      '<div class="foot" style="display:flex;gap:8px;flex-wrap:wrap">' + docActions(d) + '<button class="btn" data-act="closeModal">关闭</button></div>');
  }

  // ---------- 单据明细弹层（订货/配货/退货：名称+规格+价格列式展示，移动端免横滑） ----------
  function docSpecText(m) {
    if (!m) return '';
    return (m.pack_qty > 0) ? (fmt(m.pack_qty) + ' ' + (m.unit || '') + '/' + (m.pack_unit || '件')) : (m.unit || '');
  }
  function docItemRows(d) {
    var inv = (DB.inventory && DB.inventory[d.store_id]) || {};
    return (d.items || []).map(function (it) {
      var m = byId(DB.materials, it.mid);
      var name = (it.name != null) ? it.name : (m ? m.name : it.mid);
      var price = (it.price != null) ? parseFloat(it.price) : (m ? (parseFloat(m.price) || 0) : 0);
      var spec = docSpecText(m);
      var v = it.qty != null ? it.qty : 0;
      if (d.type === 'stk') {
        var sys = inv[it.mid] || 0;
        var act = parseFloat(it.actual || 0);
        var diff = Math.round((act - sys) * 1000) / 1000;
        var sp = stkOf(it.mid);
        var diffU = (sp && sp.qty > 0) ? (Math.round(diff / sp.qty * 100) / 100) : diff;
        var diffTxt = sp ? (fmt(diffU) + ' ' + sp.unit) : fmt(diff);
        var badge = diff === 0 ? '<span class="tag-pill ok">持平</span>'
          : (diff > 0 ? '<span class="tag-pill approved">盘盈 +' + esc(diffTxt) + '</span>' : '<span class="tag-pill rejected">盘亏 ' + esc(diffTxt) + '</span>');
        return '<div class="doc-item"><div class="doc-item-main"><b>' + esc(name) + '</b><span class="doc-item-spec">' + esc(spec) + ' · 单价 ' + money(price) + '</span></div>' +
          '<div class="doc-item-nums"><span>系统 ' + stkShow(sys, it.mid) + '</span><span>实盘 <b>' + stkShow(act, it.mid) + '</b></span>' + badge + '</div></div>';
      }
      // 配货单已收货：显示配货数 / 实收数 / 差异徽标
      if (d.type === 'alloc' && it.actual != null) {
        var av = parseFloat(it.actual || 0);
        var dv = Math.round((av - v) * 1000) / 1000;
        var dbadge = dv === 0 ? '<span class="tag-pill ok">无差异</span>'
          : (dv > 0 ? '<span class="tag-pill approved">多收 +' + fmt(dv) + '</span>' : '<span class="tag-pill rejected">少收 ' + fmt(dv) + '</span>');
        return '<div class="doc-item"><div class="doc-item-main"><b>' + esc(name) + '</b><span class="doc-item-spec">' + esc(spec) + ' · 单价 ' + money(price) + '</span></div>' +
          '<div class="doc-item-nums"><span>配货 ' + packShow(v, it.mid) + '</span><span>实收 <b>' + packShow(av, it.mid) + '</b> ' + dbadge + '</span></div></div>';
      }
      return '<div class="doc-item"><div class="doc-item-main"><b>' + esc(name) + '</b><span class="doc-item-spec">' + esc(spec) + ' · 单价 ' + money(price) + '</span></div>' +
        '<div class="doc-item-nums"><span class="doc-item-qty">' + packShow(v, it.mid) + '</span><span>' + money(Math.round(v * price * 100) / 100) + '</span></div></div>';
    }).join('');
  }
  function openDocDetail(id) {
    var d = byId(DB.docs, id); if (!d) return;
    if (d.type === 'stk') { openStkModal(id); return; } // 盘点单沿用带差异数的专属弹层
    var store = byId(DB.stores, d.store_id);
    var urgent = d.meta && d.meta.urgent;
    var urgentFee2 = urgent ? (parseFloat(d.meta.logistics_fee) || 0) : 0;
    var diff = d.meta && d.meta.diff;
    var totalAmt = (d.items || []).reduce(function (s, it) {
      var m = byId(DB.materials, it.mid);
      var q = (d.type === 'alloc' && it.actual != null) ? parseFloat(it.actual) : (it.qty || 0);
      var pr = (it.price != null) ? parseFloat(it.price) : (m ? (parseFloat(m.price) || 0) : 0);
      return s + q * pr;
    }, 0);
    var diffTxt = (diff && diff.items && diff.items.length)
      ? ' · <b style="color:var(--warn)">收货差异 ' + diff.items.length + ' 项' + (d.status === 'diff_pending_hq' ? '待总部复核' : '已复核') + (diff.note ? '（' + esc(diff.note) + '）' : '') + '</b>' : '';
    var logTxt = '';
    if (d.meta && d.meta.log && d.meta.log.length) {
      logTxt = '<div class="hint" style="margin-top:10px;border-top:1px dashed var(--muted);padding-top:8px">操作记录：' +
        d.meta.log.slice(-5).map(function (l) { return esc(String(l.t || '').replace('T', ' ').slice(0, 16) + ' ' + (l.act || '')); }).join('；') + '</div>';
    }
    openModal('<h2>' + (DOC_TYPE[d.type] || d.type) + '明细 · ' + esc(store ? store.name : d.store_id) + '</h2>' +
      '<div class="hint">' + esc(d.id) + ' · ' + d.date + ' · 共 ' + (d.items || []).length + ' 项 · 估算金额 ' + money(Math.round(totalAmt * 100) / 100) + (urgent ? (' · <b style="color:var(--danger)">紧急订货（' + (urgentFee2>0 ? ('+'+urgentFee2+' 元物流费') : '免物流费') + '）</b>') : '') + diffTxt + '</div>' +
      '<div class="doc-items" style="margin:12px 0;max-height:56vh;overflow:auto">' + (docItemRows(d) || '<div class="empty">无明细</div>') + '</div>' + logTxt +
      '<div class="foot" style="display:flex;gap:8px;flex-wrap:wrap">' + docActions(d) + '<button class="btn" data-act="closeModal">关闭</button></div>');
  }

  // ---------- 智能推荐订货 ----------
  function recoDays(it) {
    if (it.daily > 0) return Math.round((it.have || 0) / it.daily * 10) / 10;
    return it.have > 0 ? '∞' : 0;
  }
  function recoStoreItems(storeId) {
    var r = DB.recos[storeId];
    return (r && r.items) || [];
  }
  function recoTableRows(storeId, prefix) {
    var items = recoStoreItems(storeId);
    if (!items.length) return '<tr><td colspan="7" class="empty">暂无推荐数据，请点击「生成本周推荐」</td></tr>';
    return items.map(function (it, idx) {
      var pp = packOf(it.mid);
      var packQ = (pp && pp.qty > 0) ? pp.qty : 1;
      var days = recoDays(it);
      var warn = it.suggest > 0;
      var m = byId(DB.materials, it.mid) || {};
      var unitTxt = pp
        ? (pp.unit + '·1' + pp.unit + '=' + fmt(pp.qty) + it.unit + (m.min_order > 0 ? '·最低' + fmt(Math.ceil(m.min_order / pp.qty)) + pp.unit : ''))
        : (it.unit + (m.min_order > 0 ? '·最低' + fmt(m.min_order) + it.unit : ''));
      return '<tr class="' + (warn ? 'reco-row-warn' : '') + '">' +
        '<td><b>' + esc(it.name) + '</b> <span class="muted">' + esc(unitTxt) + '</span></td>' +
        '<td class="num">' + packShow(it.daily, it.mid) + '</td>' +
        '<td class="num">' + packShow(it.have, it.mid) + '</td>' +
        '<td class="num">' + packShow(it.inTransit, it.mid) + '</td>' +
        '<td class="num">' + (typeof days === 'number' ? fmt(days) : days) + ' 天</td>' +
        '<td class="num nowrap"><input class="in reco-qty" type="number" min="0" step="0.01" data-store="' + storeId + '" data-mid="' + it.mid + '" value="' + fmt(it.suggest / packQ) + '" style="width:90px;text-align:right"></td>' +
        '<td class="ops"><button class="btn btn-sm btn-primary" data-act="submitRecoRow" data-store="' + storeId + '" data-idx="' + idx + '">按建议订货</button></td>' +
        '</tr>';
    }).join('');
  }
  function viewReco() {
    var isHq = USER.role === 'hq';
    if (isHq) {
      var stores = DB.stores || [];
      var activeStores = stores.filter(function (s) { return s.active; });
      var selected = (VIEW_STATE.reco && VIEW_STATE.reco.store) || (activeStores[0] ? activeStores[0].id : (stores[0] ? stores[0].id : ''));
      if (!selected && stores.length) selected = stores[0].id;
      var tabs = stores.map(function (s) {
        var items = recoStoreItems(s.id);
        var need = items.filter(function (it) { return it.suggest > 0; }).length;
        return '<button class="reco-tab ' + (s.id === selected ? 'active' : '') + '" data-act="recoTab" data-store="' + s.id + '">' +
          '<span class="reco-tab-name">' + esc(s.name) + '</span>' + (s.active ? '' : '<span class="tag-pill rejected">停用</span>') +
          '<span class="reco-tab-badge">' + (need ? need + ' 项待订' : '无需订货') + '</span></button>';
      }).join('');
      var s = byId(DB.stores, selected);
      var items = recoStoreItems(selected);
      var needCount = items.filter(function (it) { return it.suggest > 0; }).length;
      var hasAutoHq = (DB.docs || []).some(function (d) { return d.type === 'req' && d.store_id === selected && (d.meta && d.meta.autoGenerated) && (d.status === 'draft' || d.status === 'pending_manager' || d.status === 'pending_hq'); });
      return '<div class="toolbar"><h2 style="margin:0;font-size:18px">智能推荐订货</h2><div class="spacer"></div>' +
        '<button class="btn btn-primary" data-act="genReco">生成本周推荐（全门店）</button></div>' +
        '<div class="reco-layout">' +
        '<div class="reco-side">' + tabs + '</div>' +
        '<div class="reco-main">' +
        '<div class="card" style="margin-bottom:0">' +
        '<div class="card-h"><h3>' + esc(s ? s.name : '') + ' · 推荐订货明细</h3>' +
        '<div class="toolbar" style="margin:0">' +
        '<span class="hint" style="margin:0">近14天日均消耗 · 预估8天用量</span>' +
        '<div class="spacer"></div>' +
        (items.length && !hasAutoHq ? '<button class="btn btn-primary" data-act="submitRecoStore" data-store="' + selected + '">本店一键下单 (' + needCount + ' 项)</button>' : '') +
        '</div></div>' +
        '<table><thead><tr><th>物料</th><th class="num">日均消耗</th><th class="num">现有库存</th><th class="num">在途</th><th class="num">预计可用</th><th class="num">本次订货量</th><th class="ops">操作</th></tr></thead><tbody>' +
        recoTableRows(selected, 'hq') + '</tbody></table>' +
        '</div></div></div>';
    }
    var items = recoStoreItems(USER.store_id);
    var needCount = items.filter(function (it) { return it.suggest > 0; }).length;
    // 已存在系统自动生成的未完结订货单时，引导去订货单修改，避免重复下单
    var hasAuto = (DB.docs || []).some(function (d) {
      return d.type === 'req' && d.store_id === USER.store_id && (d.meta && d.meta.autoGenerated) && (d.status === 'draft' || d.status === 'pending_manager' || d.status === 'pending_hq');
    });
    var banner = hasAuto ? '<div class="hint reco-banner">系统已据周五盘点生成推荐订货单（未提交）。请到「订货单」中查看、据实修改后提交。</div>' : '';
    return '<div class="toolbar"><h2 style="margin:0;font-size:18px">智能推荐订货</h2><div class="spacer"></div>' +
      (items.length && !hasAuto ? '<button class="btn btn-primary" data-act="submitRecoStore" data-store="' + USER.store_id + '">按推荐提交订货单 (' + needCount + ' 项)</button>' : '') + '</div>' +
      banner +
      '<div class="card"><h3>本周推荐（近14天消耗 · 预估8天用量）</h3>' +
      (items.length ? '<table><thead><tr><th>物料</th><th class="num">日均消耗</th><th class="num">现有库存</th><th class="num">在途</th><th class="num">预计可用</th><th class="num">本次订货量</th><th class="ops">操作</th></tr></thead><tbody>' +
        recoTableRows(USER.store_id, 'store') + '</tbody></table>' :
        '<div class="empty">总部尚未生成推荐，或本店暂无销售数据</div>') + '</div>';
  }
  async function submitRecoForStore(storeId) {
    var items = [];
    document.querySelectorAll('.reco-qty[data-store="' + storeId + '"]').forEach(function (el) {
      var mid = el.getAttribute('data-mid');
      var v = parseFloat(el.value) || 0;
      if (v > 0) items.push({ mid: mid, qty: packToBase(mid, v) });
    });
    if (!items.length) { toast('请至少填写一项订货量'); return; }
    await apiPost('reco', { op: 'submit', store_id: storeId, items: items });
    await refresh(); render();
    toast('已提交订货单');
  }
  async function submitRecoRow(storeId, idx) {
    var items = recoStoreItems(storeId);
    var it = items[idx]; if (!it) return;
    var el = document.querySelector('.reco-qty[data-store="' + storeId + '"][data-mid="' + it.mid + '"]');
    var v = el ? (parseFloat(el.value) || 0) : 0;
    if (v <= 0) { toast('订货量须大于0'); return; }
    await apiPost('reco', { op: 'submit', store_id: storeId, items: [{ mid: it.mid, qty: packToBase(it.mid, v) }] });
    await refresh(); render();
    toast('已提交 ' + it.name + ' 订货单');
  }

  // ---------- 单据弹窗 ----------
  var pendingDocItems = null; // 暂存已填盘点项，供"未盘点确认"弹窗使用（避免 openModal 覆盖原表单后丢失输入）
  var HQ_KEEP = null; // 总部直发订货单：暂存已填数量与所选门店，供"新增非标品物料"弹层返回时回填
  var DOC_URGENT = false; // 当前订货单弹层是否处于「紧急订货」模式（加收80元物流费，豁免每周限次）
  // 订货/盘点弹窗物料分块渲染：避免一次性构建 200+ 输入框导致手机卡顿
  var DOC_CHUNK = 60;            // 每次渲染的物料条数
  var DOC_ALL_MIDS = [];         // 当前弹窗全部物料 id（按显示顺序）
  var DOC_RENDER_IDX = 0;        // 下一个待渲染下标
  var DOC_RENDERED_MIDS = [];    // 已渲染（有输入框）的物料 id，供 calcDocTotal 使用
  var DOC_MODAL_TYPE = '';       // 当前弹窗类型（req/stk/ret），供「加载更多」复用
  var DOC_KEEP = {};             // 当前弹窗 keep（临时草稿值）
  var DOC_PREFILL = {};          // 当前弹窗 prefill（编辑草稿的已填值）
  // 本周一(含)以来本店已提交的常规订货单（非草稿/非驳回/非紧急）；返回单据或 null
  function regularReqThisWeek() {
    var monday = dayAddJS(todayStr(), -((new Date().getDay() + 6) % 7));
    return (DB.docs || []).filter(function (d) {
      return d.type === 'req' && d.store_id === USER.store_id && (d.date || '') >= monday &&
        d.status !== 'draft' && d.status !== 'rejected' && !(d.meta && d.meta.urgent) && !(d.meta && d.meta.byHq);
    }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); })[0] || null;
  }
  // 单条物料输入框 HTML（供首屏与「加载更多」共用）
  function buildDocRow(m, type, keep, prefill) {
    var stkExplicit = !!(m && m.stk_unit && m.stk_qty > 0); // 该物料是否单独设置了盘点单位
    var p = packOf(m.id);
    if (type === 'stk') p = stkExplicit ? { qty: m.stk_qty, unit: m.stk_unit } : matPack(m.id); // 盘点：有则用盘点单位，否则沿用订货单位
    var lbl = type === 'stk' ? '实盘' : (type === 'ret' ? '退货' : '订购');
    var unitHint;
    if (type === 'stk') {
      unitHint = (p ? ('盘点单位 ' + p.unit + ' · 1' + p.unit + '=' + fmt(p.qty) + m.unit) : ('盘点单位 ' + m.unit)) + (stkExplicit ? '' : '（未单独设置，沿用订货单位）');
    } else if (p) {
      unitHint = p.unit + ' · 1' + p.unit + '=' + fmt(p.qty) + m.unit + (m.min_order > 0 ? ' · 最低' + fmt(Math.ceil(m.min_order / p.qty)) + p.unit : '');
    } else {
      unitHint = m.unit + (m.min_order ? ' · 最低' + fmt(m.min_order) + m.unit : '');
    }
    var rawV = (keep.raw && keep.raw[m.id] != null) ? keep.raw[m.id] : null;
    var val0 = rawV != null ? rawV : (prefill[m.id] != null ? (p ? (prefill[m.id] / p.qty) : prefill[m.id]) : '');
    var ph = lbl + (p ? '(' + p.unit + ')' : '(' + m.unit + ')');
    // 单价（进货价）随规格一并展示在括号里，店长一眼可见每项价格（行业普遍做法）
    var priceTxt = '';
    if (type === 'req') {
      if (m && m.pack_price > 0 && p) priceTxt = '进货价 ' + money(m.pack_price) + '/' + p.unit;
      else if (m && m.price > 0) priceTxt = '进货价 ' + money(parseFloat(m.price)) + '/' + m.unit;
      else priceTxt = '未设进货价';
    }
    var nameBlock = '<div style="flex:1">' + esc(m.name) + ' <span class="muted">(' + esc(unitHint) + (priceTxt ? ' · ' + esc(priceTxt) : '') + ')</span></div>';
    // 注意：不使用内联 oninput（函数在 IIFE 作用域内，内联处理器全局调用会 ReferenceError），改由 document 委托的 input 事件触发 calcDocTotal
    return '<div class="row" style="align-items:center;margin-bottom:8px">' + nameBlock +
      '<input class="in" style="width:120px" type="number" min="0" step="0.01" id="doc_' + m.id + '" placeholder="' + esc(ph) + '" value="' + (val0 !== '' ? val0 : '') + '"></div>';
  }
  // 订货/盘点弹窗「加载更多物料」：追加下一块，并同步 DOC_RENDERED_MIDS
  async function docLoadMore() {
    var remain = DOC_ALL_MIDS.length - DOC_RENDER_IDX;
    if (remain <= 0) return;
    var take = Math.min(DOC_CHUNK, remain);
    var slice = DOC_ALL_MIDS.slice(DOC_RENDER_IDX, DOC_RENDER_IDX + take);
    var html = slice.map(function (id) { var m = byId(DB.materials, id); return m ? buildDocRow(m, DOC_MODAL_TYPE, DOC_KEEP, DOC_PREFILL) : ''; }).join('');
    var rowsEl = document.getElementById('doc_rows');
    if (rowsEl) rowsEl.insertAdjacentHTML('beforeend', html);
    DOC_RENDERED_MIDS = DOC_RENDERED_MIDS.concat(slice);
    DOC_RENDER_IDX += take;
    if (DOC_RENDER_IDX >= DOC_ALL_MIDS.length) { var w = document.getElementById('doc_more_wrap'); if (w) w.style.display = 'none'; }
    else { var b = document.getElementById('doc_more_btn'); if (b) b.textContent = '加载更多物料（剩 ' + (DOC_ALL_MIDS.length - DOC_RENDER_IDX) + ' 项）'; }
  }
  function openDocModal(type, doc, keep, urgent) {
    DOC_URGENT = !!urgent || !!(doc && doc.meta && doc.meta.urgent); // 编辑既有紧急草稿时还原为紧急模式
    // 新建盘点单预检：本店存在未完结盘点单（草稿/待店长审/待总部审）时禁止重复新建
    if (type === 'stk' && !doc && USER.role !== 'hq') {
      var inflight = (DB.docs || []).filter(function (x) {
        return x.type === 'stk' && x.store_id === USER.store_id &&
          (x.status === 'draft' || x.status === 'pending_manager' || x.status === 'pending_hq');
      })[0];
      if (inflight) {
        var stLbl = inflight.status === 'draft' ? '草稿' : (inflight.status === 'pending_manager' ? '待店长审' : '待总部审');
        toast('本店已有未完结盘点单（' + inflight.id + ' · ' + stLbl + '），请编辑草稿、等待审核或撤回修改');
        return;
      }
    }
    // 每周每店仅一次常规订货：门店非紧急新建订货单时，若本周已有常规单则拦截，引导走「紧急订货」
    if (type === 'req' && !doc && USER.role !== 'hq' && !DOC_URGENT) {
      var reg = regularReqThisWeek();
      if (reg) {
        openModal('<h2>本周常规订货已提交</h2><div class="hint">本店本周常规订货单（' + esc(reg.id) + '，' + esc(reg.date) + '）已提交，每店每周仅可提交一次常规订货，无法重复提交。<br><br>如确为紧急补货，请使用「紧急订货」入口（本单总价 ≥ ¥2000 免物流费，不足加收 ¥80）。</div>' +
          '<div class="foot"><button class="btn" data-act="closeModal">知道了</button><button class="btn btn-warn" data-act="gotoUrgent">去紧急订货</button></div>');
        return;
      }
    }
    keep = keep || {};
    var isHqOrder = (type === 'req' && USER.role === 'hq'); // 总部直发：选门店、免审批、无草稿
    var prefill = {};
    if (doc && doc.items) doc.items.forEach(function (it) { prefill[it.mid] = it.qty; });
    var matList = (type === 'stk') ? (DB.materials || []).filter(function (m) { return m.in_stocktake === undefined ? true : (m.in_stocktake !== 0); }) : (DB.materials || []);
    // 编辑草稿时，把已填物料排到前面，确保分块首屏即包含全部已填项（否则未渲染项提交时会丢失）
    if (doc && doc.items && doc.items.length) {
      var have = {}; doc.items.forEach(function (it) { have[it.mid] = 1; });
      matList = matList.slice().sort(function (a, b) { return (have[a.id] ? 0 : 1) - (have[b.id] ? 0 : 1); });
    }
    // 分块渲染：新建时首屏只渲前 DOC_CHUNK 条，其余「加载更多」按需追加；编辑既有草稿则全量渲染（避免未渲染项提交时丢失）
    var isEdit = !!doc;
    DOC_MODAL_TYPE = type; DOC_KEEP = keep; DOC_PREFILL = prefill;
    DOC_ALL_MIDS = matList.map(function (m) { return m.id; });
    var firstN = isEdit ? matList.length : Math.min(DOC_CHUNK, matList.length);
    DOC_RENDER_IDX = firstN;
    DOC_RENDERED_MIDS = matList.slice(0, firstN).map(function (m) { return m.id; });
    var firstRows = matList.slice(0, firstN).map(function (m) { return buildDocRow(m, type, keep, prefill); }).join('');
    var moreBtn = (!isEdit && matList.length > DOC_CHUNK)
      ? '<div id="doc_more_wrap" style="text-align:center;padding:10px 0"><button class="btn" id="doc_more_btn" data-act="docLoadMore">加载更多物料（剩 ' + (matList.length - DOC_CHUNK) + ' 项）</button></div>'
      : '';
    var rows = firstRows + moreBtn;
    var extra = type === 'ret' ? '<div class="field" style="margin-top:10px"><label class="fld">退货原因</label><input class="in" id="doc_reason" placeholder="如：到货不新鲜"></div>' : '';
    var titles = { req: '新建订货单', stk: '新建盘点单', ret: '新建退货单' };
    var title = doc ? ('编辑' + titles[type]) : titles[type];
    if (isHqOrder) title = doc ? ('修改总部直发订货单 · ' + esc(doc.id)) : '总部直发订货单';
    else if (DOC_URGENT) title = doc ? ('编辑紧急订货单 · ' + esc(doc.id)) : '紧急订货单';
    var draftId = doc ? doc.id : '';
    var urgentHint = '';
    if (DOC_URGENT) {
      urgentHint = '<div class="hint" style="margin-bottom:10px;color:var(--danger);font-weight:600">紧急订货：本单总价 ≥ ¥2000 免物流费，不足则加收 ¥80 物流费。请仅用于真实紧急补货，本店本周常规订货额度已用完。</div>';
    }
    var storeSel = '';
    if (isHqOrder) {
      var curSid = keep.storeId || (doc ? doc.store_id : '') || '';
      var sOpts = (DB.stores || []).filter(function (s) { return s.active || s.id === curSid; }).map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (curSid === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
      }).join('');
      storeSel = '<div class="field" style="margin-bottom:10px"><label class="fld">下发门店</label><select class="in" id="doc_store">' + sOpts + '</select></div>' +
        '<button class="btn" style="margin-bottom:10px" data-act="quickAddMat">+ 新增非标品物料</button>';
    }
    var fillHint = type === 'stk'
      ? '【盘点单位独立于订货单位】请按本物料的「盘点单位」如实填写实盘数量，可填小数（如剩 12 个半填 12.5）。未单独设置盘点单位时，自动沿用订货单位（箱/袋），系统仅据此更新库存，不受订货最低量限制。包材（杯托/单杯袋/双杯袋等）建议设为「个」盘点，避免按箱盘点出现几百箱的失真。'
      : (type === 'req'
        ? (isHqOrder
          ? '总部直发单免审批，提交后状态直接「已通过」，可立即生成配货单下发门店；不占用门店每周常规订货次数，也不产生紧急物流费。'
          : (DOC_URGENT
            ? '紧急订货按订货包装单位填写数量；括号内含规格与最低订货量。本单总价 ≥ ¥2000 免物流费，不足加收 ¥80。'
            : '按订货包装单位（包 / 盒 / 箱）填写数量，如订 3 箱牛奶、1箱=1包，填 3 即可；括号内含规格与最低订货量。每店每周仅可提交一次常规订货。'))
        : '按订货包装单位（包 / 盒）填写退货数量。');
    var totalBar = (type === 'req') ? '<div id="doc_total" class="doc-total">本单合计：¥0.00</div>' : '';
    openModal('<h2>' + title + '</h2>' + urgentHint + '<div class="hint">' + fillHint + '</div>' + storeSel + '<div style="margin:12px 0;max-height:50vh;overflow:auto"><div id="doc_rows">' + firstRows + '</div>' + moreBtn + '</div>' + extra + totalBar +
      '<div class="foot"><button class="btn" data-act="closeModal">取消</button>' +
      (isHqOrder ? '' : '<button class="btn" data-act="saveDraft" data-type="' + type + '" data-id="' + draftId + '">保存草稿</button>') +
      '<button class="btn btn-primary" data-act="submitDoc" data-type="' + type + '" data-id="' + draftId + '">' + (isHqOrder ? '直接下发' : (DOC_URGENT ? '提交紧急订货' : '提交')) + '</button></div>');
    if (type === 'req') calcDocTotal();
  }
  function collectDocItems(type) {
    var items = [];
    (DB.materials || []).forEach(function (m) {
      var inp = document.getElementById('doc_' + m.id);
      if (!inp) return; // 盘点单中「不参与盘点」的物料未渲染输入框，跳过（否则读取 null 崩溃）
      var raw = parseFloat(inp.value) || 0;
      // 订货/退货按包装单位、盘点按二级单位填写，统一换算成基本单位存库
      var v = (type === 'stk') ? stkToBase(m.id, raw) : packToBase(m.id, raw);
      if (v > 0) { var it = { mid: m.id, qty: v }; if (type === 'stk') it.actual = v; if (type === 'ret') it.reason = (document.getElementById('doc_reason') || {}).value || ''; items.push(it); }
    });
    return items;
  }
  // 订货单实时合计（店长提交/审核时可见）：仅遍历已渲染的物料输入框（分块渲染下不全量遍历）
  function calcDocTotal() {
    var el = document.getElementById('doc_total'); if (!el) return;
    var sum = 0;
    (DOC_RENDERED_MIDS || []).forEach(function (mid) {
      var inp = document.getElementById('doc_' + mid); if (!inp) return;
      var raw = parseFloat(inp.value) || 0;
      if (raw > 0) { var base = packToBase(mid, raw); var m = byId(DB.materials, mid); sum += base * (m ? (parseFloat(m.price) || 0) : 0); }
    });
    el.textContent = '本单合计：' + money(Math.round(sum * 100) / 100) + (DOC_URGENT ? ('（紧急物流费 ' + (sum >= 2000 ? '¥0 · 总价≥2000免运费' : '¥80') + '）') : '');
  }
  async function submitDoc(type, draftId) {
    var items = collectDocItems(type);
    if (!items.length) { toast('请至少填写一项'); return; }
    if (type === 'stk') {
      var total = (DB.materials || []).filter(function (m) { return m.in_stocktake === undefined ? true : (m.in_stocktake !== 0); }).length, unfilled = total - items.length;
      if (unfilled > 0) {
        pendingDocItems = items;
        openModal('<h2>有 ' + unfilled + ' 项未盘点</h2><div class="hint">共 ' + total + ' 项物料，已盘 ' + items.length + ' 项。<b>未盘点的项目将保留当前库存不变</b>。确认提交盘点单？</div>' +
          '<div class="foot"><button class="btn" data-act="backToFill">返回补盘</button><button class="btn btn-primary" data-act="confirmSubmitDoc" data-type="stk" data-id="' + (draftId || '') + '">确认提交</button></div>');
        return;
      }
    }
    await doSubmitDoc(type, items, false, draftId, DOC_URGENT);
  }
  async function saveDraftDoc(type, draftId) {
    var items = collectDocItems(type);
    await doSubmitDoc(type, items, true, draftId, DOC_URGENT);
  }
  var DOC_SUBMITTING = false; // 防连点锁：移动端网络延迟期间连点提交会并发建单（盘点单重复的根因）
  async function doSubmitDoc(type, items, draft, draftId, urgent) {
    if (DOC_SUBMITTING) return;
    DOC_SUBMITTING = true;
    try {
      var mBtns = document.querySelectorAll('#modal-root .foot button');
      mBtns.forEach(function (b) { b.disabled = true; });
      var body = { type: type, items: items, meta: {}, draft: draft };
      if (draftId) body.id = draftId;
      // 编辑既有紧急草稿时还原 urgent 标记（草稿 meta.urgent 已置位）
      if (draftId) { var exd = byId(DB.docs, draftId); if (exd && exd.meta && exd.meta.urgent) urgent = true; }
      if (urgent) body.meta.urgent = true;
      if (type === 'req' && USER.role === 'hq') {
        var sel = document.getElementById('doc_store');
        if (!sel || !sel.value) { toast('请选择下发门店'); return; }
        body.store_id = sel.value;
      }
      await apiPost('doc', body);
      closeModal(); await refresh(); render(); toast(draft ? '已保存草稿' : (USER.role === 'hq' && type === 'req' ? '订货单已直接下发（已通过）' : '已提交'));
    } finally {
      DOC_SUBMITTING = false;
      // 关键：失败时必须恢复按钮（成功时弹窗已关闭，此处为空操作）。此前只在成功路径关弹窗，
      // 失败后按钮永久置灰（.btn:disabled opacity:.5），门店会看到"提交按钮灰色无法点击"。
      var mBtns2 = document.querySelectorAll('#modal-root .foot button');
      mBtns2.forEach(function (b) { b.disabled = false; });
    }
  }
  // ---------- 总部直发：非标品物料快捷新增（保留已填数量回填） ----------
  function openQuickAddMat() {
    HQ_KEEP = { raw: {}, storeId: '' };
    var sel = document.getElementById('doc_store');
    if (sel) HQ_KEEP.storeId = sel.value;
    (DB.materials || []).forEach(function (m) {
      var el = document.getElementById('doc_' + m.id);
      if (el && el.value !== '' && (parseFloat(el.value) || 0) !== 0) HQ_KEEP.raw[m.id] = el.value;
    });
    openModal('<h2>新增非标品物料</h2><div class="hint">临时采购的非标品可直接录入物料库，保存后自动返回订货单，已填数量不丢失。</div>' +
      '<div class="field" style="margin-top:10px"><label class="fld">物料名称</label><input class="in" id="qm_name" placeholder="如：节日联名杯套"></div>' +
      '<div class="field"><label class="fld">基本单位</label><input class="in" id="qm_unit" placeholder="如：个 / g / ml"></div>' +
      '<div class="field"><label class="fld">订货包装单位（选填）</label><input class="in" id="qm_pack_unit" placeholder="如：包 / 盒 / 箱"></div>' +
      '<div class="field"><label class="fld">1包装单位 = ? 基本单位（选填；填了包装单位则必填）</label><input class="in" id="qm_pack_qty" type="number" min="0" step="0.01" placeholder="如：100"></div>' +
      '<div class="foot"><button class="btn" data-act="backToOrder">返回订货单</button>' +
      '<button class="btn btn-primary" data-act="doQuickAddMat">保存并返回</button></div>');
  }
  async function doQuickAddMat() {
    var name = ((document.getElementById('qm_name') || {}).value || '').trim();
    var unit = ((document.getElementById('qm_unit') || {}).value || '').trim() || '个';
    var pu = ((document.getElementById('qm_pack_unit') || {}).value || '').trim();
    var pq = parseFloat((document.getElementById('qm_pack_qty') || {}).value) || 0;
    if (!name) { toast('请填写物料名称'); return; }
    if (pu && pq <= 0) { toast('填写了包装单位时，规格数量必须大于 0'); return; }
    await apiPost('material', { op: 'add', name: name, unit: unit, pack_unit: pu || null, pack_qty: pq > 0 ? pq : null });
    await refresh();
    openDocModal('req', null, HQ_KEEP);
    toast('已新增物料「' + name + '」，请继续填写订货量');
  }
  function openAllocModal(reqId) {
    var req = byId(DB.docs, reqId); if (!req) return;
    var rows = req.items.map(function (it) {
      var p = packOf(it.mid);
      var v = (p && p.qty > 0) ? Math.round(it.qty / p.qty * 100) / 100 : it.qty;
      var hint = p ? (p.unit + ' · 1' + p.unit + '=' + fmt(p.qty) + unitOf(it.mid)) : unitOf(it.mid);
      return '<div class="row" style="align-items:center;margin-bottom:8px"><div style="flex:1">' + esc(matName(it.mid)) +
        ' <span class="muted">(' + esc(hint) + ')</span></div>' +
        '<input class="in" style="width:120px" type="number" min="0" step="0.01" id="alo_' + it.mid + '" value="' + v + '"></div>';
    }).join('');
    openModal('<h2>下发配货单（来自 ' + esc(reqId) + '）</h2>' +
      '<div class="hint">按订货包装单位（箱 / 盒 / 包）填写配货数量，括号内为规格换算，系统自动换算为基本单位入库。</div>' +
      '<div style="margin:12px 0;max-height:56vh;overflow:auto">' + rows + '</div>' +
      '<div class="foot"><button class="btn" data-act="closeModal">取消</button><button class="btn btn-primary" data-act="submitAlloc" data-req="' + reqId + '">确认下发</button></div>');
  }
  async function submitAlloc(reqId) {
    var req = byId(DB.docs, reqId); if (!req) return;
    var items = req.items.map(function (it) { return { mid: it.mid, qty: packToBase(it.mid, parseFloat(document.getElementById('alo_' + it.mid).value) || 0) }; });
    await apiPost('alloc', { reqId: reqId, items: items });
    closeModal(); await refresh(); render(); toast('已下发配货单');
  }
  function openRecoModal() {
    var r = DB.recos[USER.store_id]; if (!r || !r.items || !r.items.length) { toast('暂无推荐，请先由总部生成'); return; }
    var rows = r.items.map(function (it) {
      var pp = packOf(it.mid);
      var packQ = (pp && pp.qty > 0) ? pp.qty : 1;
      return '<div class="row" style="align-items:center;margin-bottom:8px"><div style="flex:1">' + esc(it.name) + ' <span class="muted">(' + (pp ? esc(pp.unit) : esc(unitOf(it.mid))) + ')</span></div>' +
        '<input class="in" style="width:120px" type="number" min="0" step="0.01" id="rco_' + it.mid + '" value="' + fmt(it.suggest / packQ) + '"></div>';
    }).join('');
    openModal('<h2>提交订货单（据推荐）</h2><div style="margin:12px 0">' + rows + '</div>' +
      '<div class="foot"><button class="btn" data-act="closeModal">取消</button><button class="btn btn-primary" data-act="submitReco">提交订货单</button></div>');
  }
  async function submitReco() {
    var r = DB.recos[USER.store_id] || { items: [] };
    var items = r.items.map(function (it) { return { mid: it.mid, qty: packToBase(it.mid, parseFloat(document.getElementById('rco_' + it.mid).value) || 0) }; });
    await apiPost('reco', { op: 'submit', items: items });
    closeModal(); await refresh(); render(); toast('已提交订货单');
  }
  async function doApprove(id, decision, note) {
    var qs = 'approve?id=' + encodeURIComponent(id) + '&decision=' + decision + (note ? ('&note=' + encodeURIComponent(note)) : '');
    closeModal(); await apiPost(qs, {}); await refresh(); render();
    toast(decision === 'approve' ? '已审批通过' : '已驳回');
  }
  // ---------- 配货单：差异收货 / 撤回修改 / 作废 / 差异复核 ----------
  function openConfirmAllocModal(id) {
    var d = byId(DB.docs, id); if (!d) return;
    var rows = (d.items || []).map(function (it) {
      var m = byId(DB.materials, it.mid);
      var p = packOf(it.mid);
      var v = (p && p.qty > 0) ? Math.round(it.qty / p.qty * 100) / 100 : it.qty;
      var dispU = p ? p.unit : (m ? m.unit : '');
      return '<div class="row" style="align-items:center;margin-bottom:8px"><div style="flex:1">' + esc(m ? m.name : it.mid) +
        '<div class="muted" style="font-size:12px">配货 ' + fmt(v) + ' ' + esc(dispU) + '</div></div>' +
        '<input class="in" style="width:120px" type="number" min="0" step="0.01" id="cfm_' + it.mid + '" value="' + v + '"></div>';
    }).join('');
    openModal('<h2>确认收货 · ' + esc(d.id) + '</h2>' +
      '<div class="hint">逐项核对<b>实际收到</b>的数量（默认等于配货数）。实收与配货数不符时请填写差异说明，系统记录实收数并通知总部复核；<b>库存将在总部复核通过后按实收数入账</b>。</div>' +
      '<div style="margin:12px 0;max-height:44vh;overflow:auto">' + rows + '</div>' +
      '<div style="margin:12px 0"><label class="fld">差异说明（有差异时填写）</label><input class="in" id="cfm_note" placeholder="如：运输破损 1 盒"></div>' +
      '<div class="foot"><button class="btn" data-act="closeModal">取消</button>' +
      '<button class="btn btn-warn" data-act="doConfirmAlloc" data-id="' + d.id + '">确认收货并入库</button></div>');
  }
  async function doConfirmAlloc(id) {
    var d = byId(DB.docs, id); if (!d) return;
    var hasDiff = false;
    var items = (d.items || []).map(function (it) {
      var raw = parseFloat(document.getElementById('cfm_' + it.mid).value);
      var v = packToBase(it.mid, (isNaN(raw) || raw < 0) ? 0 : raw);
      if (Math.abs(v - parseFloat(it.qty || 0)) > 1e-9) hasDiff = true;
      return { mid: it.mid, qty: v };
    });
    var note = ((document.getElementById('cfm_note') || {}).value || '').trim();
    if (hasDiff && !note) { toast('实收与配货数不一致，请填写差异说明'); return; }
    closeModal();
    await apiPost('confirm-alloc', { id: id, items: items, note: note });
    await refresh(); render();
    toast(hasDiff ? '已提交差异收货，待总部复核（复核通过后库存入账）' : '已确认收货并入库');
  }
  function openReviseAllocModal(id) {
    var d = byId(DB.docs, id); if (!d) return;
    var rows = (d.items || []).map(function (it) {
      var m = byId(DB.materials, it.mid);
      var p = packOf(it.mid);
      var v = (p && p.qty > 0) ? Math.round(it.qty / p.qty * 100) / 100 : it.qty;
      var hint = p ? (p.unit + ' · 1' + p.unit + '=' + fmt(p.qty) + (m ? m.unit : '')) : (m ? m.unit : '');
      return '<div class="row" style="align-items:center;margin-bottom:8px"><div style="flex:1">' + esc(m ? m.name : it.mid) +
        ' <span class="muted">(' + esc(hint) + ')</span></div>' +
        '<input class="in" style="width:120px" type="number" min="0" step="0.01" id="rvs_' + it.mid + '" value="' + v + '"></div>';
    }).join('');
    openModal('<h2>撤回修改配货单 · ' + esc(d.id) + '</h2>' +
      '<div class="hint">按订货包装单位（箱 / 盒 / 包）修改数量，保存后自动换算为基本单位重新下发；仅门店<b>未确认收货</b>时可修改，操作全程留痕。</div>' +
      '<div style="margin:12px 0;max-height:50vh;overflow:auto">' + rows + '</div>' +
      '<div class="foot"><button class="btn" data-act="closeModal">取消</button>' +
      '<button class="btn btn-primary" data-act="doReviseAlloc" data-id="' + d.id + '">保存并重新下发</button></div>');
  }
  async function doReviseAlloc(id) {
    var d = byId(DB.docs, id); if (!d) return;
    var items = (d.items || []).map(function (it) {
      var base = packToBase(it.mid, parseFloat(document.getElementById('rvs_' + it.mid).value));
      return { mid: it.mid, qty: (isNaN(base) || base < 0) ? 0 : base };
    });
    if (!items.some(function (it) { return it.qty > 0; })) { toast('请至少填写一项数量'); return; }
    await apiPost('alloc', { op: 'revise', id: id, items: items });
    closeModal(); await refresh(); render(); toast('已修改并重新下发');
  }
  async function doCancelAlloc(id) {
    if (!window.confirm('确定作废该配货单？作废后来源订货单恢复为「已通过」，可重新下发。')) return;
    await apiPost('alloc', { op: 'cancel', id: id });
    await refresh(); render(); toast('配货单已作废');
  }
  async function delDoc(id){
    if(!window.confirm('确认删除该单据？删除后不可恢复。')) return;
    await apiPost('doc', { op:'del', id:id });
    await refresh(); render(); toast('已删除');
  }
  async function doWithdrawDoc(id) {
    var msg = USER.role === 'hq'
      ? '撤回后该直发单将转为草稿，可修改数量与下发门店后重新下发（仍免审批、不占门店每周常规次数）。确认撤回？'
      : '撤回后该单将转为草稿，可修改后重新提交。确认撤回？';
    if (!window.confirm(msg)) return;
    closeModal(); await apiPost('doc', { op: 'withdraw', id: id });
    await refresh(); render(); toast('已撤回为草稿，可继续编辑');
  }
  async function doResolveDiff(id) {
    if (!window.confirm('确认收货差异已处理完毕？确认后按门店实收数入库，配货单转为「已入库」。')) return;
    closeModal();
    await apiPost('approve?id=' + encodeURIComponent(id) + '&decision=approve', {});
    await refresh(); render(); toast('差异已复核处理');
  }

  // ---------- 工具补充 ----------
  function dayAddJS(dstr, n){ var p=dstr.split("-"); var dt=new Date(p[0],p[1]-1,p[2]); dt.setDate(dt.getDate()+n); return dt.getFullYear()+"-"+("0"+(dt.getMonth()+1)).slice(-2)+"-"+("0"+dt.getDate()).slice(-2); }
  function csvCell(s){ s = s==null?"":String(s); if(/[",\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"'; return s; }
  function stat(label, value){ return '<div class="stat"><div class="label">'+esc(label)+'</div><div class="value">'+esc(value)+'</div></div>'; }
  function triggerCsv(filename, text){
    var blob = new Blob(['﻿'+text], {type:'text/csv;charset=utf-8'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // ---------- 商品与配方（HQ） ----------
  function viewCatalog(){
    var prodCards = (DB.products||[]).map(function(p){
      var combos = [["hot","M"],["ice","M"]];
      var detail = combos.map(function(c){
        var key = p.id+"|"+c[0]+"|"+c[1];
        var bom = DB.boms[key]||[];
        var list = bom.map(function(b){ return matName(b.mid)+" "+fmt(b.qty)+unitOf(b.mid); }).join("、") || "—";
        return '<div class="kv"><span>'+esc(c[0]==="hot"?"热":"冰")+' / '+(c[1]==="M"?"12OZ":"大杯")+'</span><b>'+esc(list)+'</b> '+costBadge(recipeCost(bom))+'</div>';
      }).join('');
      return '<div class="card"><div class="card-h"><h3>'+esc(p.name)+' '+(p.price>0?'<span class="muted">'+money(p.price)+'</span>':'')+'</h3><span><button class="btn btn-sm" data-act="editBom" data-id="'+p.id+'">编辑配方</button> <button class="btn btn-sm" data-act="renameProduct" data-id="'+p.id+'">重命名</button> <button class="btn btn-sm btn-danger" data-act="delProduct" data-id="'+p.id+'">删除</button></span></div>'+detail+'</div>';
    }).join('');
    var addonCards = (DB.addons||[]).map(function(a){
      var key = "a|"+a.id;
      var bom = DB.boms[key]||[];
      var list = bom.map(function(b){ return matName(b.mid)+" "+fmt(b.qty)+unitOf(b.mid); }).join("、") || "—";
      return '<div class="card"><div class="card-h"><h3>'+esc(a.name)+'（+'+fmt(a.price)+'元）</h3>'+
        '<span><button class="btn btn-sm" data-act="editAddon" data-id="'+a.id+'">编辑</button> '+
        '<button class="btn btn-sm btn-danger" data-act="delAddon" data-id="'+a.id+'">删除</button></span></div>'+
        '<div class="kv"><span>配方</span><b>'+esc(list)+'</b> '+costBadge(recipeCost(bom))+'</div></div>';
    }).join('');
    return '<div class="toolbar"><h2 style="margin:0;font-size:18px">商品与配方</h2><div class="spacer"></div>'+
      '<button class="btn btn-primary" data-act="newProduct">新建商品</button> '+
      '<button class="btn" data-act="newAddon">新建加料</button></div>'+
      '<div class="sec">商品配方</div><div class="grid-2">'+prodCards+'</div>'+
      '<div class="sec">加料</div><div class="grid-2">'+addonCards+'</div>';
  }
  function openProductModal(pid){
    var p = pid ? byId(DB.products, pid) : null;
    openModal('<h2>'+(p?'重命名商品':'新建商品')+'</h2><input type="hidden" id="prod_id" value="'+(pid||'')+'"><div class="field"><label class="fld">商品名称</label><input class="in" id="prod_name" value="'+esc(p?p.name:'')+'" placeholder="如 生椰拿铁"></div>'+
      '<div class="field"><label class="fld">标准售价(元)</label><input class="in" id="prod_price" type="number" step="0.01" value="'+(p?p.price:'')+'" placeholder="菜单标价，用于参考与外卖实付分摊"></div>'+
      '<div class="foot"><button class="btn" data-act="closeModal">取消</button><button class="btn btn-primary" data-act="saveProduct">'+(p?'保存':'创建')+'</button></div>');
  }
  async function saveProduct(){
    var name = val('prod_name'); if(!name){ toast('请输入名称'); return; }
    var price = parseFloat(val('prod_price'))||0;
    var pid = val('prod_id');
    if(pid){ await apiPost('product', { op:'edit', id:pid, name:name, price:price }); toast('已保存'); }
    else { await apiPost('product', { op:'add', name:name, price:price }); toast('已创建商品'); }
    closeModal(); await refresh(); render();
  }
  async function delProduct(pid){
    if(!window.confirm('确认删除该商品及其配方？相关销售记录保留但不再关联名称。')) return;
    await apiPost('product', { op:'del', id:pid }); closeModal(); await refresh(); render(); toast('已删除商品');
  }
  function openBomModal(pid){
    var p = byId(DB.products, pid); if(!p) return;
    var combos = [["hot","M"],["ice","M"]];
    var blocks = combos.map(function(c){
      var key = pid+"|"+c[0]+"|"+c[1];
      var cur = {}; (DB.boms[key]||[]).forEach(function(b){ cur[b.mid]=b.qty; });
      var rows = (DB.materials||[]).map(function(m){
        var v = cur[m.id]||0;
        return '<div class="row" style="align-items:center;margin-bottom:6px"><div style="flex:1">'+esc(m.name)+' <span class="muted">('+esc(m.unit)+' · '+money(matPrice(m.id))+'/'+esc(m.unit)+')</span></div><input class="in" style="width:90px" type="number" min="0" step="0.01" id="bom_'+c[0]+'_'+c[1]+'_'+m.id+'" value="'+v+'" oninput="recalcBomCost()"></div>';
      }).join('');
      return '<div style="margin-bottom:14px"><b>'+esc(c[0]==="hot"?"热":"冰")+' / '+(c[1]==="M"?"12OZ":"大杯")+'</b><div style="margin-top:6px">'+rows+'</div></div>';
    }).join('');
    openModal('<h2>编辑配方：'+esc(p.name)+'</h2><input type="hidden" id="bom_pid" value="'+pid+'"><div style="margin:12px 0;max-height:55vh;overflow:auto">'+blocks+'</div><div class="foot"><span style="flex:1;font-size:13px">本配方成本（各规格合计） <b id="bom_cost_preview">'+money(recipeCostAll(pid))+'</b></span><button class="btn" data-act="closeModal">取消</button><button class="btn btn-primary" data-act="saveBom">保存配方</button></div>');
  }
  function recalcBomCost(){
    var el = document.getElementById('bom_cost_preview'); if(!el) return;
    var total = 0;
    [["hot","M"],["ice","M"]].forEach(function(c){
      (DB.materials||[]).forEach(function(m){
        var inp = document.getElementById('bom_'+c[0]+'_'+c[1]+'_'+m.id);
        if(inp){ var v = parseFloat(inp.value)||0; if(v>0) total += v * matPrice(m.id); }
      });
    });
    el.textContent = money(total);
  }
  async function saveBom(){
    var pid = val('bom_pid'); if(!pid) return;
    var combos = [["hot","M"],["ice","M"]];
    var bomsData = {};
    combos.forEach(function(c){
      var key = c[0]+"|"+c[1];
      var arr = [];
      (DB.materials||[]).forEach(function(m){
        var v = parseFloat(document.getElementById('bom_'+c[0]+'_'+c[1]+'_'+m.id).value)||0;
        if(v>0) arr.push({mid:m.id, qty:v});
      });
      bomsData[key]=arr;
    });
    // 保留预留的大杯(L)配方数据，避免保存时被后端全量重插清空
    [["hot","L"],["ice","L"]].forEach(function(c){
      var existing = DB.boms[pid+"|"+c[0]+"|"+c[1]];
      if(existing && existing.length){ bomsData[c[0]+"|"+c[1]] = existing; }
    });
    await apiPost('product', { op:'bom', id:pid, boms:bomsData }); closeModal(); await refresh(); render(); toast('已保存配方');
  }
  function openAddonModal(id){
    var a = id ? byId(DB.addons, id) : null;
    var matRows = (DB.materials||[]).map(function(m){
      var boms = DB.boms["a|"+id]||[];
      var cur = (boms.filter(function(b){return b.mid===m.id;})[0]||{}).qty||0;
      return '<div class="row" style="align-items:center;margin-bottom:6px"><div style="flex:1">'+esc(m.name)+'</div><input class="in" style="width:90px" type="number" min="0" step="0.01" id="adn_'+m.id+'" value="'+cur+'"></div>';
    }).join('');
    openModal('<h2>'+(a?'编辑加料':'新建加料')+'</h2><input type="hidden" id="addon_id" value="'+(id||'')+'">'+
      '<div class="field"><label class="fld">加料名称</label><input class="in" id="addon_name" value="'+esc(a?a.name:'')+'"></div>'+
      '<div class="field"><label class="fld">加价(元)</label><input class="in" type="number" step="0.01" id="addon_price" value="'+esc(a?a.price:'')+'"></div>'+
      '<div class="hint">配方（消耗物料）：</div><div style="margin:10px 0;max-height:40vh;overflow:auto">'+matRows+'</div>'+
      '<div class="foot"><button class="btn" data-act="closeModal">取消</button><button class="btn btn-primary" data-act="saveAddon">保存</button></div>');
  }
  async function saveAddon(){
    var id = val('addon_id'); var name = val('addon_name'); var price = parseFloat(val('addon_price'))||0;
    if(!name){ toast('请输入名称'); return; }
    var bom = []; (DB.materials||[]).forEach(function(m){ var v=parseFloat(document.getElementById('adn_'+m.id).value)||0; if(v>0) bom.push({mid:m.id,qty:v}); });
    var body = { op: id?'edit':'add', name:name, price:price, bom:bom };
    if(id) body.id = id;
    await apiPost('addon', body); closeModal(); await refresh(); render(); toast('已保存加料');
  }
  async function delAddon(id){
    if(!window.confirm('确认删除该加料？')) return;
    await apiPost('addon', { op:'del', id:id }); await refresh(); render(); toast('已删除');
  }

  // ---------- 物料目录（HQ） ----------
  function viewMaterials(){
    var isHq = USER.role==='hq';
    var rows = (DB.materials||[]).map(function(m){
      var stkTag = (m.in_stocktake===0) ? '<span class="tag-pill rejected">不盘点</span>' : '<span class="tag-pill ok">盘点</span>';
      var handle = isHq ? '<span class="drag-handle" title="拖动排序">⠿</span>' : '';
      var dragAttr = isHq ? ' draggable="true"' : '';
      return '<tr data-id="'+m.id+'"'+dragAttr+'>'+
        (isHq?'<td class="drag-cell">'+handle+'</td>':'')+
        '<td>'+esc(m.name)+'</td><td>'+esc(m.unit)+'</td><td class="num">'+money(m.price)+'</td><td class="num">'+fmt(m.min_order)+'</td><td>'+stkTag+'</td>'+
        '<td class="ops"><button class="btn btn-sm" data-act="editMaterial" data-id="'+m.id+'">编辑</button> '+
        '<button class="btn btn-sm btn-danger" data-act="delMaterial" data-id="'+m.id+'">删除</button></td></tr>';
    }).join('');
    var hint = isHq ? '<span class="hint" style="margin-right:12px">拖动行首 ⠿ 调整顺序（仅总部，修改实时同步到所有门店）</span>' : '';
    return '<div class="toolbar"><h2 style="margin:0;font-size:18px">物料目录</h2><div class="spacer"></div>'+ hint +
      '<button class="btn btn-primary" data-act="newMaterial">新建物料</button></div>'+
      '<div class="card"><table><thead><tr>'+(isHq?'<th class="drag-col"></th>':'')+'<th>物料</th><th>单位</th><th class="num">单价</th><th class="num">最低订购</th><th>盘点</th><th class="ops">操作</th></tr></thead><tbody id="mat_tbody">'+rows+'</tbody></table></div>'+
      '<div class="hint">删除物料会同时清除其相关配方与库存记录。关闭「盘点」的物料（如门店路由器等非消耗品）不会出现在每周盘点单中。拖动行首 ⠿ 即可调整顺序，顺序对所有门店的订货 / 盘点 / 库存界面实时生效。</div>';
  }
  function matUnitPreviewInit(m){
    var unit = (m&&m.unit)||'?';
    var denom = (m&&m.pack_qty>0)?m.pack_qty:((m&&m.min_order>0)?m.min_order:0);
    var pp = (m&&m.pack_price>0)?m.pack_price:0;
    if(pp>0 && denom>0) return '系统自动核算：1'+unit+' ≈ ¥'+(pp/denom).toFixed(4)+'（采购总价 ÷ '+(m.pack_qty>0?('包装规格 '+fmt(denom)):('最低订购量 '+fmt(denom)))+'）';
    return '填写“采购总价”后，系统自动核算每'+unit+'单价，无需手填';
  }
  function matUnitPreview(){
    var unit = val('mat_unit')||'?';
    var pp = parseFloat(val('mat_pack_price'))||0;
    var pq = parseFloat(val('mat_pack_qty'));
    var pqv = (pq==null||isNaN(pq)||pq<=0) ? (parseFloat(val('mat_min'))||0) : pq;
    var el = document.getElementById('mat_unit_preview'); if(!el) return;
    if(pp>0 && pqv>0){ el.textContent = '系统自动核算：1'+unit+' ≈ ¥'+(pp/pqv).toFixed(4)+'（采购总价 ÷ '+(pq>0?('包装规格 '+fmt(pqv)):('最低订购量 '+fmt(pqv)))+'）'; }
    else { el.textContent = '填写“采购总价”后，系统自动核算每'+unit+'单价，无需手填'; }
  }
  function openMaterialModal(id){
    var m = id ? byId(DB.materials, id) : null;
    openModal('<h2>'+(m?'编辑物料':'新建物料')+'</h2><input type="hidden" id="mat_id" value="'+(id||'')+'">'+
      '<div class="field"><label class="fld">名称</label><input class="in" id="mat_name" value="'+esc(m?m.name:'')+'"></div>'+
      '<div class="form-grid"><div><label class="fld">单位(基础)</label><input class="in" id="mat_unit" value="'+esc(m?m.unit:'')+'" placeholder="如 ml / g"></div>'+
      '<div><label class="fld">采购总价(元)</label><input class="in" id="mat_pack_price" type="number" step="0.01" value="'+esc((m&&m.pack_price)?m.pack_price:'')+'" placeholder="一包装单位的进货总价"></div></div>'+
      '<div class="form-grid"><div><label class="fld">最低订购量</label><input class="in" id="mat_min" type="number" step="0.01" value="'+esc(m?m.min_order:'')+'"></div>'+
      '<div><label class="fld">包装规格(选填)</label><input class="in" id="mat_pack_qty" type="number" step="0.01" value="'+esc((m&&m.pack_qty)?m.pack_qty:'')+'" placeholder="如 12000" oninput="matUnitPreview()"></div></div>'+
      '<div class="field"><label class="fld">包装单位(选填·订货用)</label><input class="in" id="mat_pack_unit" value="'+esc(m?m.pack_unit:'')+'" placeholder="如 箱 / 袋 / 件"></div>'+
      '<div class="form-grid"><div><label class="fld">盘点单位(选填·盘点用)</label><input class="in" id="mat_stk_unit" value="'+esc((m&&m.stk_unit)?m.stk_unit:'')+'" placeholder="如 罐 / 盒 / 个"></div>'+
      '<div><label class="fld">盘点规格(选填)</label><input class="in" id="mat_stk_qty" type="number" step="0.01" value="'+esc((m&&m.stk_qty)?m.stk_qty:'')+'" placeholder="1盘点单位=多少基础单位"></div></div>'+
      '<div class="field" style="flex-direction:row;align-items:center;justify-content:space-between;gap:12px;margin-top:10px"><label class="fld" style="margin:0">参与每周盘点</label>'+
      '<label class="switch"><input type="checkbox" id="mat_stk_on" '+((m&&m.in_stocktake===0)?'':'checked')+'><span class="slider"></span></label></div>'+
      '<div class="hint">关闭后，该物料（如门店路由器、设备等非消耗品）不出现在每周盘点单中，但仍正常参与库存与订货管理。</div>'+
      '<div class="hint" id="mat_unit_preview">'+matUnitPreviewInit(m)+'</div>'+
      '<div class="hint" style="border-top:1px dashed var(--muted);padding-top:8px;margin-top:4px">⚠️ 盘点单位与订货单位<b>相互独立</b>：盘点按「盘点单位」如实填写（如 罐/盒/个），可填小数；未设置时自动沿用订货单位（箱/袋）。<b>包材（杯托/单杯袋/双杯袋等）请在此设「盘点单位=个」</b>，否则会按「箱」盘点出现“几百箱”的失真。</div>'+
      '<div class="foot"><button class="btn" data-act="closeModal">取消</button><button class="btn btn-primary" data-act="saveMaterial">保存</button></div>');
  }
  async function saveMaterial(){
    var id = val('mat_id'); var name = val('mat_name'); var unit = val('mat_unit');
    var packPrice = parseFloat(val('mat_pack_price'))||0; var min = parseFloat(val('mat_min'))||0;
    var packVal = val('mat_pack_qty'); var packQty = (packVal===""||packVal==null)?null:parseFloat(packVal); var packUnit = val('mat_pack_unit');
    var stkUnitVal = val('mat_stk_unit'); var stkUnit = (stkUnitVal||'').trim();
    var stkQtyVal = val('mat_stk_qty'); var stkQty = (stkQtyVal===""||stkQtyVal==null)?null:parseFloat(stkQtyVal);
    if(stkUnit && !(stkQty!=null && stkQty>0)){ toast('填写了盘点单位时，需同时填写盘点规格（如 1罐=330ml 填 330）'); return; }
    if(!name){ toast('请输入名称'); return; }
    var stkOnEl = document.getElementById('mat_stk_on');
    var inStocktake = stkOnEl ? (stkOnEl.checked ? 1 : 0) : 1;
    var body = { op: id?'edit':'add', name:name, unit:unit, pack_price:packPrice, min_order:min, pack_qty:packQty, pack_unit:packUnit, stk_unit:stkUnit, stk_qty:stkQty, in_stocktake:inStocktake };
    if(id) body.id = id;
    await apiPost('material', body); closeModal(); await refresh(); render(); toast('已保存物料');
  }
  async function delMaterial(id){
    if(!window.confirm('确认删除该物料？相关配方与库存将一并清除。')) return;
    await apiPost('material', { op:'del', id:id }); await refresh(); render(); toast('已删除');
  }
  // 拖拽排序（仅总部）：通过事件委托处理 #mat_tbody 内的行拖动
  var dragSrcId = null;
  function onMatDragStart(e){
    var tr = e.target && e.target.closest ? e.target.closest('tr[data-id]') : null;
    if(!tr || !tr.parentNode || tr.parentNode.id !== 'mat_tbody') return;
    if(!USER || USER.role !== 'hq') return;
    dragSrcId = tr.getAttribute('data-id');
    tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragSrcId); } catch(_){}
  }
  function onMatDragOver(e){
    if(!dragSrcId) return;
    var tbody = document.getElementById('mat_tbody');
    if(!tbody || !tbody.contains(e.target)) return;
    e.preventDefault();
    var tr = e.target.closest ? e.target.closest('tr[data-id]') : null;
    if(!tr || tr.getAttribute('data-id') === dragSrcId) return;
    var rect = tr.getBoundingClientRect();
    var after = (e.clientY - rect.top) > rect.height/2;
    var src = tbody.querySelector('tr.dragging');
    if(!src) return;
    if(after) tr.parentNode.insertBefore(src, tr.nextSibling); else tr.parentNode.insertBefore(src, tr);
  }
  function onMatDrop(e){
    if(!dragSrcId) return;
    var tbody = document.getElementById('mat_tbody');
    if(!tbody) return;
    e.preventDefault();
    var ids = [];
    tbody.querySelectorAll('tr[data-id]').forEach(function(r){ ids.push(r.getAttribute('data-id')); });
    tbody.querySelectorAll('tr.dragging').forEach(function(r){ r.classList.remove('dragging'); });
    dragSrcId = null;
    reorderLocalMaterials(ids);
    apiPost('material', { op:'reorder', ids:ids }).then(function(){ toast('顺序已保存'); }).catch(function(err){ toast(err.message||'保存失败'); });
  }
  function onMatDragEnd(){
    dragSrcId = null;
    var tbody = document.getElementById('mat_tbody');
    if(tbody) tbody.querySelectorAll('tr.dragging').forEach(function(r){ r.classList.remove('dragging'); });
  }
  function reorderLocalMaterials(ids){
    if(!DB || !DB.materials) return;
    var map = {}; DB.materials.forEach(function(m){ map[m.id] = m; });
    DB.materials = ids.map(function(id){ return map[id]; }).filter(Boolean);
  }

  // ---------- 门店管理（HQ） ----------
  function viewStores(){
    var rows = (DB.stores||[]).map(function(s){
      return '<tr><td>'+esc(s.name)+(s.active?'':' <span class="tag-pill rejected">停用</span>')+'</td>'+
        '<td>'+(s.active?'启用':'停用')+'</td>'+
        '<td class="ops"><button class="btn btn-sm" data-act="renameStore" data-id="'+s.id+'">改名</button> '+
        '<button class="btn btn-sm '+(s.active?'btn-danger':'btn-primary')+'" data-act="toggleStore" data-id="'+s.id+'">'+(s.active?'停用':'启用')+'</button> '+
        '<button class="btn btn-sm" data-act="resetPwd" data-id="'+s.id+'">重置密码</button></td></tr>';
    }).join('');
    return '<div class="toolbar"><h2 style="margin:0;font-size:18px">门店管理</h2><div class="spacer"></div>'+
      '<button class="btn btn-primary" data-act="newStore">新建门店</button></div>'+
      '<div class="hint" style="margin-bottom:12px">新建门店会自动生成「店长 / 店员」两个账号（密码 123456）；停用后保留全部历史单据与库存数据。</div>'+
      '<div class="card"><table><thead><tr><th>门店</th><th>状态</th><th class="ops">操作</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
  function openStoreModal(id){
    var s = id ? byId(DB.stores, id) : null;
    var html = s ? '<input type="hidden" id="store_id" value="'+s.id+'"><div class="field"><label class="fld">门店名称</label><input class="in" id="store_name" value="'+esc(s.name)+'"></div>'
                 : '<div class="field"><label class="fld">门店名称</label><input class="in" id="store_name" placeholder="如 上海静安嘉里中心店"></div>';
    openModal('<h2>'+(s?'门店改名':'新建门店')+'</h2>'+html+'<div class="foot"><button class="btn" data-act="closeModal">取消</button><button class="btn btn-primary" data-act="saveStore">保存</button></div>');
  }
  async function saveStore(){
    var id = val('store_id'); var name = val('store_name');
    if(!name){ toast('请输入名称'); return; }
    if(id){ await apiPost('store', { op:'rename', id:id, name:name }); closeModal(); await refresh(); render(); toast('已保存'); }
    else {
      var r = await apiPost('store', { op:'add', name:name });
      closeModal(); await refresh(); render();
      if(r && r.mgr){ openModal('<h2>门店已创建</h2>'+
        '<div class="hint" style="margin-bottom:10px">已按 s 编号规则自动生成门店账号（默认密码 123456，请在用户中心及时修改）：</div>'+
        '<div class="card" style="margin-bottom:12px"><table><tbody>'+
        '<tr><td class="num" style="font-weight:600">店长</td><td>'+esc(r.mgr)+'</td><td class="num">/ 123456</td></tr>'+
        '<tr><td class="num" style="font-weight:600">店员</td><td>'+esc(r.clerk)+'</td><td class="num">/ 123456</td></tr>'+
        '</tbody></table></div>'+
        '<div class="foot"><button class="btn btn-primary" data-act="closeModal">知道了</button></div>'); }
      else { toast('已保存'); }
    }
  }
  async function toggleStore(id){
    var s = byId(DB.stores, id);
    await apiPost('store', { op:'toggle', id:id, active: s ? (s.active?0:1) : 1 });
    await refresh(); render(); toast('已更新门店状态');
  }
  function openUserCenter(){
    var store = USER.store_id ? (byId(DB.stores, USER.store_id) ? byId(DB.stores, USER.store_id).name : USER.store_id) : '';
    var sub = (USER.role === 'hq' ? '总部账号' : roleLabel(USER.role)) + (store ? (' · ' + store) : '');
    openModal(
      '<div class="uc">' +
      '<div class="uc-head">' +
        '<div class="uc-avatar">' + esc((USER.name || '?').slice(0,1)) + '</div>' +
        '<div class="uc-id"><div class="uc-name">' + esc(USER.name) + '</div><div class="uc-sub">' + esc(sub) + '</div></div>' +
        '<button class="uc-x" data-act="closeModal" aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="uc-section">账户名称</div>' +
      '<div class="uc-account">' + esc(USER.name) + '</div>' +
      '<div class="uc-section">钉钉消息提醒</div>' +
      '<div class="uc-tip">填写本人手机号后，有单据待你处理时，系统会在钉钉群 @ 你（需总部先在「管理 › 消息提醒」配置机器人）。</div>' +
      '<div class="uc-phone"><input class="in" id="uc_phone" value="' + esc(USER.phone || '') + '" placeholder="用于接收钉钉 @ 提醒的手机号" inputmode="numeric" maxlength="11"></div>' +
      '<button class="uc-item" data-act="savePhone"><span class="uc-t">保存手机号</span><span class="uc-chev">›</span></button>' +
      '<button class="uc-item" data-act="changePwd"><span class="uc-t">修改密码</span><span class="uc-chev">›</span></button>' +
      '<button class="uc-item danger" data-act="logout"><span class="uc-t">退出登录</span><span class="uc-chev">›</span></button>' +
      '</div>'
    );
  }
  function openChangePwdModal(){
    openModal('<h2>修改密码</h2>' +
      '<div class="field"><label class="fld">原密码</label><input class="in" id="pwd_old" type="password"></div>' +
      '<div class="field"><label class="fld">新密码</label><input class="in" id="pwd_new" type="password" placeholder="至少 6 位"></div>' +
      '<div class="field"><label class="fld">确认新密码</label><input class="in" id="pwd_new2" type="password"></div>' +
      '<div class="foot"><button class="btn" data-act="closeModal">取消</button><button class="btn btn-primary" data-act="savePwd">保存</button></div>');
  }
  async function changePwd(){
    var oldP = val('pwd_old'), newP = val('pwd_new'), newP2 = val('pwd_new2');
    if(!oldP){ toast('请输入原密码'); return; }
    if(!newP || newP.length < 6){ toast('新密码至少 6 位'); return; }
    if(newP !== newP2){ toast('两次输入的新密码不一致'); return; }
    var d = await apiPost('user', { op:'password', old_password:oldP, new_password:newP });
    if(d && d.ok){ closeModal(); toast('密码已修改，请使用新密码重新登录'); TOKEN=''; localStorage.removeItem('erp_token'); USER=null; render(); }
  }
  async function resetPwd(storeId){
    if(!confirm('确定将「' + (byId(DB.stores, storeId) ? byId(DB.stores, storeId).name : storeId) + '」的店长与店员密码重置为 123456 吗？')) return;
    await apiPost('user', { op:'reset', id:'mgr_' + storeId });
    await apiPost('user', { op:'reset', id:'clerk_' + storeId });
    toast('已重置为 123456');
  }

  // ---------- 销售汇总（HQ，按渠道 + 日期范围） ----------
  function viewSummary(){
    var start = (VIEW_STATE.summary && VIEW_STATE.summary.start) || dayAddJS(todayStr(), -7);
    var end = (VIEW_STATE.summary && VIEW_STATE.summary.end) || todayStr();
    var storeSel = USER.role==='hq' ? '<select class="in" id="sum_store" style="width:200px"><option value="">全部门店</option>'+DB.stores.map(function(s){ return '<option value="'+s.id+'" '+(VIEW_STATE.summary&&VIEW_STATE.summary.store===s.id?'selected':'')+'>'+esc(s.name)+'</option>'; }).join('')+'</select>' : '';
    var bodyHtml = '', d = VIEW_STATE.summary && VIEW_STATE.summary.data;
    if(d){
      var chRows = CHANNELS.map(function(c){ var r=d.byChannel[c.id]||{income:0,qty:0}; return '<tr><td>'+esc(c.name)+'</td><td class="num">'+fmt(r.qty)+'</td><td class="num">'+money(r.income)+'</td></tr>'; }).join('');
      var stRows = Object.keys(d.byStore).map(function(sid){ var r=d.byStore[sid]; var s=byId(DB.stores,sid); return '<tr><td>'+esc(s?s.name:sid)+'</td><td class="num">'+fmt(r.qty)+'</td><td class="num">'+money(r.income)+'</td></tr>'; }).join('');
      var dtRows = Object.keys(d.byDate).sort(function(a,b){ return b.localeCompare(a); }).map(function(dt){ var r=d.byDate[dt]; return '<tr><td>'+dt+'</td><td class="num">'+fmt(r.qty)+'</td><td class="num">'+money(r.income)+'</td></tr>'; }).join('');
      bodyHtml = '<div class="grid-3" style="margin-top:16px">'+stat('总营收',money(d.totalIncome))+stat('总杯量',fmt(d.totalQty)+' 杯')+stat('渠道数',CHANNELS.length+' 个')+'</div>'+
        '<div class="grid-2" style="margin-top:14px"><div class="card"><h3>按渠道</h3><table><thead><tr><th>渠道</th><th class="num">杯量</th><th class="num">营收</th></tr></thead><tbody>'+chRows+'</tbody></table></div>'+
        '<div class="card"><h3>按门店</h3><table><thead><tr><th>门店</th><th class="num">杯量</th><th class="num">营收</th></tr></thead><tbody>'+stRows+'</tbody></table></div></div>'+
        '<div class="card"><h3>按天</h3><table><thead><tr><th>日期</th><th class="num">杯量</th><th class="num">营收</th></tr></thead><tbody>'+dtRows+'</tbody></table></div>';
    } else {
      bodyHtml = '<div class="empty" style="margin-top:16px">点击「查询」加载 '+(USER.role==='hq'?'全部门店':'本店')+'销售汇总</div>';
    }
    return '<div class="toolbar"><div class="search">从 <input class="in" type="date" id="sum_start" value="'+start+'"> 到 <input class="in" type="date" id="sum_end" value="'+end+'"> '+storeSel+'</div>'+
      '<div class="spacer"></div><button class="btn btn-primary" data-act="summaryRange">查询</button> '+
      '<button class="btn" data-act="downloadSummary" '+(d?'':'disabled')+'>下载 CSV</button></div>'+bodyHtml;
  }
  async function loadSummary(){
    var start = val('sum_start') || dayAddJS(todayStr(), -7);
    var end = val('sum_end') || todayStr();
    var store = val('sum_store') || '';
    var qs = 'summary?start='+encodeURIComponent(start)+'&end='+encodeURIComponent(end)+(store?('&store='+encodeURIComponent(store)):'');
    var d = await apiGet(qs);
    VIEW_STATE.summary = { start:start, end:end, store:store, data:d };
    render();
  }
  function downloadSummary(){
    var s = VIEW_STATE.summary; if(!s||!s.data){ toast('请先查询'); return; }
    var d = s.data, lines = [];
    lines.push(['渠道','杯量','营收'].map(csvCell).join(','));
    CHANNELS.forEach(function(c){ var r=d.byChannel[c.id]||{income:0,qty:0}; lines.push([c.name, r.qty, r.income].map(csvCell).join(',')); });
    lines.push([]);
    lines.push(['门店','杯量','营收'].map(csvCell).join(','));
    Object.keys(d.byStore).forEach(function(sid){ var r=d.byStore[sid]; var st=byId(DB.stores,sid); lines.push([st?st.name:sid, r.qty, r.income].map(csvCell).join(',')); });
    lines.push([]);
    lines.push(['日期','杯量','营收'].map(csvCell).join(','));
    Object.keys(d.byDate).sort().forEach(function(dt){ var r=d.byDate[dt]; lines.push([dt, r.qty, r.income].map(csvCell).join(',')); });
    triggerCsv('销售汇总_'+s.start+'_'+s.end+'.csv', lines.join('\n'));
  }

  // ---------- 总部总览看板（HQ） ----------
  function viewDashboard(){
    var docs = DB.docs||[];
    function cnt(type, status, sid){ return docs.filter(function(x){ return x.type===type && x.status===status && (sid?x.store_id===sid:true); }).length; }
    var rows = (DB.stores||[]).map(function(s){
      var reqP = cnt('req','pending_manager',s.id)+cnt('req','pending_hq',s.id);
      var reqA = cnt('req','approved',s.id), reqAl = cnt('req','allocated',s.id);
      var stkP = cnt('stk','pending_manager',s.id)+cnt('stk','pending_hq',s.id), stkA = cnt('stk','approved',s.id);
      var retP = cnt('ret','pending_manager',s.id)+cnt('ret','pending_hq',s.id), retA = cnt('ret','approved',s.id);
      var aloP = cnt('alloc','pending_store_confirm',s.id), aloA = cnt('alloc','confirmed',s.id), aloD = cnt('alloc','diff_pending_hq',s.id);
      return '<tr><td>'+esc(s.name)+(s.active?'':' <span class="tag-pill rejected">停用</span>')+'</td>'+
        '<td class="num">'+(reqP?('<b class="pending">'+reqP+'</b>'):'0')+'</td><td class="num c2">'+reqA+'</td><td class="num c2">'+reqAl+'</td>'+
        '<td class="num">'+(stkP?('<b class="pending">'+stkP+'</b>'):'0')+'</td><td class="num c2">'+stkA+'</td>'+
        '<td class="num">'+(retP?('<b class="pending">'+retP+'</b>'):'0')+'</td><td class="num c2">'+retA+'</td>'+
        '<td class="num">'+(aloP?('<b class="pending">'+aloP+'</b>'):'0')+'</td><td class="num">'+(aloD?('<b class="pending">'+aloD+'</b>'):'0')+'</td><td class="num c2">'+aloA+'</td></tr>';
    }).join('');
    // ----- 理论毛利分析（基于销售记录 income + BOM 理论成本）-----
    var sales = DB.sales || [];
    var pf = profitOf(sales);
    var ds = sales.map(function(s){ return s.date; }).filter(Boolean).sort();
    var rangeTxt = ds.length ? (ds[0] + ' ~ ' + ds[ds.length-1]) : '暂无销售数据';
    function rateCell(v){
      var cls = v < 0 ? ' style="color:var(--danger);font-weight:700"' : '';
      return '<td class="num"'+cls+'>' + v.toFixed(1) + '%</td>';
    }
    var group = {};
    sales.forEach(function(s){ (group[s.pid] = group[s.pid] || []).push(s); });
    var prodRows = Object.keys(group).map(function(pid){
      var p = byId(DB.products, pid);
      return { name: p ? p.name : pid, r: profitOf(group[pid]) };
    }).sort(function(a,b){ return b.r.profit - a.r.profit; }).map(function(x){
      return '<tr><td>'+esc(x.name)+'</td><td class="num">'+fmt(x.r.qty)+'</td>'+
        '<td class="num">'+money(x.r.income)+'</td><td class="num c2">'+money(x.r.cost)+'</td>'+
        '<td class="num">'+money(x.r.profit)+'</td>'+rateCell(x.r.rate)+
        '<td class="num c2">'+money(x.r.qty ? x.r.income/x.r.qty : 0)+'</td>'+
        '<td class="num c2">'+money(x.r.qty ? x.r.cost/x.r.qty : 0)+'</td></tr>';
    }).join('');
    var sgroup = {};
    sales.forEach(function(s){ (sgroup[s.store_id] = sgroup[s.store_id] || []).push(s); });
    var storeProfitRows = Object.keys(sgroup).map(function(sid){
      var st = byId(DB.stores, sid);
      return { name: st ? st.name : sid, r: profitOf(sgroup[sid]) };
    }).sort(function(a,b){ return b.r.profit - a.r.profit; }).map(function(x){
      return '<tr><td>'+esc(x.name)+'</td><td class="num">'+fmt(x.r.qty)+'</td>'+
        '<td class="num">'+money(x.r.income)+'</td><td class="num c2">'+money(x.r.cost)+'</td>'+
        '<td class="num">'+money(x.r.profit)+'</td>'+rateCell(x.r.rate)+'</tr>';
    }).join('');
    var profitBlock = sales.length ? (
      '<div class="grid-4" style="margin-top:4px">'+
        stat('销售收入', money(pf.income))+
        stat('理论成本', money(pf.cost))+
        stat('理论毛利', money(pf.profit))+
        stat('毛利率', pf.rate.toFixed(1)+'%')+
      '</div>'+
      '<div class="hint" style="margin:10px 0 12px">统计区间 '+rangeTxt+'（近 60 天）·共 '+fmt(pf.qty)+' 杯 · 成本＝配方物料理论用量×单位成本，含加料咖啡豆'+
        (pf.noBom ? ('，其中 '+pf.noBom+' 笔无配方按 0 成本计') : '')+'</div>'+
      '<div class="card"><h3>商品毛利排行<span class="tag">按毛利额</span></h3><div class="tbl-scroll"><table><thead><tr><th>商品</th><th class="num">杯量</th><th class="num">收入</th><th class="num">理论成本</th><th class="num">理论毛利</th><th class="num">毛利率</th><th class="num">单杯均价</th><th class="num">单杯成本</th></tr></thead><tbody>'+prodRows+'</tbody></table></div></div>'+
      '<div class="card"><h3>门店毛利对比</h3><div class="tbl-scroll"><table><thead><tr><th>门店</th><th class="num">杯量</th><th class="num">收入</th><th class="num">理论成本</th><th class="num">理论毛利</th><th class="num">毛利率</th></tr></thead><tbody>'+storeProfitRows+'</tbody></table></div></div>'
    ) : '<div class="empty" style="margin-bottom:14px">近 60 天暂无销售记录，无法计算毛利</div>';

    // 负库存预警（总部视角）：各门店扣减为负的物料统计
    var negStores = [];
    (DB.stores || []).forEach(function (s) {
      var invs = (DB.inventory && DB.inventory[s.id]) || {};
      var cnt = 0, gap = 0;
      Object.keys(invs).forEach(function (mid) { if (invs[mid] < 0) { cnt++; gap += invs[mid]; } });
      if (cnt) negStores.push({ name: s.name, cnt: cnt, gap: Math.round(gap * 100) / 100 });
    });
    var negTotal = negStores.reduce(function (a, x) { return a + x.cnt; }, 0);
    var negBlock = negTotal ? (
      '<div class="card" style="margin-top:14px;border:1px solid var(--danger)"><h3 style="color:var(--danger)">负库存预警 <span class="tag-pill low">' + negTotal + ' 项</span></h3>' +
      '<div class="hint" style="margin-bottom:8px">负库存通常是销售漏登记、配方配错或入库漏记的预警信号，请安排门店盘点校准并核查近期销售流水。</div>' +
      '<table><thead><tr><th>门店</th><th class="num">负库存项数</th><th class="num">累计缺口</th></tr></thead><tbody>' +
      negStores.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td class="num" style="color:var(--danger);font-weight:700">' + x.cnt + '</td><td class="num" style="color:var(--danger)">' + fmt(x.gap) + '</td></tr>'; }).join('') +
      '</tbody></table></div>'
    ) : '';
    return '<div class="toolbar"><h2 style="margin:0;font-size:18px">总部总览</h2><div class="spacer"></div>'+
      '<button class="btn btn-primary" data-act="genReco">生成本周推荐</button></div>'+
      profitBlock+
      negBlock+
      '<div class="hint" style="margin-bottom:12px">加粗数字为待处理项。每周五 12:00 系统自动生成各门店推荐订货单（部署后由 Cron 触发）。</div>'+
      '<div class="card"><h3>各门店单据概览</h3><div class="tbl-scroll"><table><thead><tr><th>门店</th><th class="num">订货·待审</th><th class="num">订货·已批</th><th class="num">订货·已配</th><th class="num">盘点·待审</th><th class="num">盘点·已批</th><th class="num">退货·待审</th><th class="num">退货·已批</th><th class="num">配货·待收</th><th class="num">配货·差异</th><th class="num">配货·已入</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  }

  // ---------- 销售分析（门店长：今日 / 近7天 / 商品排行 三卡片） ----------
  // 汇总一批销售：营收、杯量、订单数（order_no 分组）、渠道分布、商品分布
  function saAgg(list) {
    var r = { income: 0, qty: 0, orders: 0, byChannel: {}, byPid: {} };
    var orderSet = {}, solo = 0;
    (list || []).forEach(function (s) {
      r.income += (s.income || 0); r.qty += (s.qty || 1);
      if (s.order_no) orderSet[s.order_no] = 1; else solo++;
      var c = r.byChannel[s.channel] = r.byChannel[s.channel] || { income: 0, qty: 0 };
      c.income += (s.income || 0); c.qty += (s.qty || 1);
      var p = r.byPid[s.pid] = r.byPid[s.pid] || { qty: 0, income: 0 };
      p.qty += (s.qty || 1); p.income += (s.income || 0);
    });
    r.orders = Object.keys(orderSet).length + solo;
    return r;
  }
  // 渠道条形图（金额占比条 + 杯数）
  function saChannelRows(a) {
    var list = CHANNELS.map(function (c) {
      var r = a.byChannel[c.id] || { income: 0, qty: 0 };
      return { name: c.name, income: r.income, qty: r.qty };
    }).filter(function (x) { return x.income > 0 || x.qty > 0; });
    if (!list.length) return '<div class="empty" style="padding:18px">该时段暂无销售</div>';
    var max = 0; list.forEach(function (x) { if (x.income > max) max = x.income; });
    return list.map(function (x) {
      var pct = max > 0 ? Math.max(2, Math.round(x.income / max * 100)) : 0;
      return '<div class="ch-row"><div class="ch-name">' + esc(x.name) + '</div>' +
        '<div class="ch-bar-wrap"><div class="ch-bar" style="width:' + pct + '%"></div></div>' +
        '<div class="ch-nums"><b>' + money(x.income) + '</b><span>' + fmt(x.qty) + ' 杯</span></div></div>';
    }).join('');
  }
  function viewSalesAnalysis() {
    var sales = DB.sales || [];
    var today = todayStr();
    var end = (VIEW_STATE.sa && VIEW_STATE.sa.end) || today;
    var start7 = dayAddJS(end, -6);
    var tA = saAgg(sales.filter(function (s) { return s.date === today; }));
    var wA = saAgg(sales.filter(function (s) { return s.date >= start7 && s.date <= end; }));
    // 近7天商品销售排名（按杯数降序）
    var rankList = Object.keys(wA.byPid).map(function (pid) {
      var p = byId(DB.products, pid);
      return { name: p ? p.name : pid, qty: wA.byPid[pid].qty, income: wA.byPid[pid].income };
    }).sort(function (a, b) { return b.qty - a.qty; });
    var rankRows = rankList.length ? rankList.map(function (x, i) {
      var badge = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : '<span class="rank-no">' + (i + 1) + '</span>'));
      return '<div class="rank-row"><div class="rank-badge">' + badge + '</div><div class="rank-name">' + esc(x.name) + '</div>' +
        '<div class="rank-nums"><b>' + fmt(x.qty) + ' 杯</b><span>' + money(x.income) + '</span></div></div>';
    }).join('') : '<div class="empty" style="padding:18px">近 7 天暂无销售</div>';
    return '<div class="toolbar"><h2 style="margin:0;font-size:18px">销售分析</h2><div class="spacer"></div><span class="hint">本店数据</span></div>' +
      '<div class="card" style="margin-top:14px"><h3>今日销售 · ' + today + '</h3>' +
      '<div class="grid-3">' + stat('今日销售总金额', money(tA.income)) + stat('今日杯量', fmt(tA.qty) + ' 杯') + stat('今日订单数', tA.orders + ' 单') + '</div>' +
      '<div class="sa-sub">各渠道销售</div>' + saChannelRows(tA) + '</div>' +
      '<div class="card" style="margin-top:14px"><h3>近 7 天销售（' + start7 + ' ~ ' + end + '）</h3>' +
      '<div class="sa-date-pick">统计至 <input class="in" type="date" id="sa_end" value="' + end + '" max="' + today + '"><span class="hint">选择日期后自动统计往前 7 天</span></div>' +
      '<div class="grid-3">' + stat('7 天总营收', money(wA.income)) + stat('7 天杯量', fmt(wA.qty) + ' 杯') + stat('日均营收', money(Math.round(wA.income / 7 * 100) / 100)) + '</div>' +
      '<div class="sa-sub">各渠道销售</div>' + saChannelRows(wA) + '</div>' +
      '<div class="card" style="margin-top:14px"><h3>近 7 天商品销售排名 <span class="tag">按杯数降序</span></h3>' + rankRows + '</div>';
  }
  // ---------- 结算单（HQ，按门店×月） ----------
  function viewSettlement(){
    var month = (VIEW_STATE.settlement && VIEW_STATE.settlement.month) || todayStr().slice(0,7);
    var d = VIEW_STATE.settlement && VIEW_STATE.settlement.data, bodyHtml = '';
    if(d){
      var storeRows = Object.keys(d.byStore).map(function(sid){ var r=d.byStore[sid]; var s=byId(DB.stores,sid); return '<tr><td>'+esc(s?s.name:sid)+'</td><td class="num">'+r.count+'</td><td class="num">'+money(r.amount)+'</td></tr>'; }).join('');
      var docRows = d.rows.map(function(r){ var s=byId(DB.stores,r.store_id); return '<tr><td>'+esc(r.id)+'</td><td>'+esc(s?s.name:r.store_id)+'</td><td>'+r.date+'</td><td><span class="tag-pill '+(STATUS_CLASS[r.status]||'draft')+'">'+esc(STATUS_LABEL[r.status]||r.status)+'</span></td><td class="num">'+money(r.amount)+'</td></tr>'; }).join('');
      bodyHtml = '<div class="grid-3" style="margin-top:16px">'+stat('结算月份',d.month)+stat('配货单总数',d.rows.length+' 单')+stat('结算总额',money(d.total))+'</div>'+
        '<div class="card" style="margin-top:14px"><h3>按门店汇总</h3><table><thead><tr><th>门店</th><th class="num">配货单数</th><th class="num">金额</th></tr></thead><tbody>'+storeRows+'</tbody></table></div>'+
        '<div class="card"><h3>配货单明细</h3><table><thead><tr><th>单号</th><th>门店</th><th>日期</th><th>状态</th><th class="num">金额</th></tr></thead><tbody>'+docRows+'</tbody></table></div>';
    } else {
      bodyHtml = '<div class="empty" style="margin-top:16px">选择月份后点击「查询」生成结算单</div>';
    }
    return '<div class="toolbar"><div class="search">月份 <input class="in" type="month" id="set_month" value="'+month+'"></div>'+
      '<div class="spacer"></div><button class="btn btn-primary" data-act="settlementMonth">查询</button> '+
      '<button class="btn" data-act="downloadSettlement" '+(d?'':'disabled')+'>下载 CSV</button></div>'+bodyHtml;
  }
  async function loadSettlement(){
    var month = val('set_month') || todayStr().slice(0,7);
    var d = await apiGet('settlement?month='+encodeURIComponent(month));
    VIEW_STATE.settlement = { month:month, data:d };
    render();
  }
  function downloadSettlement(){
    var s = VIEW_STATE.settlement; if(!s||!s.data){ toast('请先查询'); return; }
    var d = s.data, lines = [];
    lines.push(['门店','配货单数','金额'].map(csvCell).join(','));
    Object.keys(d.byStore).forEach(function(sid){ var r=d.byStore[sid]; var st=byId(DB.stores,sid); lines.push([st?st.name:sid, r.count, r.amount].map(csvCell).join(',')); });
    lines.push([]);
    lines.push(['单号','门店','日期','状态','金额'].map(csvCell).join(','));
    d.rows.forEach(function(r){ var st=byId(DB.stores,r.store_id); lines.push([r.id, st?st.name:r.store_id, r.date, r.status, r.amount].map(csvCell).join(',')); });
    triggerCsv('结算单_'+d.month+'.csv', lines.join('\n'));
  }

  function viewMgmt() {
    return '<div class="card"><h3>设置</h3>' +
      '<p class="hint">当前账号：' + esc(USER.name) + '（' + roleLabel(USER.role) + '）</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' +
      '<button class="btn" data-act="changePwd">修改密码</button>' +
      '<button class="btn btn-danger" data-act="logout">退出登录</button></div></div>';
  }

  // 钉钉消息提醒配置（仅总部可见）
  async function loadNotifySettings() {
    try { VIEW_STATE.notify = await apiGet('notify-settings'); }
    catch (e) { VIEW_STATE.notify = { ding_webhook: '', ding_secret: '', ding_on: '1', app_url: '' }; }
  }
  function viewNotify() {
    if (USER.role !== 'hq') return '<div class="empty">仅总部可配置消息提醒</div>';
    var s = VIEW_STATE.notify || {};
    var on = (s.ding_on !== '0');
    return '<div class="card"><h3>钉钉消息提醒</h3>' +
      '<p class="hint">在钉钉群添加「自定义机器人（安全设置选「加签」）」，把 Webhook 地址与加签密钥填到下面。' +
      '新单据待审 / 待收货 / 收货差异时，系统自动在群里 @ 对应负责人（各用户需在「用户中心」填写本人手机号）。</p>' +
      '<div class="field"><label class="fld">机器人 Webhook 地址</label><input class="in" id="nf_hook" value="' + esc(s.ding_webhook || '') + '" placeholder="https://oapi.dingtalk.com/robot/send?access_token=xxxx"></div>' +
      '<div class="field"><label class="fld">加签密钥 Secret</label><input class="in" id="nf_secret" value="' + esc(s.ding_secret || '') + '" placeholder="机器人安全设置中的加签密钥"></div>' +
      '<div class="field"><label class="fld">工作台地址（消息内跳转用）</label><input class="in" id="nf_url" value="' + esc(s.app_url || '') + '" placeholder="https://coffee-erp-8cv.pages.dev"></div>' +
      '<div class="field row"><label class="fld">启用提醒</label><label class="switch"><input type="checkbox" id="nf_on" ' + (on ? 'checked' : '') + '><span class="slider"></span></label></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' +
      '<button class="btn btn-primary" data-act="saveNotify">保存配置</button>' +
      '<button class="btn" data-act="testNotify">发送测试消息</button></div>' +
      '<p class="hint" style="margin-top:14px">提示：钉钉「自定义机器人」不支持 @ 到具体人以外的手机推送，@ 仅在群内可见；若需强提醒（手机弹窗），后续可升级为钉钉「企业内部应用 · 工作通知」。</p></div>';
  }
  async function saveNotify() {
    var d = await apiPost('notify-settings', {
      op: 'save',
      ding_webhook: val('nf_hook'),
      ding_secret: val('nf_secret'),
      app_url: val('nf_url'),
      ding_on: document.getElementById('nf_on').checked ? '1' : '0'
    });
    if (d && d.ok) { toast('消息提醒配置已保存'); await loadNotifySettings(); render(); }
    else if (d && d.error) toast(d.error);
  }
  async function testNotify() {
    var d = await apiPost('notify-settings', { op: 'test' });
    if (d && d.ok) toast('测试消息已发送，请查看钉钉群');
    else if (d && d.error) toast(d.error);
  }
  async function savePhone() {
    var phone = (val('uc_phone') || '').trim();
    var d = await apiPost('user', { op: 'phone', phone: phone });
    if (d && d.ok) { USER.phone = phone; closeModal(); toast('手机号已保存'); }
    else if (d && d.error) toast(d.error);
  }

  // ---------- 淘宝闪购 / 三方外卖平台对接 ----------
  function viewPlatform() {
    if (USER.role !== 'hq') return '<div class="empty">仅总部可配置平台对接</div>';
    var p = VIEW_STATE.platform || {};
    var cred = p.cred || {};
    var shops = p.shops || [];
    var items = p.items || [];
    var storeOpts = (DB.stores || []).map(function(s){ return '<option value="'+s.id+'">'+(s.name||s.id)+'</option>'; }).join('');
    var prodOpts = (DB.products || []).map(function(pr){ return '<option value="'+pr.id+'">'+(pr.name||pr.id)+'</option>'; }).join('');
    var shopRows = shops.map(function(s){ var sn = byId(DB.stores, s.store_id); return '<tr><td>'+esc(s.platform_shop_name||s.platform_shop_id)+'</td><td>'+(sn?esc(sn.name):s.store_id)+'</td><td><button class="btn btn-sm btn-danger" data-act="delShop" data-id="'+s.id+'">删除</button></td></tr>'; }).join('') || '<tr><td colspan="3" class="muted">暂无映射</td></tr>';
    var itemRows = items.map(function(it){ var pr = byId(DB.products, it.pid); return '<tr><td>'+esc(it.platform_title||it.platform_item_id)+'</td><td>'+(pr?esc(pr.name):it.pid)+' / '+(it.temp||'hot')+' / '+(it.size||'M')+'</td><td><button class="btn btn-sm btn-danger" data-act="delItem" data-id="'+it.id+'">删除</button></td></tr>'; }).join('') || '<tr><td colspan="3" class="muted">暂无映射</td></tr>';
    return '<div class="card"><h3>淘宝闪购对接 · 开放平台凭证</h3>' +
      '<p class="hint">填入淘宝开放平台应用的 AppKey / AppSecret 与门店授权 token（token 通常 7~30 天过期，需定期更新）。</p>' +
      '<div class="field"><label class="fld">AppKey</label><input class="in" id="pc_appkey" value="'+esc(cred.app_key||'')+'"></div>' +
      '<div class="field"><label class="fld">AppSecret</label><input class="in" id="pc_appsecret" type="password" value="'+esc(cred.app_secret||'')+'"></div>' +
      '<div class="field"><label class="fld">Access Token</label><input class="in" id="pc_token" value="'+esc(cred.access_token||'')+'"></div>' +
      '<div class="field"><label class="fld">Refresh Token</label><input class="in" id="pc_refresh" value="'+esc(cred.refresh_token||'')+'"></div>' +
      '<div class="field"><label class="fld">Token 过期时间</label><input class="in" id="pc_expire" value="'+esc(cred.token_expire||'')+'" placeholder="如 2026-10-01 12:00"></div>' +
      '<button class="btn btn-primary" data-act="saveCred">保存凭证</button></div>' +
      '<div class="card"><h3>店铺映射</h3>' +
      '<p class="hint">将淘宝店铺 ID 对应到 ERP 门店，订单才能落到正确的库存。</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
      '<div class="field"><label class="fld">淘宝店铺 ID</label><input class="in" id="ps_shopid" placeholder="平台店铺ID"></div>' +
      '<div class="field"><label class="fld">店铺名称</label><input class="in" id="ps_shopname" placeholder="便于辨识"></div>' +
      '<div class="field"><label class="fld">对应 ERP 门店</label><select class="in" id="ps_store">'+storeOpts+'</select></div>' +
      '<button class="btn btn-primary" data-act="addShop">添加映射</button></div>' +
      '<table class="tbl"><thead><tr><th>淘宝店铺</th><th>ERP 门店</th><th></th></tr></thead><tbody>'+shopRows+'</tbody></table></div>' +
      '<div class="card"><h3>商品映射</h3>' +
      '<p class="hint">将淘宝商品 / SKU 对应到 ERP 商品、温度、杯型（加料默认空）。自动出库时按此还原配方并扣库存。</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
      '<div class="field"><label class="fld">淘宝商品 ID</label><input class="in" id="pi_itemid" placeholder="平台商品ID"></div>' +
      '<div class="field"><label class="fld">SKU</label><input class="in" id="pi_sku" placeholder="可选"></div>' +
      '<div class="field"><label class="fld">商品标题</label><input class="in" id="pi_title" placeholder="便于辨识"></div>' +
      '<div class="field"><label class="fld">ERP 商品</label><select class="in" id="pi_pid">'+prodOpts+'</select></div>' +
      '<div class="field"><label class="fld">温度</label><select class="in" id="pi_temp"><option value="hot">热</option><option value="ice">冰</option><option value="less">少冰</option><option value="noice">去冰</option></select></div>' +
      '<div class="field"><label class="fld">杯型</label><select class="in" id="pi_size"><option value="M">M</option><option value="L">L</option></select></div>' +
      '<button class="btn btn-primary" data-act="addItem">添加映射</button></div>' +
      '<table class="tbl"><thead><tr><th>淘宝商品</th><th>ERP 商品 / 规格</th><th></th></tr></thead><tbody>'+itemRows+'</tbody></table></div>' +
      '<div class="card"><h3>数据同步</h3>' +
      '<p class="hint">Webhook 地址（填到淘宝开放平台消息推送）：<code>'+location.origin+'/api/tb-callback</code></p>' +
      '<button class="btn" data-act="pullOrders">立即拉取对账（待接入订单样本后生效）</button></div>';
  }
  async function loadPlatform() {
    try {
      var cred = await apiPost('platform-cred', { op: 'get' });
      var shops = await apiPost('platform-shops', { op: 'list' });
      var items = await apiPost('platform-items', { op: 'list' });
      VIEW_STATE.platform = { cred: (cred && cred.cred) || {}, shops: (shops && shops.rows) || [], items: (items && items.rows) || [] };
    } catch(e) { VIEW_STATE.platform = { cred:{}, shops:[], items:[] }; }
  }
  async function saveCred() {
    var d = await apiPost('platform-cred', { op:'save', app_key:val('pc_appkey'), app_secret:val('pc_appsecret'), access_token:val('pc_token'), refresh_token:val('pc_refresh'), token_expire:val('pc_expire') });
    if (d && d.ok) { toast('凭证已保存'); await loadPlatform(); render(); }
    else if (d && d.error) toast(d.error);
  }
  async function addShop() {
    var shopId = (val('ps_shopid')||'').trim(); if(!shopId){ toast('请填写淘宝店铺 ID'); return; }
    var d = await apiPost('platform-shops', { op:'add', platform_shop_id:shopId, platform_shop_name:(val('ps_shopname')||'').trim(), store_id:val('ps_store') });
    if (d && d.ok) { toast('已添加'); await loadPlatform(); render(); }
    else if (d && d.error) toast(d.error);
  }
  async function delShop(id) {
    var d = await apiPost('platform-shops', { op:'del', id:id });
    if (d && d.ok) { await loadPlatform(); render(); }
  }
  async function addItem() {
    var itemId = (val('pi_itemid')||'').trim(); if(!itemId){ toast('请填写淘宝商品 ID'); return; }
    var d = await apiPost('platform-items', { op:'add', platform_item_id:itemId, platform_sku:(val('pi_sku')||'').trim(), platform_title:(val('pi_title')||'').trim(), pid:val('pi_pid'), temp:val('pi_temp'), size:val('pi_size') });
    if (d && d.ok) { toast('已添加'); await loadPlatform(); render(); }
    else if (d && d.error) toast(d.error);
  }
  async function delItem(id) {
    var d = await apiPost('platform-items', { op:'del', id:id });
    if (d && d.ok) { await loadPlatform(); render(); }
  }
  async function pullOrders() {
    var d = await apiPost('platform-pull', {});
    if (d) toast(d.message || (d.ok?'已触发':'失败'));
  }

  // ---------- 事件委托 ----------
  async function onClick(e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    try {
      if (act === 'login') { await doLogin(val('login_user'), val('login_pass')); }
      else if (act === 'logout') { logout(); }
      else if (act === 'nav') { VIEW = el.getAttribute('data-view'); if (VIEW === 'notify') { await loadNotifySettings(); } render(); }
      else if (act === 'module') { goModule(el.getAttribute('data-mod')); }
      else if (act === 'closeModal') { closeModal(); }
      else if (act === 'saveSale') { await saveSale(); }
      else if (act === 'addCartRow') { await addCartRow(); }
      else if (act === 'delCartRow') { await delCartRow(parseInt(el.getAttribute('data-idx'), 10)); }
      else if (act === 'clearCart') { await clearCart(); }
      else if (act === 'voidSale') { await voidSale(el.getAttribute('data-id'), el.getAttribute('data-ord')); }
      else if (act === 'simulate') { toast('演示功能已禁用'); }
      else if (act === 'openDoc') { openDocModal(el.getAttribute('data-type')); }
      else if (act === 'openUrgentOrder') { openDocModal('req', null, null, true); }
      else if (act === 'gotoUrgent') { DOC_URGENT = true; openDocModal('req', null, null, true); }
      else if (act === 'submitDoc') { await submitDoc(el.getAttribute('data-type'), el.getAttribute('data-id')); }
      else if (act === 'saveDraft') { await saveDraftDoc(el.getAttribute('data-type'), el.getAttribute('data-id')); }
      else if (act === 'docLoadMore') { await docLoadMore(); }
      else if (act === 'confirmSubmitDoc') { await doSubmitDoc(el.getAttribute('data-type'), pendingDocItems, false, el.getAttribute('data-id')); }
      else if (act === 'backToFill') { openDocModal(el.getAttribute('data-type'), { items: pendingDocItems || [] }); }
      else if (act === 'editDraft') { var dId = el.getAttribute('data-id'); openDocModal(el.getAttribute('data-type'), byId(DB.docs, dId)); }
      else if (act === 'submitDraft') { var sdId = el.getAttribute('data-id'); var sd = byId(DB.docs, sdId); if (sd) await doSubmitDoc(sd.type, sd.items, false, sdId); }
      else if (act === 'viewStk') { openStkModal(el.getAttribute('data-id')); }
      else if (act === 'viewDoc') { openDocDetail(el.getAttribute('data-id')); }
      else if (act === 'openAlloc') { openAllocModal(el.getAttribute('data-req')); }
      else if (act === 'submitAlloc') { await submitAlloc(el.getAttribute('data-req')); }
      else if (act === 'openReco') { openRecoModal(); }
      else if (act === 'submitReco') { await submitReco(); }
      else if (act === 'recoTab') { VIEW_STATE.reco = VIEW_STATE.reco || {}; VIEW_STATE.reco.store = el.getAttribute('data-store'); render(); }
      else if (act === 'submitRecoStore') { await submitRecoForStore(el.getAttribute('data-store')); }
      else if (act === 'submitRecoRow') { await submitRecoRow(el.getAttribute('data-store'), parseInt(el.getAttribute('data-idx'), 10)); }
      else if (act === 'approve') { await doApprove(el.getAttribute('data-id'), 'approve'); }
      else if (act === 'reject') { await doApprove(el.getAttribute('data-id'), 'reject', window.prompt('驳回原因（可选）')); }
      else if (act === 'rejectDiff') { await doApprove(el.getAttribute('data-id'), 'reject', window.prompt('驳回原因（可选）')); }
      else if (act === 'downloadAllocDetail') { await downloadAllocDetail(); }
      else if (act === 'confirmAlloc') { openConfirmAllocModal(el.getAttribute('data-id')); }
      else if (act === 'openConfirmAlloc') { openConfirmAllocModal(el.getAttribute('data-id')); }
      else if (act === 'doConfirmAlloc') { await doConfirmAlloc(el.getAttribute('data-id')); }
      else if (act === 'reviseAlloc') { openReviseAllocModal(el.getAttribute('data-id')); }
      else if (act === 'doReviseAlloc') { await doReviseAlloc(el.getAttribute('data-id')); }
      else if (act === 'cancelAlloc') { await doCancelAlloc(el.getAttribute('data-id')); }
      else if (act === 'withdrawDoc') { await doWithdrawDoc(el.getAttribute('data-id')); }
      else if (act === 'delDoc') { await delDoc(el.getAttribute('data-id')); }
      else if (act === 'resolveDiff') { await doResolveDiff(el.getAttribute('data-id')); }
      else if (act === 'docFilter') { hqDocFilter = el.getAttribute('data-val') || 'all'; render(); }
      else if (act === 'quickAddMat') { openQuickAddMat(); }
      else if (act === 'doQuickAddMat') { await doQuickAddMat(); }
      else if (act === 'backToOrder') { openDocModal('req', null, HQ_KEEP); }
      else if (act === 'genReco') { await apiPost('reco', { op: 'gen' }); await refresh(); render(); toast('已生成推荐'); }
      // 总部视图动作（第 2 步补充）
      else if (act === 'saveMaterial') { await saveMaterial(); }
      else if (act === 'delMaterial') { await delMaterial(el.getAttribute('data-id')); }
      else if (act === 'editMaterial') { openMaterialModal(el.getAttribute('data-id')); }
      else if (act === 'newMaterial') { openMaterialModal(null); }
      else if (act === 'saveStore') { await saveStore(); }
      else if (act === 'newStore') { openStoreModal(); }
      else if (act === 'renameStore') { openStoreModal(el.getAttribute('data-id')); }
      else if (act === 'toggleStore') { await toggleStore(el.getAttribute('data-id')); }
      else if (act === 'userCenter') { openUserCenter(); }
      else if (act === 'savePhone') { await savePhone(); }
      else if (act === 'saveNotify') { await saveNotify(); }
      else if (act === 'testNotify') { await testNotify(); }
      else if (act === 'saveCred') { await saveCred(); }
      else if (act === 'addShop') { await addShop(); }
      else if (act === 'delShop') { await delShop(el.getAttribute('data-id')); }
      else if (act === 'addItem') { await addItem(); }
      else if (act === 'delItem') { await delItem(el.getAttribute('data-id')); }
      else if (act === 'pullOrders') { await pullOrders(); }
      else if (act === 'changePwd') { openChangePwdModal(); }
      else if (act === 'savePwd') { await changePwd(); }
      else if (act === 'resetPwd') { await resetPwd(el.getAttribute('data-id')); }
      else if (act === 'saveProduct') { await saveProduct(); }
      else if (act === 'newProduct') { openProductModal(null); }
      else if (act === 'renameProduct') { openProductModal(el.getAttribute('data-id')); }
      else if (act === 'delProduct') { await delProduct(el.getAttribute('data-id')); }
      else if (act === 'editBom') { openBomModal(el.getAttribute('data-id')); }
      else if (act === 'saveBom') { await saveBom(); }
      else if (act === 'saveAddon') { await saveAddon(); }
      else if (act === 'newAddon') { openAddonModal(null); }
      else if (act === 'editAddon') { openAddonModal(el.getAttribute('data-id')); }
      else if (act === 'delAddon') { await delAddon(el.getAttribute('data-id')); }
      else if (act === 'summaryRange') { await loadSummary(); }
      else if (act === 'downloadSummary') { downloadSummary(); }
      else if (act === 'settlementMonth') { await loadSettlement(); }
      else if (act === 'downloadSettlement') { downloadSettlement(); }
    } catch (err) { toast(err.message || '操作失败', 6000); } // 错误提示停留 6 秒：提交失败被拦时（如最低订购量），店长有足够时间看清原因
  }
  function onChange(e) {
    var el = e.target;
    if (el.id === 'inv_store') { VIEW_STATE.inventory = VIEW_STATE.inventory || {}; VIEW_STATE.inventory.store = el.value; render(); return; }
    // 销售分析：切换统计截止日期后自动重算近 7 天数据
    if (el.id === 'sa_end') { VIEW_STATE.sa = { end: el.value || todayStr() }; render(); return; }
    // 购物车：商品/温度切换时刷新可用杯型（L 杯仅在配置了对应配方时显示）
    if (el.id === 'cart_pid' || el.id === 'cart_temp') {
      var sizeSel = document.getElementById('cart_size');
      if (sizeSel) sizeSel.innerHTML = sizeOptionsHTML(val('cart_pid'), val('cart_temp'));
    }
  }

  // input 事件委托：IIFE 内的函数无法被内联 oninput 全局调用，统一在此派发
  function onInput(e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    // 订货单数量输入框（id 形如 doc_xxx）：实时重算本单合计
    if (t.id && t.id.indexOf('doc_') === 0) { if (DOC_MODAL_TYPE === 'req') calcDocTotal(); return; }
    // 物料编辑弹层：采购总价/规格/最低量变化时刷新“自动核算单价”预览
    if (t.id === 'mat_unit' || t.id === 'mat_pack_price' || t.id === 'mat_pack_qty' || t.id === 'mat_min') { matUnitPreview(); }
  }

  // ---------- 启动 ----------
  async function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    // 任意点击/触摸/按键都视为「用户操作」，重置空闲计时（避免手机停留空耗配额）
    document.addEventListener('pointerdown', markActivity);
    document.addEventListener('keydown', markActivity);
    // 页面从后台切回可见时：仅当近期有过操作才立即探测；空闲超时才不主动拉，等用户操作再触发
    document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - lastActivity <= IDLE_STOP_MS) backgroundSync(); });
    document.addEventListener('dragstart', onMatDragStart);
    setInterval(backgroundSync, AUTO_SYNC_MS); // 登录态每 60 秒后台同步一次，及时反映总部审核结果
    document.addEventListener('dragover', onMatDragOver);
    document.addEventListener('drop', onMatDrop);
    document.addEventListener('dragend', onMatDragEnd);
    if (TOKEN) {
      try { await refresh(); VIEW = defaultView(); render(); maybeOpenDocFromUrl(); return; }
      catch (e) { TOKEN = ''; localStorage.removeItem('erp_token'); }
    }
    render();
  }
  init();
})();

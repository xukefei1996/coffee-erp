# 咖啡店进销存工作台

一套覆盖「销售出库 → 库存 → 订货/配货/盘点/退货 → 审批 → 智能推荐 → 总部总览/结算」的咖啡店进销存系统。

三种运行方式（前端界面完全一致）：

- **方式零（最省事，推荐先试）**：`public/standalone.html`，**双击即用**，零依赖、无需 Node、无需联网。
- **方式一**：本地 Node 服务 + 本地 SQLite（`server.js`），适合想用真实服务后端的同学。
- **方式二**：Cloudflare Pages + D1（生产部署，多人访问）。

---

## 方式零：离线单文件版（双击即用）

直接用浏览器打开 **`coffee-erp/public/standalone.html`**（双击文件即可，或拖进浏览器窗口）。

- 数据存在浏览器 `localStorage`，刷新不丢；清空浏览器该站点数据即恢复演示初始状态。
- 后台逻辑（登录/RBAC/销售扣库存/单据审批/智能推荐/汇总/结算）全部在浏览器内运行，拦截 `/api/*` 请求，**无需任何服务器**。

打开后登录账号（见下方「初始账号 / 密码」）。

> 兼容性提示：极少数浏览器会限制 `file://` 下的 `localStorage`（表现为刷新后数据丢失或登录态不保持）。若遇到，改用方式一，或用一行命令起个静态服务：
> ```bash
> cd coffee-erp/public && python -m http.server 8000
> # 浏览器打开 http://localhost:8000/standalone.html
> ```
> 调试时可在浏览器控制台执行 `window.__erpReset()` 一键清空本地数据回到初始演示状态。

---

## 方式一：本地 Node 服务（真实后端）

环境：Node.js 22+（用到内置 `node:sqlite`）。

```bash
cd coffee-erp
node server.js
```

打开 http://localhost:8787 登录。首次启动自动建表并写入演示数据（`local.db`）。
清空重来：`rm -f local.db local.db-wal local.db-shm` 后重跑。

> 若你的 Node < 22，`node:sqlite` 不可用会导致启动报错；此时请用「方式零」或升级 Node。

---

## 初始账号 / 密码（三种方式通用，密码均为 `123456`）

| 角色 | 账号 | 说明 |
|------|------|------|
| 总部管理员 | `hq` | 全门店数据、商品/物料/门店维护、总部总览、结算单、生成推荐订货 |
| 北京国贸店·店长 | `s1mgr` | 本店销售/建单/审批/确认收货/提交推荐 |
| 北京国贸店·店员 | `s1clerk` | 本店销售出库、建单（需店长审） |
| 门店 2~6 店长 | `s2mgr` … `s6mgr` | 同 s1mgr |
| 门店 2~6 店员 | `s2clerk` … `s6clerk` | 同 s1clerk |

新增门店自动建 `«id»mgr` / `«id»clerk` 账号，密码默认 `123456`。

---

## 功能一览

- **销售出库**：商品（冷热×杯型）+ 加料 + 渠道 + 数量 + 金额，按 BOM 自动扣库存。
- **模拟渠道同步**：一键生成 14~21 笔各渠道随机销售并自动出库（演示第三方渠道自动接单）。
- **四类单据**：订货单 / 盘点单 / 退货单（门店建）+ 配货单（总部下发）。
- **两级审批流**：店长 → 总部；盘点过审校准库存、退货过审扣库存、配货单门店确认入库。
- **智能推荐订货**：「近 14 天消耗 × 8 天 − 库存 − 在途」估算建议量（总部一键生成、门店据推荐提交）。
- **总部总览**：各门店订货单提交/审核、盘点、退货申请情况。
- **销售汇总**：按渠道 / 门店 / 天聚合，支持日期范围与 CSV 下载。
- **结算单**：按门店 × 月汇总配货单金额，支持 CSV 下载。
- **基础资料**：商品与配方（BOM）、物料、门店（新增/改名/停用，停用保留历史）、加料。

---

## 方式二：生产部署（Cloudflare Pages + D1）

```bash
npm install -g wrangler && wrangler login
wrangler d1 create coffee-erp          # 把返回的 database_id 填进 wrangler.toml
wrangler d1 execute coffee-erp --remote --file=./migrations/0001_init.sql
wrangler d1 execute coffee-erp --remote --file=./migrations/0002_seed.sql
wrangler pages deploy public
```

---

## 目录结构

```
coffee-erp/
├─ public/
│  ├─ standalone.html     # 方式零：离线单文件版（双击即用）
│  ├─ index.html          # 方式一/二 的入口（由 server.js 或 Cloudflare 托管）
│  ├─ app.js              # 前端单页应用（三种方式共用）
│  ├─ styles.css          # 样式（PANTONE 378 C）
│  └─ local-backend.js    # 方式零：浏览器内后端（拦截 /api/*，localStorage 持久化）
├─ server.js              # 方式一：本地 Node 服务
├─ package.json           # npm start -> node server.js
├─ functions/api/         # 方式二：Cloudflare Pages Functions 后端（逻辑与 server.js 一致）
├─ migrations/            # 0001_init.sql 建表 / 0002_seed.sql 演示数据
├─ wrangler.toml          # Cloudflare 配置
├─ seed.json / gen_seed_json.py   # 演示数据（方式零的内嵌种子由此生成）
└─ README.md
```

## 安全说明

演示账号密码为明文存储。生产环境建议改为 bcrypt/哈希，并为 `/api/*` 加 HTTPS 与速率限制。

---

## 🌐 已上线（Cloudflare 全球节点）

部署完成的线上地址：

- **生产域名：https://coffee-erp-8cv.pages.dev**
- 数据落在 Cloudflare D1 数据库 `coffee-erp`（多门店数据真正隔离，非前端隐藏）

门店用各自账号登录该网址即可正式使用；总部用 `hq` 账号查看全量数据与总览看板。

### 初始账号 / 密码（密码全部 `123456`）

| 角色 | 账号 | 权限 |
|------|------|------|
| 总部管理员 | `hq` | 全门店数据、商品/物料/门店维护、总部总览、结算单、生成推荐订货 |
| 门店 1~6 店长 | `s1mgr` … `s6mgr` | 本店销售/建单/审批/确认收货/提交推荐 |
| 门店 1~6 店员 | `s1clerk` … `s6clerk` | 本店销售出库、建单（需店长审） |

新增门店会自动建 `«id»mgr` / `«id»clerk` 两个账号，密码同样 `123456`。

### 再部署 / 更新

```bash
export CLOUDFLARE_API_TOKEN="<你的Token>"
export CLOUDFLARE_ACCOUNT_ID="<你的account_id>"
node deploy.mjs          # 已建库则跳过建库，直接重跑建表+种子+部署
```

### 重置演示数据

```bash
wrangler d1 execute coffee-erp --remote --command="DELETE FROM docs; DELETE FROM inventory; DELETE FROM recos; DELETE FROM sales; DELETE FROM boms; DELETE FROM addons; DELETE FROM products; DELETE FROM materials; DELETE FROM users; DELETE FROM stores; DELETE FROM sessions;"
wrangler d1 execute coffee-erp --remote --file=./migrations/0001_init.sql
wrangler d1 execute coffee-erp --remote --file=./migrations/0002_seed.sql
wrangler pages deploy public --project-name coffee-erp
```

> 注：`deploy.mjs` 首次运行会创建 D1 并把 `database_id` 写回 `wrangler.toml`；之后重跑只重建表与部署。

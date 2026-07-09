# OpenPAYME 支付网关 — 项目现状说明

> 最后更新：2026-07-09 09:42
> 负责人：臣哥 + 黄豆（AI助手）
> **⚠️ 本文档随时更新，切换模型/新会话时先读此文件**

---

## 一、项目概况

- **项目名称**：OpenPAYME（原 BEpusdt → OpenUSDT，已二次更名；GitHub: https://github.com/constlee0839-ops/OpenPAYME/）
- **目标**：全免费部署多链USDT/USDC支付网关，兼容BEpusdt API格式
- **架构**：AWS Lambda + Turso + Cloudflare Pages
- **项目目录**：`D:\WORKBUDDY\2026-07-07-22-10-20\bepusdt-lambda\`

---

## 二、部署状态

| 服务 | 地址 | 状态 |
|------|------|:----:|
| API Gateway | `https://k00ytcrlnb.execute-api.ap-east-1.amazonaws.com` | ✅ |
| CF Pages | `https://pay.u222.eu.org`（绑定了自定义域名） | ✅ |
| 管理后台 | `https://pay.u222.eu.org/admin/login.html` | ✅ |
| 收银台 | `https://pay.u222.eu.org/checkout-counter.html?trade_id=xxx` | ✅ |
| 数据库 | Turso（4张表） | ✅ |

---

## 三、管理后台账号

- 用户名：`admin`
- 密码：`18681221981`（臣哥已修改过）

---

## 四、数据库钱包配置

| ID | 名称 | trade_type | 网络 | 地址 | 状态 |
|----|------|-----------|------|------|:----:|
| 1 | USDT-BEP20 | usdt.bep20 | BSC | 0xe6d587ed...a48483 | ✅ |
| 2 | TRON-TRX | tron.trx | TRON | TG3qttvkTZ...kscN1y | ✅ |
| 3 | USDC-Polygon | usdc.polygon | Polygon | 0x71910494...Da3b | ✅ |
| 4 | USDT-TRC20 | usdt.trc20 | TRON | TG3qttvkTZ...kscN1y | ✅ |
| 5 | USDC-ERC20 | usdc.erc20 | Ethereum | 0xe6d587ed...a48483 | ✅ |
| 10 | USDT-Polygon | usdt.polygon | Polygon | 0x71910494...Da3b | ✅（新增）|

**注意**：TRON网络有2种币（TRX和USDT-TRC20）。**此前误报的 asdf 占位钱包脏数据不存在**——6条钱包全部是真实有效地址。之前记忆中的重复行可能是旧 bug 已被系统自动纠正。

---

## 五、已实现的功能

### 后端API（全部已部署）
- ✅ 8个BEpusdt兼容接口（create-transaction, create-order, cancel-transaction, pay/methods, pay/update-order, pay/info, pay/notify, order/query）
- ✅ 健康检查 /health
- ✅ 手动补单 /api/v1/order/manual-confirm
- ✅ 15个管理后台API（登录/登出/钱包CRUD/订单管理/统计/汇率监控/设置等）
- ✅ MD5签名验证（BEpusdt兼容）
- ✅ 回调通知（已修复：表单格式 + 签名 + 状态同步）
- ✅ 飞书通知（**Webhook 群机器人**，后台可配→config表优先，env fallback。触发：收款成功💰/补单📝）
- ✅ **汇率监控（4h服务端缓存）**：`getMonitoredRate(force)` — config.rate_monitor(JSON) 缓存，超4小时或 force 才重新拉取 CoinGecko/er-api。dashboard 接口返回 rate.usdt_cny/usdc_cny/trx_cny。支持 `refresh_rate` 强制刷新
- ✅ **getDashboardStats()**：总数/今日/成功/待付/失败/过期/确认中/按币种(trade_type)分布/近7天趋势

### 前端页面
- ✅ 收银台（两步式：选择支付方式 → 显示二维码，已美化：卡片式网络选择+币种筹码+过渡动画+QR视觉升级）
- ✅ 管理后台首页（**增强版**：确认中指标卡+按币种分布横向条+7天CSS柱状图+**汇率监控卡**(USDT/USDC/TRX→CNY)+刷新按钮）
- ✅ 钱包管理页（增删改查+下拉选择交易类型）
- ✅ 订单管理页（列表+筛选+详情+补单+删除+批量删除+**导出CSV**+统一通知弹窗）
- ✅ 基本设置页（API Token/汇率/密码/**飞书Webhook+Secret可视化配置**）
- ✅ **移动端响应式后台**：改为 ☰ 汉堡抽屉菜单（左上角按钮滑入侧边栏，点遮罩/菜单项关闭），取代原先"移动端隐藏侧边栏导致菜单消失"的设计
- ✅ **统一通知弹窗**（`src/shared/notify.js`，IIFE）：顶部居中、带✓/✕/ℹ/!图标、可堆叠多条、2.8s自动消失、`pointer-events:none`永不遮挡按钮。5个后台页+收银台统一调用（`Notify.success/error/info/warn`或兼容`showToast`），消除之前两套重复toast
- ✅ **收银台logo居中**：`.topbar` 改 `justify-content:center`，品牌整体居中，状态徽章绝对定位右上角
- ✅ **速度优化**：`_headers` 设静态资产1年长缓存(`immutable`)；checkout页 `<head>` preconnect/dns-prefetch API域名 + preload关键图标；admin页动态preconnect
- ✅ **收银台美化**：下拉框→卡片式网络选择(网格布局+悬停高亮上浮)+币种筹码pill按钮+ fade-in/slide-up过渡动画+QR卡加大阴影+步骤步骤编号绿色底色+文案精简

### 核心逻辑
- ✅ 链上扫描（BSC USDT/Polygon USDC/Ethereum USDC/TRON TRX+USDT—多链代码已提交部署）
- ✅ 汇率获取（CoinGecko + er-api，60s内存缓存，method与update-order共用同一份价防错账）
- ✅ 回调指数退避重试（POST表单格式，兼容BEpusdt/edgeKey `$_POST` 验签）
- ✅ 过期订单自动关闭
- ✅ 支付方式从数据库动态读取（不再硬编码）
- ✅ **订单时间时区正确**：UTC解析 + 浏览器本地时区显示
- ✅ **补单后商城回调状态同步**：`handleAdminConfirm` 用更新后订单发回调（status=2），商城正常收货发货

---

## 六、问题跟踪

### ✅ 已解决（修复记录）

#### 第一批（2026-07-08）
1. **手机端后台菜单看不见** — 移动端原 `@media` 把 `.sidebar{display:none}` 且无替代入口，登录后菜单整个消失。改为 ☰ 汉堡抽屉菜单（左上角按钮滑入侧边栏，点遮罩/菜单项关闭）。✅ 2026-07-08 部署
2. **订单批量删除第二次失效** — 原手动计数器 + 按钮状态残留导致"第一次成、第二次点不动"。重写为全局锁 `_batchDeleting` + `Promise.all` 统一收尾 + 删除期间禁用所有勾选框。✅ 2026-07-08 部署（曾因 wrangler 本地缓存导致改了没生效，已清 `.wrangler/tmp` 重传）
3. **钱包管理新增第二次卡死** — `saveWallet` 加 `.finally()` 兜底，无论成功/失败/异常都恢复保存按钮可点。✅ 加固部署
4. **管理后台慢 / 旧代码不更新** — 根因是桌面浏览器缓存了旧版 admin 资源（连带旧 bug 的 orders.html），并非后端慢（后端订单列表仅 2 条 SQL、连接复用）。已加 `<link rel="preconnect">` 到 API + 4 分钟 /health 保活 ping + 清缓存强制重传。✅ 2026-07-08。注：到 ap-east-1(香港) 的网络延迟 + Lambda 冷启动属免费方案固有限制，桌面端硬刷新后正常
5. **回调签名bug** — 手动补单现在正确传递 apiToken。✅ 已修复

#### 第二批（2026-07-09 凌晨 ~ 04:30）
6. **收银台跳过选择步骤** — create-order 模式现在先显示"选择支付方式"(Step1)，再显示二维码(Step2)。收银台前端 `checkout-counter.html` 已实现 `reselect` 逻辑：`orderData.reselect` 为真则展示选择页。✅ 2026-07-08 前端部署
7. **收银台 Step2 倒计时** — Step2(扫码/复制转账)现已带"剩余时间"倒计时盒，并在渲染后调用 `startCountdown()`。✅ 部署上线
8. **收银台倒计时格式** — 由 HH:MM:SS 改为 MM:SS（`updateCountdown` 用 `totalMins:ss`）。✅ 部署上线
9. **多链扫描缺失** — 代码提交 + Lambda 打包上传（src/lib/chain.js 多链扫描器），已上线 bepusdt-api 与 scan-busdt-block。✅ 2026-07-09
10. **pay/methods 字段修复** — network 大写映射 + token_net_name + currency/network 字段正确。✅ 2026-07-09 部署
11. **scanTransactions.js 崩溃炸弹（隐藏严重 bug）** — 引用不存在的 confirmOrder + 旧 schema。已重写复用现 schema + sendNotify。✅ 部署
12. **update-order 返回 token 为空** — 钱包匹配写反：currency→trade_type 反向比对永远对不上。修复：复用 COIN_BY_TRADETYPE + NET_NORMALIZE。✅ 已部署 Lambda
13. **多币汇率一致性 + 防错账** — 加 60s 内存缓存，methods 与 update-order 共用同一份价。✅ 已部署
14. **后台订单批量删除"丢失"** — 未提交 git 的 wrangler 直传改动被覆盖。重新实现并提交 git。✅ 已部署
15. **批量删除"选择状态不同步"** — renderOrders 重渲染清勾选。修复：读 DOM `.row-check:checked` 替代全局状态。✅ 已部署
16. **飞书通知上线** — Webhook 群机器人（臣哥已取消签名校验）→ 自建应用 fallback。✅ 2026-07-09
17. **订单时间时区显示错误** — UTC 存为字符串→浏览器当本地时区。修复：`formatDate` 明确按 UTC 解析。✅ 已部署
18. **补单后商城无回调记录** — 两个根因：① callback JSON body 商城读 `$_POST` 空；② handleAdminConfirm 用更新前 status=1 订单发回调。修复：sendNotify 用表单格式 + 改用更新后订单。✅ 已部署 Lambda

#### 第三批（2026-07-09 上午 ~ 09:42）
19. **后台批量删除按钮被绿色"删除成功"toast遮挡** — toast 定位 `top:20px;right:20px` 无 `pointer-events:none`，浮在右上角"批量删除"按钮上方3秒拦截点击。修复：移到底部居中`bottom:24px;left:50%`+`pointer-events:none`。同步修了复选框状态不同步（renderOrders 重渲染不带 checked，补单后勾选消失）。✅ 已部署，已验证线上生效
20. **TRON 网络显示两个（CHAIN_MAP 被旧 git 版覆盖丢失）** — 之前 TRON 合并 CHAIN_MAP 经 wrangler 直传部署但未 git commit，后续基于旧 git 版的 commit 覆盖了。修复：重新实现 CHAIN_MAP 按链分组+统一 summary/step2 网络显示。✅ commit cfffb8e，已部署
21. **数据汇总首页增强 + 汇率监控(4h缓存)** — index.html 新增确认中卡/按币种分布/7天CSS柱状图/汇率监控卡(USDT/USDC/TRX→CNY+刷新按钮)。后端 getMonitoredRate(force) 每4h才重新拉取。✅ commit 524925c，已部署
22. **统一通知弹窗+收银台logo居中+代码清理+导出CSV** — shared/notify.js 统一通知；收银台logo居中；删 src/createOrder/queryOrder/scanTransactions.js 等372行孤儿代码；订单页导出CSV。✅ commit 37b412f，已部署
23. **通知设置可视化** — 飞书 Webhook/Secret 可在 settings 页配置，feishu.js 优先读 config 表再 fallback env。✅ commit 0b324e9，已部署
24. **收银台美化** — 卡片式网络选择+币种筹码pill按钮+过渡动画+QR视觉升级。✅ commit b92008f，已部署
25. **GitHub历史密钥清除+强推恢复** — git-filter-repo 清除三处密钥(AWS key/Cloudflare token/Turso JWT)并强推成功；gitignore 防御(backups/*.cjs等含密脚本不再误提交)；Turso token 迁 Lambda 环境变量(仓库/历史均无明文)。✅ 已验证：push 可用，GitHub 无密码

### ⚠️ 关键部署坑（2026-07-09 踩到，务必记牢）
- **本 Pages 项目是 git 关联的**（origin=github.com/constlee0839-ops/OpenPAYME，分支 main）。`wrangler pages deploy public` 对未提交改动会"Uploaded 0 files（按 git 态比对）"——**本地改了不提交，部署不生效！** 必须 `git commit` 后再 `wrangler pages deploy`。⚠️ **关键教训**：TRON 合并的 CHAIN_MAP 第一次只 wrangler 部署没 git commit，后续 commit 基于旧版 git 覆盖了修复。
- **✅ GitHub push 已恢复**（2026-07-09）。新 token(`ghp_L605vp...`) 已验证可 push，密钥已用 git-filter-repo 从历史清除并强推成功。gitignore 已加固（backups/、*.cjs、含密脚本不会误提交）。
- **线上验证必须 `curl -L` 跟随 308 重定向**：`pay.u222.eu.org` 对带 `?query` 的 URL 返回 308 重定向到干净 URL，不跟重定向会拿到空内容误判"改动没生效"。环境设了 HTTPS_PROXY，curl 可能命中代理缓存，验证时加 `-H "Cache-Control: no-cache"`。
- **Lambda 打包（关键！必须 WSL）**：项目在 Windows 开发，`node_modules/@libsql/` 混有 `win32-x64-msvc` 二进制。直接 zip 上传 Linux Lambda 会崩溃（cannot find module / invalid ELF）。**正确方式**：WSL(Ubuntu-24.04) + Linux node（`export npm_config_platform=linux npm_config_cpu=x64`）重装依赖 → `npm install --production` → 确认无 win32 → python zipfile 打包 → `aws lambda update-function-code`。两个函数(bepusdt-api / scan-busdt-block)共用同一份 zip，handler 不同（api.handler / scan.handler）。
- **TURSO_TOKEN 环境变量**：bepusdt-api + scan-busdt-block 均已设 `TURSO_TOKEN`（值仅在 Lambda env / AWS 账户，不在仓库）；db.js 已改读 `process.env.TURSO_TOKEN`，仓库无明文。

---

## 七、商城对接信息

- **商城系统**：edgeKey（github.com/34892002/edgeKey）
- **支付网关地址**：`https://k00ytcrlnb.execute-api.ap-east-1.amazonaws.com`
- **接口模式**：收银台模式（create-order）
- **App ID**：bepusdt_f2278084fda2ea91c4a25d88
- **回调地址**：`/api/payments/bepusdt/notify`
- **回调格式**：POST 表单（`application/x-www-form-urlencoded`，字段 trade_id/order_id/amount/actual_amount/token/block_transaction_id/status/signature），必须返回"success"字符串
- **签名算法**：MD5(排序后 key=value 串 + apiToken)

---

## 八、下一步计划（按优先级）

1. ~~**实现多链扫描**（高优先级，影响收款正确性）~~ → ✅ **已完成（2026-07-09）**：多链扫描代码已提交（52cdb59）并部署 Lambda 上线
2. ~~**git commit 所有改动**~~ → ✅ 已完成，GitHub push 已恢复
3. **端到端真实验收**（持续）—— 用一个真实小额订单走完"选择→付款→自动确认→回调商城"全流程，验证各链都能闭环
4. **收银台多链配币图标**（Tron 网络内显示 TRX 和 USDT 的图标）
5. **汇率历史趋势图**（首页汇率卡下方折线图，记录每次更新的价）
6. **收银台仿原版更多功能**（网络配色图标）

---

## 九、关键凭证

| 项目 | 值 | 存哪 |
|------|-----|------|
| Turso URL | `libsql://bepusdt-const.aws-ap-northeast-1.turso.io` | 代码硬编码 ✅ |
| Turso Token | `eyJhbGci...`（完整值在 Lambda env） | **Lambda环境变量** `TURSO_TOKEN`，仓库/历史均无明文✅ |
| AWS Access Key | `AKIA3ANRH3GYZCERFMWC` | 已从git历史清除，建议在AWS控制台轮换 |
| AWS区域 | ap-east-1（香港） | — |
| API Token | `bepusdt_f2278084fda2ea91c4a25d88` | 可通过后台重置 |
| 管理后台密码 | `18681221981`（臣哥已修改） | — |
| 飞书 Webhook | Lambda env `FEISHU_WEBHOOK` 或 config 表 | **后台可配**（settings页）|
| 飞书 AppID/Secret | Lambda env `FEISHU_APP_ID/SECRET` | 自建应用 fallback |
| GitHub Token | `ghp_L605...` | git 远端 URL（本地持久化） |

---

## 十、技术栈

| 层 | 技术 |
|----|------|
| 后端 | AWS Lambda (Node.js 20.x) |
| 数据库 | Turso (SQLite云数据库) |
| 前端 | Cloudflare Pages (纯HTML/JS) |
| 链上交互 | ethers.js v6 |
| 链 | BSC / TRON / Polygon / Ethereum |

---

## 十一、参考资源

| 资源 | 地址 |
|------|------|
| BEpusdt GitHub | https://github.com/v03413/BEpusdt |
| BEpusdt trade-type | https://github.com/v03413/BEpusdt/blob/main/docs/trade-type.md |
| BEpusdt 收银台文档 | https://github.com/v03413/BEpusdt/blob/main/docs/checkout/README.md |
| edgeKey 支付文档 | https://github.com/34892002/edgeKey/blob/main/docs/pay/bepusdt/start.md |
| edgeKey BEpusdt回调 | https://github.com/34892002/edgeKey/blob/main/server/routes/payment-bepusdt.ts |

---

## 十一、原版BEpusdt功能差距分析（vs 我们的OpenPAYME）

### 支持的网络对比

| 网络 | 原版BEpusdt | OpenPAYME | 状态 |
|------|:----------:|:--------:|:----:|
| TRON | ✅ | ✅ | 已完成 |
| Ethereum | ✅ | ✅ | 已完成 |
| BSC | ✅ | ✅ | 已完成 |
| Polygon | ✅ | ✅ | 已完成 |
| Aptos | ✅ | ❌ | 待实现 |
| Solana | ✅ | ❌ | 待实现 |
| X-Layer | ✅ | ❌ | 待实现 |
| Arbitrum-One | ✅ | ❌ | 待实现 |
| Base | ✅ | ❌ | 待实现 |
| Plasma | ✅ | ❌ | 待实现 |
| Ton | ✅ | ❌ | 待实现 |

### 每个网络支持的币种对比

| 网络 | 原版支持 | OpenPAYME现状 | 缺少 |
|------|---------|-------------|------|
| TRON | USDT, USDC, TRX | USDT, TRX | USDC |
| Ethereum | USDT, USDC, ETH | USDC | USDT, ETH |
| Polygon | USDT, USDC | USDC | USDT |
| BSC | USDT, USDC, BNB | USDT | USDC, BNB |

### API功能对比

| 功能 | 原版BEpusdt | OpenPAYME | 状态 |
|------|:----------:|:--------:|:----:|
| create-transaction | ✅ | ✅ | 已完成 |
| create-order | ✅ | ✅ | 已完成 |
| cancel-transaction | ✅ | ✅ | 已完成 |
| pay/update-order | ✅ | ✅ | 已完成 |
| pay/methods | ✅ | ✅ | 已完成 |
| pay/info | ✅ | ✅ | 已完成 |
| pay/notify | ✅ | ✅ | 已完成 |
| 易支付兼容（/submit.php） | ✅ | ❌ | 待实现 |
| currencies参数 | ✅ | ❌ | 待实现 |
| reselect参数 | ✅ | ⚠️ | 需验证 |

### 管理后台功能对比

| 功能 | 原版BEpusdt | OpenPAYME | 状态 |
|------|:----------:|:--------:|:----:|
| 登录/登出 | ✅ | ✅ | 已完成 |
| 首页统计面板 | ✅ | ✅ | 已完成 |
| 钱包管理 | ✅ | ✅ | 已完成 |
| 订单管理 | ✅ | ✅ | 已完成 |
| 汇率管理 | ✅ | ❌ | 待实现 |
| 系统配置 | ✅ | ⚠️ | 部分完成 |
| Telegram通知 | ✅ | ❌ | 替换为飞书 |
| 飞书通知 | ❌ | ✅ | 已完成（自建应用 API） |
| 邮件通知 | ✅ | ❌ | 待实现（给客户推送） |
| MQTT通知 | ✅ | ❌ | 不需要 |
| 收银台模板切换 | ✅ | ❌ | 待实现 |
| 安全入口 | ✅ | ❌ | 待实现 |

### 通知方案（已确认）

| 通知对象 | 渠道 | 用途 | 状态 |
|---------|------|------|:----:|
| 管理员（臣哥） | 飞书（自建应用 API） | 收款成功/补单提醒 | ✅ 已实现（2026-07-09） |
| 客户 | 邮件（SMTP） | 支付成功通知 | 待实现 |

### 收银台功能对比

| 功能 | 原版BEpusdt | OpenPAYME | 状态 |
|------|:----------:|:--------:|:----:|
| 两步式设计 | ✅ | ✅ | 已完成 |
| 两步都有倒计时 | ✅ | ⚠️ | Step2缺失 |
| 货币/网络下拉 | ✅ | ✅ | 已完成 |
| 二维码显示 | ✅ | ✅ | 已完成 |
| 复制地址/金额 | ✅ | ✅ | 已完成 |
| 返回重选按钮 | ✅ | ⚠️ | 需验证 |
| 状态轮询 | ✅ | ✅ | 已完成 |
| 支付成功/过期弹窗 | ✅ | ✅ | 已完成 |
| 多语言支持 | ✅ | ❌ | 待实现 |
| 深色模式 | ✅ | ❌ | 待实现 |

### 核心业务逻辑对比

| 功能 | 原版BEpusdt | OpenPAYME | 状态 |
|------|:----------:|:--------:|:----:|
| 链上扫描 | ✅ | ✅ | 已完成 |
| 金额匹配 | ✅ | ✅ | 已完成 |
| 汇率浮动语法 | ✅ | ✅ | 已完成 |
| 地址独占模式 | ✅ | ✅ | 已完成 |
| 地址共享模式 | ✅ | ✅ | 已完成 |
| 金额容差匹配 | ✅ | ✅ | 已完成 |
| txHash幂等去重 | ✅ | ✅ | 已完成 |
| 订单状态流转 | ✅ | ✅ | 已完成 |
| 过期订单自动关闭 | ✅ | ✅ | 已完成 |
| 回调重试 | ✅ | ✅ | 已完成 |
| 非订单转账检测 | ✅ | ✅ | 已完成 |
| 汇率自动更新 | ✅ | ✅ | 已完成 |
| 相同order_id重建订单 | ✅ | ❌ | 待实现 |
| 金额原子精度 | ✅ | ❌ | 待实现 |
| 多法币支持 | ✅ | ❌ | 待实现 |

---

## 十二、未来功能规划（按优先级）

### P0 - 必须完成
1. 收银台Step2倒计时
2. pay/methods字段修正
3. 钱包管理新增bug

### P1 - 重要功能
4. 收银台完全仿照原版
5. 汇率管理后台
6. ~~飞书通知（管理员收款提醒）~~ → ✅ 已完成（2026-07-09）
7. 邮件通知（客户支付成功通知）

### P2 - 扩展功能
8. 更多网络（Aptos/Solana/Base/Arbitrum等）
9. 更多币种（每网络的USDC/原生代币）
10. 多语言
11. 深色模式
12. 安全入口

### P3 - 高级功能
13. 易支付兼容
14. currencies参数
15. 金额原子精度
16. 多法币支持

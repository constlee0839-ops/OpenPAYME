# OpenPAYME 支付网关 — 项目现状说明

> 最后更新：2026-07-09 03:30
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
| 3 | USDC-Polygon | usdc.polygon | Polygon | 0xe6d587ed...a48483 | ✅ |
| 4 | USDT-TRC20 | usdt.trc20 | TRON | TG3qttvkTZ...kscN1y | ✅ |
| 5 | USDC-ERC20 | usdc.erc20 | Ethereum | 0xe6d587ed...a48483 | ✅ |

**注意**：TRON网络有2种币（TRX和USDT-TRC20），不是3种。

---

## 五、已实现的功能

### 后端API（全部已部署）
- ✅ 8个BEpusdt兼容接口（create-transaction, create-order, cancel-transaction, pay/methods, pay/update-order, pay/info, pay/notify, order/query）
- ✅ 健康检查 /health
- ✅ 手动补单 /api/v1/order/manual-confirm
- ✅ 15个管理后台API（登录/登出/钱包CRUD/订单管理/统计/设置等）
- ✅ MD5签名验证（BEpusdt兼容）
- ✅ 回调通知（已修复：手动补单现在正确传递apiToken）

### 前端页面
- ✅ 收银台（两步式：选择支付方式 → 显示二维码，适配手机）
- ✅ 管理后台首页（统计面板）
- ✅ 钱包管理页（增删改查+下拉选择交易类型）
- ✅ 订单管理页（列表+筛选+详情+补单+删除+**批量删除勾选框**）
- ✅ 基本设置页（API Token/汇率/密码）
- ✅ **移动端响应式后台**：改为 ☰ 汉堡抽屉菜单（左上角按钮滑入侧边栏，点遮罩/菜单项关闭），取代原先"移动端隐藏侧边栏导致菜单消失"的设计
- ✅ **订单批量删除加固**：全局锁 `_batchDeleting` 防重复提交 + `Promise.all` 统一收尾 + 删除期间禁用所有勾选框，修复"第一次成功、第二次点不动"
- ✅ **钱包新增加固**：`saveWallet` 加 `.finally()` 兜底恢复保存按钮，修复"第一次成功、第二次卡死"
- ✅ **收银台二维码本地生成**：去掉外部第三方 `api.qrserver.com`（实测 TTFB 2 秒、且把收款地址 token 发给第三方），改用本地 `qrcode.min.js` 库浏览器端生成 data URI 二维码。消除 2 秒外部等待 + 隐私泄露 + 单点故障。保留 qrserver 作极端兜底

### 核心逻辑
- ✅ 链上扫描（BSC USDT）
- ✅ 汇率获取（Binance + CoinGecko）
- ✅ 回调指数退避重试
- ✅ 过期订单自动关闭
- ✅ 支付方式从数据库动态读取（不再硬编码）

---

## 六、问题跟踪

### ✅ 已解决（修复记录）
1. **手机端后台菜单看不见** — 移动端原 `@media` 把 `.sidebar{display:none}` 且无替代入口，登录后菜单整个消失。改为 ☰ 汉堡抽屉菜单（左上角按钮滑入侧边栏，点遮罩/菜单项关闭）。✅ 2026-07-08 部署
2. **订单批量删除第二次失效** — 原手动计数器 + 按钮状态残留导致"第一次成、第二次点不动"。重写为全局锁 `_batchDeleting` + `Promise.all` 统一收尾 + 删除期间禁用所有勾选框。✅ 2026-07-08 部署（曾因 wrangler 本地缓存导致改了没生效，已清 `.wrangler/tmp` 重传）
3. **钱包管理新增第二次卡死** — `saveWallet` 加 `.finally()` 兜底，无论成功/失败/异常都恢复保存按钮可点。✅ 加固部署
4. **管理后台慢 / 旧代码不更新** — 根因是桌面浏览器缓存了旧版 admin 资源（连带旧 bug 的 orders.html），并非后端慢（后端订单列表仅 2 条 SQL、连接复用）。已加 `<link rel="preconnect">` 到 API + 4 分钟 /health 保活 ping + 清缓存强制重传。✅ 2026-07-08。注：到 ap-east-1(香港) 的网络延迟 + Lambda 冷启动属免费方案固有限制，桌面端硬刷新后正常
5. **回调签名bug** — 手动补单现在正确传递 apiToken。✅ 已修复
6. **收银台跳过选择步骤** — create-order 模式现在先显示"选择支付方式"(Step1)，再显示二维码(Step2)。收银台前端 `checkout-counter.html` 已实现 `reselect` 逻辑：`orderData.reselect` 为真则展示选择页。✅ 2026-07-08 前端部署已上线（curl 验证：reselect 逻辑 + Step1/Step2 双步骤结构均在线上）
7. **收银台 Step2 倒计时** — Step2(扫码/复制转账)现已带"剩余时间"倒计时盒，并在渲染后调用 `startCountdown()`。✅ 2026-07-08 已上线
8. **收银台倒计时格式** — 由 HH:MM:SS 改为 MM:SS（`updateCountdown` 用 `totalMins:ss`）。✅ 2026-07-08 已上线

### 🔴 待修复（严重）
1. ~~**多链扫描缺失**~~ → ✅ **已部署（2026-07-09）**：代码提交(52cdb59)后，本次 Lambda 重新打包上传（deploy-api.zip）已含 `src/lib/chain.js` 多链扫描器 + `src/scanTransactions.js`，`aws lambda update-function-code` 已上线 bepusdt-api 与 scan-busdt-block。

### 🟡 待修复（中等）
2. ~~**pay/methods 的 currency/network 字段修复尚未上线**~~ → ✅ **已部署（2026-07-09）**：`src/api.js`(handleMethods) 的 network 大写映射 + token_net_name + currency/network 字段已随本次 Lambda 部署上线（curl 实测：USDT→BSC、TRX→TRON、USDC→Polygon，字段正确）。

### 🟢 待修复（轻微）
3. ~~**git 仓库未提交**~~ → 已全部提交。备份 tag `backup-2026-07-08` 已 push 到 GitHub（含前端+文档+DB导出）。多链代码提交 52cdb59。Turso 数据库已导出到 backups/2026-07-08/（schema.sql/data.json/restore-data.sql）。

### 🔧 本次（2026-07-09 凌晨）新增修复
4. **scanTransactions.js 崩溃炸弹（隐藏严重 bug）** — 旧版引用 db.js 中**不存在**的 `confirmOrder` 等导出，且字段用旧 schema(`orderId/walletAddress/expectedAmount/status==="PENDING"`)，而 createOrder.js:81、queryOrder.js:41 都 `require("./scanTransactions")` 并在下单/查单时触发。Lambda 冷启动 `require('./lib/db')` 一旦加载即抛错 → 拖垮整个 bepusdt-api。**已重写为正确实现**（复用现 DB schema：status=1、actual_amount、trade_type + sendNotify 回调），消除崩溃并让触发扫描真正闭环。

5. **update-order 返回 token 为空（导致"收银台二维码无法复制地址 / 前台提交不了订单"）** — 根因：`handleUpdateOrder` 的钱包匹配逻辑用 `currency.toLowerCase()` 反向比对 `trade_type` 第一段，而 TRX 钱包的 `trade_type` 是 `tron.trx`（首段为 `tron`），永远对不上 → `matched` 为 undefined → `walletAddress=""` → 返回的 `token` 为空，收银台第二步拿不到收款地址。✅ 2026-07-09 修复：复用与 `handleMethods` 同一套 `COIN_BY_TRADETYPE` 查表 + 新增 `NET_NORMALIZE` 网络双向归一化（bsc↔bep20/eth↔erc20/tron↔trc20/trx/ polygon），正确匹配各币种钱包。已部署 Lambda 并实测：update-order(TRX) 返回真实地址 `TG3qttvkTZ...kscN1y`，且金额与 pay/methods 一致。

6. **多币汇率一致性 + 防错账** — `getCryptoRates()` 增加 60s 内存缓存，让 `pay/methods` 与 `pay/update-order` 共用同一份最新价（避免两次调用 coingecko 抖动导致金额不一致）；且只有 coingecko **从未成功过**才回落写死旧值（原 `trxUsd=0.12` 在 2026 年已偏离实际 ~2.245，会少/多收）。已部署。

7. **后台订单批量删除"丢失"** — 现象：用户反馈后台批量删除勾选框消失。根因：批量删除功能在 2026-07-08 某次会话是用 **wrangler 直接传了未提交的工作区改动**上线的，**从未提交进 git**；后续从 git 源码重新部署（或本次会话部署）时，git 源码里没有批量删除 → 线上丢失。✅ 2026-07-09 已**重新实现并提交到 git**（`public/admin/orders.html`：表头全选框 + 每行勾选框 + "批量删除"按钮 + 已选计数；批量删除循环调用现有单删接口 `/api/admin/order/delete`），并重新部署上线。现已随 git 提交，后续重部署不会丢失。

### ⚠️ 关键部署坑（2026-07-09 踩到，务必记牢）
- **本 Pages 项目是 git 关联的**（origin=github.com/constlee0839-ops/OpenPAYME，分支 main）。`wrangler pages deploy public --project-name bepusdt` 对未提交改动会"Uploaded 0 files（按 git 态比对）"——**本地改了不提交，部署不生效**！必须 `git commit` 后再 `wrangler pages deploy`。
- **GitHub token 已失效**（remote URL 里的 `ghp_...` 返回 Bad credentials），无法 `git push` 触发自动生产部署。当前自定义域名 `pay.u222.eu.org` 由最新一次 `wrangler pages deploy` 的 Production 部署提供服务，因此**部署必须走"git commit + wrangler pages deploy"**，不能靠 push。
- **线上验证必须 `curl -L` 跟随 308 重定向**：`pay.u222.eu.org` 对带 `?query` 的 URL 返回 308 重定向到干净 URL，不跟重定向会拿到空内容误判"改动没生效"。且环境设了 HTTPS_PROXY，curl 可能命中代理缓存，验证时加 `-H "Cache-Control: no-cache"` 或用最新 preview 部署 URL 核对。
- **Lambda 打包**（Windows 无 WSL）：`npm install --production --no-save --force` 装出含 linux-x64-gnu 的完整依赖 → `rm -rf node_modules/@libsql/win32-x64-msvc` 删 win32 → 用 Python zipfile 打 `deploy-api.zip`（避开 Git Bash 无 zip 命令 + 安全策略禁删已有 zip，故输出新文件名）。再 `aws lambda update-function-code --function-name bepusdt-api --zip-file fileb://deploy-api.zip --region ap-east-1`（scan 同理）。脚本见仓库 `zipit.py`。

---

## 七、商城对接信息

- **商城系统**：edgeKey（github.com/34892002/edgeKey）
- **支付网关地址**：`https://k00ytcrlnb.execute-api.ap-east-1.amazonaws.com`
- **接口模式**：收银台模式（create-order）
- **App ID**：bepusdt_f2278084fda2ea91c4a25d88
- **回调地址**：`/api/payments/bepusdt/notify`
- **回调格式**：POST JSON，必须返回"success"字符串

---

## 八、下一步计划（按优先级）

1. **部署 Lambda 让 pay/methods 修复上线**（中优先级，代码已就绪）—— 解决部署雷区：用 Linux/Docker 环境安装依赖并打包（剔除 `@libsql/win32-x64-msvc`），再 `aws lambda update-function-code --function-name bepusdt-api --zip-file fileb://xxx.zip --region ap-east-1`。部署后 curl 验证 network 返回大写
2. **实现多链扫描**（高优先级，影响收款正确性）—— 为 TRON(TRC-20/TRX)、Polygon(USDC)、Ethereum(USDC) 各写扫描器，在 `scan.js` 里按 `trade_type` 分发到对应链；可复用现有 BSC 的"按需触发扫描"策略
3. **git commit 所有改动**（低优先级但防丢失）—— 把前端 + 后端 + 新增资源统一提交
4. **端到端真实验收**（持续）—— 用一个真实小额订单走完"选择→付款→自动确认→回调商城"全流程，验证各链都能闭环

---

## 九、关键凭证

| 项目 | 值 |
|------|-----|
| Turso URL | `libsql://bepusdt-const.aws-ap-northeast-1.turso.io` |
| Turso Token | 存在setup-db.js和db.js中 |
| AWS Access Key | `AKIA_REDACTED` |
| AWS区域 | ap-east-1（香港） |
| API Token | `bepusdt_f2278084fda2ea91c4a25d88` |
| CF API Token | `CFAT_REDACTED` |

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
| 飞书通知 | ❌ | ❌ | **新增** |
| 邮件通知 | ✅ | ❌ | 待实现（给客户推送） |
| MQTT通知 | ✅ | ❌ | 不需要 |
| 收银台模板切换 | ✅ | ❌ | 待实现 |
| 安全入口 | ✅ | ❌ | 待实现 |

### 通知方案（已确认）

| 通知对象 | 渠道 | 用途 | 状态 |
|---------|------|------|:----:|
| 管理员（臣哥） | 飞书Webhook | 收款成功/失败/异常提醒 | 待实现 |
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
6. 飞书通知（管理员收款提醒）
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

# OpenUSDT

一款基于云函数的多链 USDT/USDC 支付网关，兼容 BEpusdt API 接口格式。

## 项目简介

OpenUSDT 是一个全免费方案的加密货币收款网关，采用 AWS Lambda + Turso + Cloudflare Pages 架构，零月费运营。
 AWS Lambda：免费的AWS函数应用
 Turso：免费的数据库
 Cloudflare Pages：免费的页面存储。
 以后再也不用担心收费了！！

### 核心特性

- **多链支持**：BSC、TRON、Polygon、Ethereum
- **多币种**：USDT、USDC、TRX
- **BEpusdt 兼容**：100% 兼容 BEpusdt API 接口格式，现有商店代码无需修改
- **收银台模式**：用户可在收银台自由选择支付币种和网络
- **管理后台**：钱包管理、订单管理、系统设置
- **回调通知**：支持飞书通知（管理员）+ 邮件通知（客户）
- **全免费**：利用 AWS Lambda、Turso、Cloudflare Pages 免费额度

## 架构

```
┌──────────────────────────────────────┐
│  Cloudflare Pages（前端）              │
│  收银台页面 + 管理后台页面              │
│  纯静态，全球 CDN，无限请求             │
└──────────────┬───────────────────────┘
               │ HTTPS
┌──────────────▼───────────────────────┐
│  AWS Lambda + API Gateway（后端）      │
│  兼容 BEpusdt API 格式                 │
│  创建订单 / 查询订单 / 链上扫描 / 回调  │
└──────────────┬───────────────────────┘
               │ HTTP 直连
┌──────────────▼───────────────────────┐
│  Turso（数据库）                       │
│  SQL 语法，5GB 免费，HTTP 直连         │
└──────────────────────────────────────┘
```

## 支持的网络和币种

| 网络 | USDT | USDC | 原生代币 |
|------|------|------|---------|
| BSC | ✅ usdt.bep20 | ✅ usdc.bep20 | — |
| TRON | ✅ usdt.trc20 | — | ✅ tron.trx |
| Polygon | — | ✅ usdc.polygon | — |
| Ethereum | — | ✅ usdc.erc20 | — |

## 快速开始

### 前置条件

- AWS 账号（用于 Lambda 和 API Gateway）
- Turso 账号（数据库）
- Cloudflare 账号（前端部署）
- Node.js 20.x

### 1. 数据库初始化

```bash
cd bepusdt-lambda
npm install
node setup-db.js
```

### 2. 部署 Lambda

```bash
# 打包
npm install --production
zip -r bepusdt-lambda.zip src/ node_modules/

# 部署到 AWS Lambda
aws lambda update-function-code \
  --function-name bepusdt-api \
  --zip-file fileb://bepusdt-lambda.zip \
  --region ap-east-1
```

### 3. 部署前端

```bash
cd public
npx wrangler pages deploy . --project-name openusdt
```

### 4. 配置环境变量

在 AWS Lambda 控制台配置以下环境变量：

```
TURSO_URL=libsql://your-database.turso.io
TURSO_TOKEN=your-turso-token
BSC_RPC=https://bsc-dataseed.binance.org/
SCAN_FUNCTION_NAME=scan-busdt-block
CHECKOUT_BASE_URL=https://your-domain.com
```

## API 接口

### 对外接口（商店对接）

| 接口 | 路径 | 说明 |
|------|------|------|
| 创建交易 | `POST /api/v1/order/create-transaction` | 固定金额收款 |
| 创建订单 | `POST /api/v1/order/create-order` | 收银台模式 |
| 取消交易 | `POST /api/v1/order/cancel-transaction` | 取消订单 |
| 付款方式 | `POST /api/v1/pay/methods` | 获取可用支付方式 |
| 更新付款 | `POST /api/v1/pay/update-order` | 选择支付方式 |
| 订单信息 | `POST /api/v1/pay/info` | 查询订单状态 |
| 手动补单 | `POST /api/v1/order/manual-confirm` | 管理员确认付款 |

### 管理后台接口

| 接口 | 路径 | 说明 |
|------|------|------|
| 登录 | `POST /api/admin/login` | 管理员登录 |
| 钱包列表 | `POST /api/admin/wallet/list` | 获取所有钱包 |
| 添加钱包 | `POST /api/admin/wallet/add` | 添加新钱包 |
| 修改钱包 | `POST /api/admin/wallet/update` | 修改钱包信息 |
| 删除钱包 | `POST /api/admin/wallet/delete` | 删除钱包 |
| 订单列表 | `POST /api/admin/order/list` | 查询订单 |
| 统计面板 | `POST /api/admin/dashboard` | 首页统计数据 |

## 签名算法

所有 API 请求使用 MD5 签名验证：

1. 筛选所有非空且非 `signature` 的参数
2. 按参数名 ASCII 码字典序排序
3. 拼接为 `key1=value1&key2=value2` 格式
4. 末尾追加 API Token（无 `&` 分隔符）
5. MD5 加密，结果转小写

## 回调通知

支付成功后，系统向商户的 `notify_url` 发送 POST 请求：

```json
{
  "trade_id": "xxx",
  "order_id": "xxx",
  "amount": 100,
  "actual_amount": 13.89,
  "token": "0x...",
  "block_transaction_id": "0x...",
  "status": 2,
  "signature": "xxx"
}
```

商户必须返回字符串 `success` 表示接收成功。

## 通知方案

- **管理员通知**：飞书 Webhook（收款成功/失败/异常）
- **客户通知**：邮件 SMTP（支付成功通知）

## 开发计划

### 已完成

- [x] 核心 API 接口
- [x] 链上扫描（BSC）
- [x] 收银台页面（两步式）
- [x] 管理后台
- [x] 回调通知
- [x] 手动补单

### 进行中

- [ ] 收银台优化（倒计时、UI 完善）
- [ ] 多链扫描（TRON/Polygon/Ethereum）

### 计划中

- [ ] 汇率管理后台
- [ ] 飞书通知集成
- [ ] 邮件通知
- [ ] 更多网络支持（Aptos/Solana/Base）
- [ ] 多语言
- [ ] 深色模式

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | AWS Lambda (Node.js 20.x) |
| 数据库 | Turso (SQLite 云数据库) |
| 前端 | Cloudflare Pages (HTML/JS) |
| 链上交互 | ethers.js v6 |
| 区块链 | BSC / TRON / Polygon / Ethereum |

## 许可证

MIT License

## 致谢

- [BEpusdt](https://github.com/v03413/BEpusdt) - 项目参考
- [Turso](https://turso.tech) - 数据库服务
- [AWS Lambda](https://aws.amazon.com/lambda/) - 无服务器计算
- [Cloudflare Pages](https://pages.cloudflare.com) - 静态网站托管

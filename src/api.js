/**
 * Lambda: bepusdt-api
 * BEpusdt 兼容 API 路由
 *
 * 接口列表:
 *   POST /api/v1/order/create-transaction  创建交易
 *   POST /api/v1/order/create-order        创建订单（收银台模式）
 *   POST /api/v1/order/cancel-transaction  取消交易
 *   POST /api/v1/order/manual-confirm      手动补单（管理员）
 *   POST /api/v1/pay/update-order          更新付款方式
 *   POST /api/v1/pay/methods               付款方式列表
 *   POST /api/v1/pay/info                  付款信息
 *   POST /api/v1/pay/notify                前端通知已付款
 *   GET  /health                           健康检查
 */

const { verify } = require("./lib/signature");
const { sendNotify } = require("./lib/callback");
const db = require("./lib/db");
const { getUSDTRate } = require("./lib/chain");
const crypto = require("crypto");

// AWS Lambda SDK（Lambda 运行时内置，本地需要安装）
let lambdaClient = null;
async function getLambdaClient() {
  if (!lambdaClient) {
    const { LambdaClient } = require("@aws-sdk/client-lambda");
    lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || "ap-east-1" });
  }
  return lambdaClient;
}

/**
 * 异步触发扫描 Lambda
 */
async function triggerScan() {
  try {
    const client = await getLambdaClient();
    const { InvokeCommand } = require("@aws-sdk/client-lambda");
    const cmd = new InvokeCommand({
      FunctionName: process.env.SCAN_FUNCTION_NAME || "scan-busdt-block",
      InvocationType: "Event", // 异步调用
      Payload: JSON.stringify({ source: "api-trigger" }),
    });
    await client.send(cmd);
    console.log("扫描 Lambda 已触发");
  } catch (err) {
    console.warn("触发扫描失败（不影响主流程）:", err.message);
  }
}

// ==================== 工具函数 ====================

function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: JSON.stringify(body),
  };
}

function bepusdtResponse(statusCode, message, data = null) {
  return buildResponse(200, {
    status_code: statusCode,
    message,
    data,
    request_id: "",
  });
}

function parseBody(event) {
  if (event.body) {
    return typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  }
  return event;
}

/**
 * 获取汇率并计算 USDT 金额
 */
async function calculateAmount(fiatAmount, rateStr) {
  const rate = parseFloat(rateStr);
  if (!fiatAmount || fiatAmount === 0) return { actual_amount: null, rate: rateStr };
  const usdt = fiatAmount / rate;
  // 保留 6 位小数
  return { actual_amount: usdt.toFixed(6), rate: rateStr };
}

/**
 * 解析汇率浮动语法
 * "7.4" → 固定 7.4
 * "~1.02" → 基础汇率 × 1.02
 * "+0.3" → 基础汇率 + 0.3
 * "-0.2" → 基础汇率 - 0.2
 */
function parseRateSyntax(baseRate, rateStr) {
  if (!rateStr) return String(baseRate);
  const base = parseFloat(baseRate);

  if (rateStr.startsWith("~")) {
    const mult = parseFloat(rateStr.substring(1));
    return String((base * mult).toFixed(4));
  }
  if (rateStr.startsWith("+")) {
    const add = parseFloat(rateStr.substring(1));
    return String((base + add).toFixed(4));
  }
  if (rateStr.startsWith("-")) {
    const sub = parseFloat(rateStr.substring(1));
    return String((base - sub).toFixed(4));
  }
  // 固定值
  return rateStr;
}

// ==================== API 处理函数 ====================

/**
 * 创建交易 POST /api/v1/order/create-transaction
 */
async function handleCreateTransaction(body, apiToken) {
  // 验签
  if (!verify(body, apiToken)) {
    return bepusdtResponse(400, "签名验证失败");
  }

  const { order_id, amount, notify_url, redirect_url, fiat, trade_type, address, name, timeout, rate } = body;

  if (!order_id || !notify_url || !redirect_url) {
    return bepusdtResponse(400, "缺少必填参数: order_id, notify_url, redirect_url");
  }

  // 获取汇率
  const rateConfig = await db.getRate();
  let effectiveRate = rateConfig.rate;

  // 如果传了 rate 参数，解析浮动语法
  if (rate) {
    effectiveRate = parseRateSyntax(rateConfig.rate, rate);
  }

  // 计算 USDT 金额
  const fiatAmount = parseFloat(amount) || 0;
  const isExclusive = fiatAmount === 0;
  const { actual_amount } = await calculateAmount(fiatAmount, effectiveRate);

  // 获取收款钱包
  const tradeType = trade_type || "usdt.bep20";
  let walletAddress = address;
  if (!walletAddress) {
    const wallet = await db.getActiveWallet(tradeType);
    walletAddress = wallet?.wallet_address || process.env.RECEIVE_WALLET || "";
  }

  // 处理超时
  const timeoutSec = Math.max(timeout || 600, 120);

  // 如果相同 order_id 存在，先删除（重建）
  const existing = await db.getOrder(order_id);
  // 这里简化：直接创建新订单，trade_id 是 UUID

  // 创建订单
  const order = await db.createOrder({
    order_id,
    amount: fiatAmount,
    actual_amount,
    token: walletAddress,
    notify_url,
    redirect_url,
    fiat: fiat || "CNY",
    trade_type: tradeType,
    currency: "USDT",
    network: tradeType.includes("bep20") ? "bsc" : "tron",
    name: name || "",
    timeout: timeoutSec,
    rate: effectiveRate,
    reselect: false,
    address_exclusive: isExclusive ? 1 : 0,
  });

  // 构造收银台 URL（用 query 参数格式，兼容 CF Pages）
  const baseUrl = process.env.CHECKOUT_BASE_URL || "";
  const paymentUrl = baseUrl ? `${baseUrl}/checkout-counter.html?trade_id=${order.trade_id}` : "";

  // 异步触发扫描
  await triggerScan();

  return bepusdtResponse(200, "success", {
    fiat: order.fiat,
    trade_id: order.trade_id,
    order_id: order.order_id,
    amount: order.amount,
    actual_amount: order.actual_amount || "",
    token: order.token,
    expiration_time: timeoutSec,
    status: parseInt(order.status),
    payment_url: paymentUrl,
  });
}

/**
 * 创建订单 POST /api/v1/order/create-order
 */
async function handleCreateOrder(body, apiToken) {
  if (!verify(body, apiToken)) {
    return bepusdtResponse(400, "签名验证失败");
  }

  const { order_id, amount, notify_url, redirect_url, fiat, name, timeout, reselect } = body;

  if (!order_id || !notify_url || !redirect_url) {
    return bepusdtResponse(400, "缺少必填参数: order_id, notify_url, redirect_url");
  }

  const fiatAmount = parseFloat(amount) || 0;
  const timeoutSec = Math.max(timeout || 600, 180);

  // create-order 模式不立即分配钱包地址，等用户选择后通过 update-order 分配
  const order = await db.createOrder({
    order_id,
    amount: fiatAmount,
    notify_url,
    redirect_url,
    fiat: fiat || "CNY",
    name: name || "",
    timeout: timeoutSec,
    reselect: reselect !== undefined ? (reselect ? 1 : 0) : 1,
    address_exclusive: fiatAmount === 0 ? 1 : 0,
  });

  const baseUrl = process.env.CHECKOUT_BASE_URL || "";
  const paymentUrl = baseUrl ? `${baseUrl}/checkout-counter.html?trade_id=${order.trade_id}` : "";

  return bepusdtResponse(200, "success", {
    fiat: order.fiat,
    trade_id: order.trade_id,
    order_id: order.order_id,
    amount: order.amount,
    expiration_time: timeoutSec,
    status: parseInt(order.status),
    payment_url: paymentUrl,
    reselect: order.reselect === 1,
  });
}

/**
 * 取消交易 POST /api/v1/order/cancel-transaction
 */
async function handleCancelTransaction(body, apiToken) {
  if (!verify(body, apiToken)) {
    return bepusdtResponse(400, "签名验证失败");
  }

  const { trade_id } = body;
  if (!trade_id) {
    return bepusdtResponse(400, "缺少必填参数: trade_id");
  }

  const order = await db.getOrder(trade_id);
  if (!order) {
    return bepusdtResponse(404, "订单不存在");
  }

  if (order.status === 2) {
    return bepusdtResponse(400, "订单已支付，无法取消");
  }

  await db.updateOrderStatus(trade_id, 4); // 4=取消

  return bepusdtResponse(200, "success", { trade_id });
}

/**
 * 付款方式列表 POST /api/v1/pay/methods
 * 从数据库读取所有启用的钱包，返回可用的付款方式
 */
async function handleMethods(body) {
  const { trade_id } = body;
  if (!trade_id) {
    return bepusdtResponse(400, "缺少必填参数: trade_id");
  }

  const order = await db.getOrder(trade_id);
  if (!order) {
    return bepusdtResponse(404, "订单不存在");
  }

  // 获取汇率
  const rateConfig = await db.getRate();
  const rate = parseFloat(rateConfig.rate);
  const fiatAmount = parseFloat(order.amount) || 0;

  // 从数据库读取所有启用的钱包
  const wallets = await db.getWallets();
  const activeWallets = wallets.filter(w => w.status === 1);

  // trade_type 格式: currency.network 如 usdt.bep20, USDC.Polygon, tron.trx
  const methods = activeWallets.map(w => {
    const parts = (w.trade_type || "").split(".");
    const currency = parts[0] || "USDT";
    const networkCode = parts[1] || "bep20";

    // 映射网络名称
    const networkMap = {
      bep20: { name: "BSC", full: "BNB Smart Chain", popular: true },
      erc20: { name: "ERC20", full: "Ethereum", popular: false },
      trc20: { name: "TRC20", full: "TRON", popular: true },
      trx: { name: "TRX", full: "TRON", popular: true },
      polygon: { name: "Polygon", full: "Polygon", popular: false },
    };
    const net = networkMap[networkCode.toLowerCase()] || { name: networkCode.toUpperCase(), full: networkCode, popular: false };

    const actualAmount = fiatAmount > 0 ? (fiatAmount / rate).toFixed(6) : "0";

    return {
      amount: order.amount || "0",
      actual_amount: actualAmount,
      fiat: order.fiat || "CNY",
      exchange_rate: rateConfig.rate,
      currency: currency.toUpperCase(),
      network: net.name.toLowerCase(),
      token_net_name: net.name,
      token_custom_name: w.name || "",
      wallet_address: w.wallet_address,
      trade_type: w.trade_type,
      is_popular: net.popular,
    };
  });

  return bepusdtResponse(200, "success", { methods });
}

/**
 * 更新付款方式 POST /api/v1/pay/update-order
 */
async function handleUpdateOrder(body) {
  const { trade_id, currency, network } = body;
  if (!trade_id || !currency || !network) {
    return bepusdtResponse(400, "缺少必填参数: trade_id, currency, network");
  }

  const order = await db.getOrder(trade_id);
  if (!order) {
    return bepusdtResponse(404, "订单不存在");
  }

  if (order.status !== 1) {
    return bepusdtResponse(400, "订单状态不允许更新");
  }

  // 获取钱包 - 从数据库匹配
  const wallets = await db.getWallets();
  // 匹配 currency.network 格式，如 USDT.BEP20 或 tron.trx
  const networkForType = network.toLowerCase();
  const matched = wallets.find(w => {
    const parts = (w.trade_type || "").split(".");
    const wCurrency = (parts[0] || "").toLowerCase();
    const wNetwork = (parts[1] || "").toLowerCase();
    return wCurrency === currency.toLowerCase() &&
           (wNetwork === networkForType || wNetwork === networkForType.replace("bsc", "bep20").replace("eth", "erc20")) &&
           w.status === 1;
  });
  const walletAddress = matched?.wallet_address || "";
  const tradeType = matched?.trade_type || `${currency.toLowerCase()}.${networkForType}`;

  // 计算金额
  const rateConfig = await db.getRate();
  const rate = parseFloat(rateConfig.rate);
  const fiatAmount = parseFloat(order.amount) || 0;
  const actualAmount = fiatAmount > 0 ? (fiatAmount / rate).toFixed(6) : "0";

  await db.updateOrderPayment(trade_id, {
    token: walletAddress,
    actual_amount: actualAmount,
    trade_type: tradeType,
    currency,
    network,
  });

  const baseUrl = process.env.CHECKOUT_BASE_URL || "";
  const paymentUrl = baseUrl ? `${baseUrl}/checkout-counter.html?trade_id=${trade_id}` : "";

  return bepusdtResponse(200, "success", {
    fiat: order.fiat,
    trade_id,
    order_id: order.order_id,
    amount: order.amount,
    actual_amount: actualAmount,
    expiration_time: order.timeout,
    status: parseInt(order.status),
    payment_url: paymentUrl,
  });
}

/**
 * 付款信息 POST /api/v1/pay/info
 */
async function handlePayInfo(body) {
  const { trade_id } = body;
  if (!trade_id) {
    return bepusdtResponse(400, "缺少必填参数: trade_id");
  }

  const order = await db.getOrder(trade_id);
  if (!order) {
    return bepusdtResponse(404, "订单不存在");
  }

  // 直接返回数据库中的数据，不自动补全
  let actualAmount = order.actual_amount || "";
  let token = order.token || "";
  let currency = order.currency || "USDT";
  let network = order.network || "bsc";

  // 计算过期时间戳
  const createdAt = order.created_at ? new Date(order.created_at).getTime() : Date.now();
  const expiredAt = createdAt + (order.timeout || 600) * 1000;

  // 构建区块浏览器链接
  const explorerUrls = {
    bsc: "https://bscscan.com/tx/",
    eth: "https://etherscan.io/tx/",
    ethereum: "https://etherscan.io/tx/",
    polygon: "https://polygonscan.com/tx/",
    tron: "https://tronscan.org/#/transaction/",
    trc20: "https://tronscan.org/#/transaction/",
  };

  const networkKey = (network || "bsc").toLowerCase();
  const explorerBase = explorerUrls[networkKey] || "";

  return bepusdtResponse(200, "success", {
    fiat: order.fiat,
    trade_id: order.trade_id,
    order_id: order.order_id,
    money: order.amount,
    amount: order.amount,
    actual_amount: actualAmount,
    token: token,
    address: token,
    status: parseInt(order.status),
    trade_type: order.trade_type || "",
    currency: currency,
    network: network,
    created_at: Math.floor(createdAt / 1000),
    expired_at: Math.floor(expiredAt / 1000),
    timeout: order.timeout,
    reselect: order.reselect === 1,
    trade_url: order.tx_hash ? (explorerBase + order.tx_hash) : "",
    redirect_url: order.redirect_url || "",
    support_url: "",
  });
}

/**
 * 前端通知已付款 POST /api/v1/pay/notify
 */
async function handlePayNotify(body) {
  const { trade_id } = body;
  if (!trade_id) {
    return bepusdtResponse(400, "缺少必填参数: trade_id");
  }

  const order = await db.getOrder(trade_id);
  if (!order) {
    return bepusdtResponse(404, "订单不存在");
  }

  // 前端通知只是标记用户已点击"我已付款"，实际确认靠链上扫描
  // 触发一次扫描
  console.log(`用户通知已付款: trade_id=${trade_id}`);
  await triggerScan();

  return bepusdtResponse(200, "success", { trade_id });
}

/**
 * 手动补单 POST /api/v1/order/manual-confirm
 * 管理员手动确认订单已付款（跳过链上扫描，直接标记为已支付）
 * 需要 API Token 验证
 */
async function handleManualConfirm(body, apiToken) {
  const { trade_id, signature } = body;
  if (!trade_id) {
    return bepusdtResponse(400, "缺少必填参数: trade_id");
  }

  // 验证签名（防止未授权调用）
  if (!verify(body, apiToken)) {
    return bepusdtResponse(400, "签名验证失败");
  }

  const order = await db.getOrder(trade_id);
  if (!order) {
    return bepusdtResponse(404, "订单不存在");
  }

  // 只有待支付(status=1)或确认中(status=5)的订单才能补单
  if (order.status !== 1 && order.status !== 5) {
    return bepusdtResponse(400, `订单状态异常，当前状态: ${order.status}，只有待支付或确认中的订单才能补单`);
  }

  // 更新订单状态为 2（已支付），记录确认时间，触发回调通知
  await db.updateOrderStatus(trade_id, 2);
  console.log(`手动补单成功: trade_id=${trade_id}, order_id=${order.order_id}`);

  // 异步发送回调通知
  try {
    await sendNotify(order, apiToken);
  } catch (e) {
    console.warn("补单回调通知发送失败:", e.message);
  }

  return bepusdtResponse(200, "success", {
    trade_id,
    order_id: order.order_id,
    status: 2,
    message: "补单成功",
  });
}

// ==================== 管理后台 API ====================

/**
 * 管理员登录 POST /api/admin/login
 */
async function handleAdminLogin(body) {
  const { username, password } = body;
  if (!username || !password) {
    return buildResponse(200, { status_code: 400, message: "请输入用户名和密码" });
  }

  // 首次登录：如果没设置过密码，自动设置
  const storedPassword = await db.getAdminPassword();
  if (!storedPassword) {
    if (username === "admin") {
      await db.setAdminPassword(password);
      const token = await db.createAdminSession();
      return buildResponse(200, { status_code: 200, message: "密码已设置，登录成功", data: { token, username: "admin" } });
    }
    return buildResponse(200, { status_code: 400, message: "用户名或密码错误" });
  }

  if (username !== "admin") {
    return buildResponse(200, { status_code: 400, message: "用户名或密码错误" });
  }

  const ok = await db.verifyAdminPassword(password);
  if (!ok) {
    return buildResponse(200, { status_code: 400, message: "用户名或密码错误" });
  }

  const token = await db.createAdminSession();
  return buildResponse(200, { status_code: 200, message: "登录成功", data: { token, username: "admin" } });
}

/**
 * 管理员登出 POST /api/admin/logout
 */
async function handleAdminLogout(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (token) await db.deleteAdminSession(token);
  return buildResponse(200, { status_code: 200, message: "已登出" });
}

/**
 * 管理员信息 GET /api/admin/info
 */
async function handleAdminInfo(headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  const ok = await db.verifyAdminSession(token);
  if (!ok) return buildResponse(200, { status_code: 401, message: "未登录或登录已过期" });
  return buildResponse(200, { status_code: 200, message: "success", data: { username: "admin" } });
}

/**
 * 修改密码 POST /api/admin/set-password
 */
async function handleAdminSetPassword(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  const ok = await db.verifyAdminSession(token);
  if (!ok) return buildResponse(200, { status_code: 401, message: "未登录或登录已过期" });

  const { old_password, new_password } = body;
  if (!old_password || !new_password) {
    return buildResponse(200, { status_code: 400, message: "请输入旧密码和新密码" });
  }

  const verifyOk = await db.verifyAdminPassword(old_password);
  if (!verifyOk) {
    return buildResponse(200, { status_code: 400, message: "旧密码错误" });
  }

  await db.setAdminPassword(new_password);
  return buildResponse(200, { status_code: 200, message: "密码修改成功" });
}

/**
 * 钱包列表 POST /api/admin/wallet/list
 */
async function handleWalletList(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }
  const wallets = await db.getWallets();
  return buildResponse(200, { status_code: 200, message: "success", data: { list: wallets, total: wallets.length } });
}

/**
 * 添加钱包 POST /api/admin/wallet/add
 */
async function handleWalletAdd(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const { name, trade_type, wallet_address, status } = body;
  if (!name || !trade_type || !wallet_address) {
    return buildResponse(200, { status_code: 400, message: "名称、交易类型、钱包地址为必填" });
  }

  await db.addWallet({ name, trade_type, wallet_address, status: status !== undefined ? status : 1 });
  return buildResponse(200, { status_code: 200, message: "添加成功" });
}

/**
 * 修改钱包 POST /api/admin/wallet/update
 */
async function handleWalletUpdate(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const { id, name, trade_type, wallet_address, status } = body;
  if (!id) {
    return buildResponse(200, { status_code: 400, message: "缺少钱包 ID" });
  }

  await db.updateWallet(id, { name, trade_type, wallet_address, status });
  return buildResponse(200, { status_code: 200, message: "修改成功" });
}

/**
 * 删除钱包 POST /api/admin/wallet/delete
 */
async function handleWalletDelete(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const { id } = body;
  if (!id) {
    return buildResponse(200, { status_code: 400, message: "缺少钱包 ID" });
  }

  await db.deleteWallet(id);
  return buildResponse(200, { status_code: 200, message: "删除成功" });
}

/**
 * 订单列表 POST /api/admin/order/list
 */
async function handleOrderList(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const { page, pageSize, keyword, trade_type, status, start_date, end_date } = body;
  const result = await db.getOrders({
    page: page || 1,
    pageSize: pageSize || 10,
    keyword,
    tradeType: trade_type,
    status,
    startDate: start_date,
    endDate: end_date,
  });
  return buildResponse(200, { status_code: 200, message: "success", data: result });
}

/**
 * 订单详情 POST /api/admin/order/detail
 */
async function handleOrderDetail(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const { trade_id } = body;
  if (!trade_id) return buildResponse(200, { status_code: 400, message: "缺少 trade_id" });

  const order = await db.getOrder(trade_id);
  if (!order) return buildResponse(200, { status_code: 404, message: "订单不存在" });

  return buildResponse(200, { status_code: 200, message: "success", data: order });
}

/**
 * 删除订单 POST /api/admin/order/delete
 */
async function handleOrderDelete(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const { trade_id, trade_ids } = body;
  if (trade_ids && Array.isArray(trade_ids)) {
    await db.deleteOrders(trade_ids);
  } else if (trade_id) {
    await db.deleteOrder(trade_id);
  } else {
    return buildResponse(200, { status_code: 400, message: "缺少 trade_id" });
  }

  return buildResponse(200, { status_code: 200, message: "删除成功" });
}

/**
 * 管理后台手动补单 POST /api/admin/order/confirm
 */
async function handleAdminConfirm(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const { trade_id } = body;
  if (!trade_id) return buildResponse(200, { status_code: 400, message: "缺少 trade_id" });

  const order = await db.getOrder(trade_id);
  if (!order) return buildResponse(200, { status_code: 404, message: "订单不存在" });

  if (order.status !== 1 && order.status !== 5) {
    return buildResponse(200, { status_code: 400, message: `订单状态异常: ${order.status}` });
  }

  await db.updateOrderStatus(trade_id, 2);
  const apiTokenForNotify = await db.getConfig("api_auth_token") || "";
  try { await sendNotify(order, apiTokenForNotify); } catch (e) { console.warn("回调通知失败:", e.message); }

  return buildResponse(200, { status_code: 200, message: "补单成功", data: { trade_id, status: 2 } });
}

/**
 * 首页统计 POST /api/admin/dashboard
 */
async function handleDashboard(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const stats = await db.getDashboardStats();
  return buildResponse(200, { status_code: 200, message: "success", data: stats });
}

/**
 * 系统设置 GET/POST /api/admin/config
 */
async function handleConfigGet(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const config = await db.getAllConfig();
  // 过滤掉 session 相关的 key
  const filtered = {};
  for (const [k, v] of Object.entries(config)) {
    if (!k.startsWith("admin_session_")) filtered[k] = v;
  }
  return buildResponse(200, { status_code: 200, message: "success", data: filtered });
}

async function handleConfigSet(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const { key, value } = body;
  if (!key) return buildResponse(200, { status_code: 400, message: "缺少 key" });

  await db.setConfig(key, value);
  return buildResponse(200, { status_code: 200, message: "设置成功" });
}

/**
 * 重置 API Token POST /api/admin/reset-token
 */
async function handleResetToken(body, headers) {
  const token = (headers.authorization || "").replace("Bearer ", "");
  if (!(await db.verifyAdminSession(token))) {
    return buildResponse(200, { status_code: 401, message: "未登录" });
  }

  const newToken = "bepusdt_" + crypto.randomBytes(12).toString("hex");
  await db.setConfig("api_auth_token", newToken);
  return buildResponse(200, { status_code: 200, message: "Token 已重置", data: { token: newToken } });
}

// ==================== 主路由 ====================

exports.handler = async (event) => {
  console.log("API 请求:", JSON.stringify(event).substring(0, 500));

  // CORS 预检
  if (event.httpMethod === "OPTIONS" || (event.requestContext && event.requestContext.http && event.requestContext.http.method === "OPTIONS")) {
    return buildResponse(200, {});
  }

  try {
    // 获取 API Token
    const apiToken = await db.getConfig("api_auth_token") || process.env.API_TOKEN || "";

    // 解析路径和方法
    const path = event.path || (event.requestContext && event.requestContext.http && event.requestContext.http.path) || "";
    const method = event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || "POST";
    const body = parseBody(event);

    console.log(`路由: ${method} ${path}`);

    // 健康检查
    if (path === "/health" || path.endsWith("/health")) {
      return buildResponse(200, { status: "ok", time: new Date().toISOString() });
    }

    // API 路由
    if (path.includes("/api/v1/order/create-transaction")) {
      return await handleCreateTransaction(body, apiToken);
    }
    if (path.includes("/api/v1/order/create-order")) {
      return await handleCreateOrder(body, apiToken);
    }
    if (path.includes("/api/v1/order/cancel-transaction")) {
      return await handleCancelTransaction(body, apiToken);
    }
    if (path.includes("/api/v1/pay/update-order")) {
      return await handleUpdateOrder(body);
    }
    if (path.includes("/api/v1/pay/methods")) {
      return await handleMethods(body);
    }
    if (path.includes("/api/v1/pay/info")) {
      return await handlePayInfo(body);
    }
    if (path.includes("/api/v1/pay/notify")) {
      return await handlePayNotify(body);
    }
    // 手动补单（需要签名验证）
    if (path.includes("/api/v1/order/manual-confirm")) {
      return await handleManualConfirm(body, apiToken);
    }

    // 查询订单状态（收银台轮询用）
    if (path.includes("/api/v1/order/query") || path.includes("/api/v1/order/status")) {
      const trade_id = body.trade_id || (event.queryStringParameters && event.queryStringParameters.trade_id);
      if (!trade_id) return bepusdtResponse(400, "缺少 trade_id");
      const order = await db.getOrder(trade_id);
      if (!order) return bepusdtResponse(404, "订单不存在");
      return bepusdtResponse(200, "success", {
        trade_id: order.trade_id,
        order_id: order.order_id,
        status: parseInt(order.status),
        actual_amount: order.actual_amount || "",
        token: order.token || "",
        tx_hash: order.tx_hash || "",
      });
    }

    // ==================== 管理后台路由 ====================
    const headers = event.headers || {};

    // 登录（不需要认证）
    if (path.includes("/api/admin/login")) {
      return await handleAdminLogin(body);
    }

    // 以下管理接口需要认证
    if (path.includes("/api/admin/logout")) {
      return await handleAdminLogout(body, headers);
    }
    if (path.includes("/api/admin/info")) {
      return await handleAdminInfo(headers);
    }
    if (path.includes("/api/admin/set-password")) {
      return await handleAdminSetPassword(body, headers);
    }
    if (path.includes("/api/admin/wallet/list")) {
      return await handleWalletList(body, headers);
    }
    if (path.includes("/api/admin/wallet/add")) {
      return await handleWalletAdd(body, headers);
    }
    if (path.includes("/api/admin/wallet/update")) {
      return await handleWalletUpdate(body, headers);
    }
    if (path.includes("/api/admin/wallet/delete")) {
      return await handleWalletDelete(body, headers);
    }
    if (path.includes("/api/admin/order/list")) {
      return await handleOrderList(body, headers);
    }
    if (path.includes("/api/admin/order/detail")) {
      return await handleOrderDetail(body, headers);
    }
    if (path.includes("/api/admin/order/delete")) {
      return await handleOrderDelete(body, headers);
    }
    if (path.includes("/api/admin/order/confirm")) {
      return await handleAdminConfirm(body, headers);
    }
    if (path.includes("/api/admin/dashboard")) {
      return await handleDashboard(body, headers);
    }
    if (path.includes("/api/admin/config")) {
      // 如果有key参数则是设置，否则是读取
      if (body && body.key) {
        return await handleConfigSet(body, headers);
      } else {
        return await handleConfigGet(body, headers);
      }
    }
    if (path.includes("/api/admin/reset-token")) {
      return await handleResetToken(body, headers);
    }

    // 404
    return bepusdtResponse(404, `未知接口: ${method} ${path}`);
  } catch (err) {
    console.error("API 错误:", err);
    return bepusdtResponse(500, `服务器错误: ${err.message}`);
  }
};

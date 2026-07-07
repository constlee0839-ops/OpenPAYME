/**
 * Lambda: createOrder
 * 创建支付订单
 *
 * 触发方式: API Gateway (POST /orders)
 *
 * 请求体:
 * {
 *   "orderId": "ORDER20260707001",   // 业务订单号
 *   "amount": 100.50,                 // USDT 金额
 *   "callbackUrl": "https://..."      // 可选，支付成功回调地址
 * }
 *
 * 创建订单后会立即触发一次链上扫描，确保已转账的订单能及时确认
 */

const { createOrder, getOrder, getRate } = require("./lib/db");

exports.handler = async (event) => {
  console.log("createOrder 被调用, event:", JSON.stringify(event));

  try {
    // 解析请求体
    let body;
    if (event.body) {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } else if (event.orderId) {
      // 直接调用（EventBridge 或其他触发器）
      body = event;
    } else {
      return buildResponse(400, { error: "缺少请求参数" });
    }

    const { orderId, amount, callbackUrl } = body;

    // 参数校验
    if (!orderId || !amount) {
      return buildResponse(400, {
        error: "缺少必填参数: orderId 和 amount",
      });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return buildResponse(400, { error: "amount 必须为大于0的数字" });
    }

    // 获取收款地址（从环境变量）
    const walletAddress =
      process.env.RECEIVE_WALLET || "";
    if (!walletAddress) {
      return buildResponse(500, { error: "未配置收款钱包地址 RECEIVE_WALLET" });
    }

    // 检查订单是否已存在（幂等）
    const existing = await getOrder(orderId);
    if (existing) {
      return buildResponse(200, {
        success: true,
        message: "订单已存在",
        order: formatOrder(existing),
      });
    }

    // 获取当前汇率（如果有）
    const rate = await getRate();

    // 创建订单
    const order = await createOrder({
      orderId,
      walletAddress,
      expectedAmount: amount,
      callbackUrl: callbackUrl || "",
    });

    console.log(`订单创建成功: ${orderId}, 金额: ${amount} USDT`);

    // ========== 创建订单后立即触发一次扫描 ==========
    // 用 Promise.race 设置5秒超时，不阻塞订单创建响应
    // 如果5秒没扫完，后续定时扫描会兜底
    try {
      const { handler: scanHandler } = require("./scanTransactions");
      await Promise.race([
        scanHandler({ source: "createOrder", orderId }),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      console.log("订单创建后即时扫描完成");
    } catch (scanErr) {
      console.warn("即时扫描失败（不影响订单创建）:", scanErr.message);
    }

    return buildResponse(200, {
      success: true,
      message: "订单创建成功",
      order: formatOrder(order),
      rate: rate
        ? { usdt_cny: rate.usdt_cny, source: rate.source, updatedAt: rate.updatedAt }
        : null,
    });
  } catch (err) {
    console.error("创建订单失败:", err);
    return buildResponse(500, { error: `创建订单失败: ${err.message}` });
  }
};

/**
 * 格式化订单返回数据
 */
function formatOrder(order) {
  return {
    orderId: order.orderId,
    walletAddress: order.walletAddress,
    expectedAmount: order.expectedAmount,
    actualAmount: order.actualAmount || 0,
    status: order.status,
    txHash: order.txHash || "",
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt || "",
  };
}

/**
 * 构建 API Gateway 响应
 */
function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

/**
 * 商户回调通知模块
 * 支持指数退避重试：2/4/8/16/32/64 分钟，最多 10 次
 */

const { sign } = require("./signature");

/**
 * 发送回调通知到商户
 * @param {Object} order - 订单数据
 * @param {string} apiToken - API 认证令牌
 * @returns {boolean} 商户是否返回 success
 */
async function sendNotify(order, apiToken) {
  const notifyUrl = order.notify_url;
  if (!notifyUrl) {
    console.log(`订单 ${order.trade_id} 无回调地址，跳过`);
    return true;
  }

  // 构造回调参数（按 BEpusdt 格式）
  const params = {
    trade_id: order.trade_id,
    order_id: order.order_id,
    amount: parseFloat(order.amount) || 0,
    actual_amount: parseFloat(order.actual_amount) || 0,
    token: order.token || "",
    block_transaction_id: order.tx_hash || "",
    status: order.status,
  };

  // 生成签名（基于表单字段，与商城验签一致）
  params.signature = sign(params, apiToken);

  console.log(`回调通知: ${notifyUrl}, trade_id=${order.trade_id}, status=${order.status}`);

  // 拼表单（application/x-www-form-urlencoded），BEpusdt 兼容商城读 $_POST 表单字段
  const formBody = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    formBody.append(k, v == null ? "" : String(v));
  }

  try {
    const resp = await fetch(notifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
      signal: AbortSignal.timeout(10000), // 10 秒超时
    });

    const text = await resp.text();
    console.log(`回调响应: ${resp.status} ${text.substring(0, 200)}`);

    // BEpusdt 要求商户返回 "success" 字符串
    return text.trim().toLowerCase() === "success";
  } catch (err) {
    console.error(`回调失败: ${err.message}`);
    return false;
  }
}

module.exports = { sendNotify };

/**
 * Lambda: scanTransactions（按需即时扫描）
 *
 * 由 createOrder.js / queryOrder.js 在订单创建或查询时按需触发，
 * 对当前 PENDING 订单做一次链上扫描，确认是否已到账（5秒超时兜底）。
 *
 * ⚠️ 实现与 scan.js 保持一致的 DB schema（status=1 待支付 / actual_amount 金额 /
 *    trade_type 链类型），并复用真实回调通知 sendNotify，避免旧版字段
 *   (orderId/walletAddress/expectedAmount/"PENDING") 在现数据库根本不存在导致崩溃。
 */

const db = require("./lib/db");
const { sendNotify } = require("./lib/callback");
const {
  scanChainBatch,
  resolveTradeType,
  getCurrentBlockNumber,
} = require("./lib/chain");

const MAX_SCAN_BLOCKS = 2000;

/**
 * 金额匹配（带容差）
 */
function matchOrder(order, tx) {
  if (order.address_exclusive === 1) return true;
  const expected = parseFloat(order.actual_amount);
  if (!expected) return false;
  return Math.abs(tx.amount - expected) < 0.000001;
}

exports.handler = async (event) => {
  console.log("scanTransactions(即时) 触发:", JSON.stringify(event).substring(0, 200));
  try {
    const apiToken = (await db.getConfig("api_auth_token")) || process.env.API_TOKEN || "";

    const pendingOrders = await db.getPendingOrders();
    if (pendingOrders.length === 0) {
      return { success: true, message: "无待处理订单", matched: 0 };
    }

    const currentBlock = await getCurrentBlockNumber();
    let lastScanned = await db.getLastScannedBlock();
    if (lastScanned === 0) lastScanned = Math.max(1, currentBlock - 1000);
    const fromBlock = lastScanned + 1;
    const toBlock = Math.min(fromBlock + MAX_SCAN_BLOCKS - 1, currentBlock);

    // 按地址聚合订单
    const addressMap = new Map();
    for (const order of pendingOrders) {
      if (!order.token) continue;
      const addr = order.token.toLowerCase();
      if (!addressMap.has(addr)) addressMap.set(addr, []);
      addressMap.get(addr).push(order);
    }

    let matched = 0;
    for (const [address, orders] of addressMap) {
      // 按订单的 trade_type 解析链 + 币种，分发给对应扫描器（多链支持）
      const { chain: chainType, coin } = resolveTradeType(orders[0].trade_type);
      try {
        const transfers = await scanChainBatch(chainType, coin, address, fromBlock, toBlock);
        for (const tx of transfers) {
          if (await db.isTxHashProcessed(tx.txHash)) continue;
          for (const order of orders) {
            if (order.status !== 1) continue;
            if (matchOrder(order, tx)) {
              await db.recordTx({
                tx_hash: tx.txHash,
                from_address: tx.from,
                to_address: tx.to,
                amount: tx.amount,
                block_number: tx.blockNumber,
                trade_id: order.trade_id,
              });
              await db.updateOrderStatus(order.trade_id, 2, {
                tx_hash: tx.txHash,
                block_number: tx.blockNumber,
                actual_amount: tx.amount,
              });
              matched++;
              const updated = await db.getOrder(order.trade_id);
              await sendNotify(updated, apiToken).then((ok) =>
                db.updateNotifyStatus(order.trade_id, ok)
              );
              break;
            }
          }
        }
      } catch (err) {
        console.error(`即时扫描地址 ${address} 失败:`, err.message);
      }
    }

    await db.setLastScannedBlock(toBlock);
    return { success: true, matched };
  } catch (err) {
    console.error("scanTransactions(即时) 失败:", err.message);
    return { success: false, error: err.message };
  }
};

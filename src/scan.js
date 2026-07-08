/**
 * Lambda: scan-busdt-block
 * BSC 链上 USDT 交易扫描 + 订单匹配 + 回调通知
 *
 * 触发方式:
 *   1. API Lambda 通过 Lambda SDK 异步调用（下单时触发）
 *   2. 手动测试调用
 *
 * 核心逻辑:
 *   1. 查询所有 PENDING 订单（状态 1=等待支付, 5=确认中）
 *   2. 没有 PENDING → 检查汇率是否需要更新 → 退出
 *   3. 有 PENDING → 从上次扫描区块继续扫描
 *   4. 匹配金额 → 确认订单 → 发送回调通知
 *   5. 检查过期订单 → 标记过期 → 发送回调通知
 */

const db = require("./lib/db");
const {
  getCurrentBlockNumber,
  scanChainBatch,
  resolveTradeType,
  getUSDTRate,
} = require("./lib/chain");
const { sendNotify } = require("./lib/callback");

const MAX_SCAN_BLOCKS = 5000;
const RATE_UPDATE_INTERVAL = 4 * 60 * 60 * 1000; // 4小时

exports.handler = async (event) => {
  console.log("scan-busdt-block 触发:", JSON.stringify(event).substring(0, 200));

  try {
    const apiToken = (await db.getConfig("api_auth_token")) || process.env.API_TOKEN || "";

    // ========== 1. 检查汇率是否需要更新 ==========
    await checkAndUpdateRate();

    // ========== 2. 查询 PENDING 订单 ==========
    const pendingOrders = await db.getPendingOrders();
    console.log(`PENDING 订单数: ${pendingOrders.length}`);

    if (pendingOrders.length === 0) {
      // 没有待处理订单，检查是否有需要回调的
      await processPendingNotifications(apiToken);
      console.log("无待处理订单，退出");
      return { success: true, message: "无待处理订单", scanned: 0 };
    }

    // ========== 3. 扫描链上交易 ==========
    const currentBlock = await getCurrentBlockNumber();
    let lastScanned = await db.getLastScannedBlock();

    // 第一次运行，从当前区块往前扫 1000 个
    if (lastScanned === 0) {
      lastScanned = Math.max(1, currentBlock - 1000);
    }

    const fromBlock = lastScanned + 1;
    const toBlock = Math.min(fromBlock + MAX_SCAN_BLOCKS - 1, currentBlock);

    console.log(`扫描区块: ${fromBlock} -> ${toBlock} (当前: ${currentBlock})`);

    // 收集所有 PENDING 订单的收款地址
    const addressMap = new Map(); // address.toLowerCase() -> [orders]
    for (const order of pendingOrders) {
      if (!order.token) continue;
      const addr = order.token.toLowerCase();
      if (!addressMap.has(addr)) {
        addressMap.set(addr, []);
      }
      addressMap.get(addr).push(order);
    }

    // 逐个地址扫描（按订单的链类型分发到对应扫描器）
    let matchedCount = 0;
    for (const [address, orders] of addressMap) {
      // 该地址所有订单的 trade_type 通常同链，取第一个推断链
      const { chain, coin } = resolveTradeType(orders[0].trade_type);
      try {
        console.log(`扫描链=${chain} 币种=${coin} 地址=${address} 区块 ${fromBlock}->${toBlock}`);
        const transfers = await scanChainBatch(chain, coin, address, fromBlock, toBlock);

        for (const tx of transfers) {
          // 检查是否已处理
          const processed = await db.isTxHashProcessed(tx.txHash);
          if (processed) {
            console.log(`跳过已处理交易: ${tx.txHash}`);
            continue;
          }

          // 匹配订单
          let matchedThisTx = false;
          for (const order of orders) {
            if (order.status !== 1) continue; // 只匹配等待支付的

            const matched = matchOrder(order, tx);
            if (matched) {
              console.log(`✅ 匹配成功! trade_id=${order.trade_id}, amount=${tx.amount} ${coin.toUpperCase()}`);

              // 记录交易
              await db.recordTx({
                tx_hash: tx.txHash,
                from_address: tx.from,
                to_address: tx.to,
                amount: tx.amount,
                block_number: tx.blockNumber,
                trade_id: order.trade_id,
              });

              // 更新订单状态为已支付（2）
              await db.updateOrderStatus(order.trade_id, 2, {
                tx_hash: tx.txHash,
                block_number: tx.blockNumber,
                actual_amount: tx.amount,
              });

              matchedCount++;

              // 发送回调通知
              const updatedOrder = await db.getOrder(order.trade_id);
              await sendNotify(updatedOrder, apiToken).then(async (success) => {
                await db.updateNotifyStatus(order.trade_id, success);
              });

              matchedThisTx = true;
              break;
            }
          }

          // 如果没匹配到订单，也记录交易（非订单转账检测）
          if (!matchedThisTx) {
            await db.recordTx({
              tx_hash: tx.txHash,
              from_address: tx.from,
              to_address: tx.to,
              amount: tx.amount,
              block_number: tx.blockNumber,
              trade_id: null,
            });
            console.log(`📝 非订单转账: ${tx.amount} ${coin.toUpperCase()}, tx=${tx.txHash}`);
          }
        }
      } catch (err) {
        console.error(`扫描地址 ${address} (链=${chain}) 失败:`, err.message);
      }
    }

    // ========== 4. 更新最后扫描区块 ==========
    await db.setLastScannedBlock(toBlock);

    // ========== 5. 检查过期订单 ==========
    await checkExpiredOrders(apiToken);

    // ========== 6. 处理待回调 ==========
    await processPendingNotifications(apiToken);

    console.log(`扫描完成: 匹配 ${matchedCount} 笔, 区块 ${fromBlock}-${toBlock}`);
    return { success: true, scanned: toBlock - fromBlock + 1, matched: matchedCount };
  } catch (err) {
    console.error("扫描失败:", err);
    return { success: false, error: err.message };
  }
};

// ==================== 辅助函数 ====================

/**
 * 金额匹配
 */
function matchOrder(order, tx) {
  // 地址独占模式：收到任意金额即匹配
  if (order.address_exclusive === 1) {
    return true;
  }

  // 金额精确匹配（带容差）
  const expected = parseFloat(order.actual_amount);
  if (!expected) return false;

  const tolerance = 0.000001;
  return Math.abs(tx.amount - expected) < tolerance;
}

/**
 * 检查并更新汇率
 */
async function checkAndUpdateRate() {
  const updatedAt = await db.getRateUpdatedAt();
  const lastUpdate = parseInt(updatedAt) || 0;
  const now = Date.now();

  if (now - lastUpdate > RATE_UPDATE_INTERVAL) {
    console.log("汇率过期，更新中...");
    try {
      const rateData = await getUSDTRate();
      await db.setRate(rateData.usdt_cny);
      await db.setRateUpdatedAt(String(now));
      console.log(`汇率已更新: ${rateData.usdt_cny} (来源: ${rateData.source})`);
    } catch (err) {
      console.warn("汇率更新失败:", err.message);
    }
  }
}

/**
 * 检查过期订单
 */
async function checkExpiredOrders(apiToken) {
  const pendingOrders = await db.getPendingOrders();
  const now = new Date();

  for (const order of pendingOrders) {
    if (order.status !== 1) continue; // 只处理等待支付的
    if (!order.expired_at) continue;

    const expiredAt = new Date(order.expired_at);
    if (now > expiredAt) {
      console.log(`订单过期: ${order.trade_id}`);
      await db.updateOrderStatus(order.trade_id, 3); // 3=过期

      // 发送过期回调
      const updatedOrder = await db.getOrder(order.trade_id);
      const success = await sendNotify(updatedOrder, apiToken);
      await db.updateNotifyStatus(order.trade_id, success);
    }
  }
}

/**
 * 处理待回调通知（指数退避重试）
 */
async function processPendingNotifications(apiToken) {
  const orders = await db.getOrdersToNotify();
  const now = new Date();

  for (const order of orders) {
    // 检查是否到了下次回调时间
    if (order.next_notify_at) {
      const nextTime = new Date(order.next_notify_at);
      if (now < nextTime) continue;
    }

    console.log(`重试回调: trade_id=${order.trade_id}, count=${order.notify_count}`);
    const success = await sendNotify(order, apiToken);
    await db.updateNotifyStatus(order.trade_id, success);
  }
}

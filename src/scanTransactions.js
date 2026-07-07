/**
 * Lambda: scanTransactions
 * 扫描 BSC 链上 USDT 交易，匹配 pending 订单
 *
 * 触发方式:
 *   1. EventBridge 定时触发 (每1分钟)
 *   2. createOrder 创建订单后异步调用
 *
 * 核心逻辑:
 * 1. 检查是否需要更新汇率（每4小时一次）
 * 2. 查询所有 PENDING 订单
 * 3. 如果没有 PENDING 订单，直接退出（0 费用核心）
 * 4. 扫描链上新区块，查找 USDT 转入
 * 5. 按金额匹配订单，确认到账
 * 6. 更新最后扫描区块号
 */

const {
  getPendingOrders,
  confirmOrder,
  isTxHashProcessed,
  getLastScannedBlock,
  setLastScannedBlock,
  getRateUpdatedAt,
  setRate,
} = require("./lib/db");
const {
  getCurrentBlockNumber,
  scanUSDTTransfersBatch,
  getUSDTRate,
} = require("./lib/chain");

// 每次最多扫描的区块数（Lambda 15分钟限制内安全值）
const MAX_SCAN_BLOCKS = 10000;

// 金额匹配容差（浮点数比较用）
const AMOUNT_EPSILON = 0.000001;

// 汇率更新间隔：4小时（毫秒）
const RATE_UPDATE_INTERVAL = 4 * 60 * 60 * 1000;

exports.handler = async (event) => {
  console.log("scanTransactions 触发, event:", JSON.stringify(event));

  try {
    // ========== 第0步：检查是否需要更新汇率 ==========
    await checkAndUpdateRate();

    // ========== 第1步：检查是否有 PENDING 订单 ==========
    const pendingOrders = await getPendingOrders();
    console.log(`当前 PENDING 订单数: ${pendingOrders.length}`);

    if (pendingOrders.length === 0) {
      console.log("无待处理订单，退出（0 计费）");
      return { success: true, message: "无待处理订单", scanned: 0 };
    }

    // ========== 第2步：确定扫描范围 ==========
    const currentBlock = await getCurrentBlockNumber();
    const lastScannedBlock = await getLastScannedBlock();

    // 首次运行，从当前区块往前扫少量区块
    let fromBlock;
    if (lastScannedBlock === 0) {
      fromBlock = currentBlock - 500;
      if (fromBlock < 0) fromBlock = 0;
      console.log(`首次扫描，从区块 ${fromBlock} 开始`);
    } else {
      fromBlock = lastScannedBlock + 1;
    }

    let toBlock = currentBlock;

    // 限制扫描范围，避免超时
    if (toBlock - fromBlock > MAX_SCAN_BLOCKS) {
      console.warn(
        `扫描范围过大 ${toBlock - fromBlock} 区块，限制为 ${MAX_SCAN_BLOCKS}`
      );
      toBlock = fromBlock + MAX_SCAN_BLOCKS;
    }

    if (fromBlock > toBlock) {
      console.log(`无需扫描: fromBlock(${fromBlock}) > toBlock(${toBlock})`);
      return { success: true, message: "无新区块", scanned: 0 };
    }

    console.log(`扫描范围: ${fromBlock} -> ${toBlock} (${toBlock - fromBlock} 区块)`);

    // ========== 第3步：构建地址-订单映射 ==========
    // 按收款地址分组，支持多地址场景
    const addressOrderMap = {};
    for (const order of pendingOrders) {
      const addr = order.walletAddress.toLowerCase();
      if (!addressOrderMap[addr]) {
        addressOrderMap[addr] = [];
      }
      addressOrderMap[addr].push(order);
    }

    const targetAddresses = Object.keys(addressOrderMap);
    console.log(`监听地址数: ${targetAddresses.length}`);

    // ========== 第4步：扫描链上交易 ==========
    let totalTransfers = 0;
    let matchedOrders = 0;

    for (const targetAddr of targetAddresses) {
      const transfers = await scanUSDTTransfersBatch(
        targetAddr,
        fromBlock,
        toBlock
      );
      totalTransfers += transfers.length;

      const ordersForAddr = addressOrderMap[targetAddr];

      // ========== 第5步：匹配订单 ==========
      for (const transfer of transfers) {
        // 全局去重：检查 txHash 是否已被处理
        const processed = await isTxHashProcessed(transfer.txHash);
        if (processed) {
          console.log(`tx ${transfer.txHash} 已处理，跳过`);
          continue;
        }

        // 按金额匹配订单
        for (const order of ordersForAddr) {
          if (order.status !== "PENDING") continue;

          if (Math.abs(transfer.amount - order.expectedAmount) < AMOUNT_EPSILON) {
            // 金额匹配成功！确认订单
            const result = await confirmOrder(
              order.orderId,
              transfer.txHash,
              transfer.amount,
              transfer.blockNumber
            );

            if (result) {
              console.log(
                `✅ 订单确认: ${order.orderId}, 到账 ${transfer.amount} USDT, tx: ${transfer.txHash}`
              );
              matchedOrders++;

              // TODO: 发送回调通知
              // await sendCallback(order, result);
            } else {
              console.log(
                `⚠️ 订单 ${order.orderId} 确认失败（可能已被其他实例处理）`
              );
            }
            break; // 一笔交易只匹配一个订单
          }
        }
      }
    }

    // ========== 第6步：更新扫描进度 ==========
    await setLastScannedBlock(toBlock);

    return {
      success: true,
      message: `扫描完成`,
      stats: {
        scannedBlocks: toBlock - fromBlock,
        totalTransfers: totalTransfers,
        matchedOrders: matchedOrders,
        fromBlock,
        toBlock,
      },
    };
  } catch (err) {
    console.error("扫描交易失败:", err);
    // 即使出错也不阻塞，下次触发重试
    return {
      success: false,
      error: err.message,
    };
  }
};

/**
 * 检查并更新汇率（每4小时一次）
 */
async function checkAndUpdateRate() {
  try {
    const lastUpdated = await getRateUpdatedAt();

    if (lastUpdated) {
      const elapsed = Date.now() - new Date(lastUpdated).getTime();
      if (elapsed < RATE_UPDATE_INTERVAL) {
        console.log(
          `汇率无需更新（上次更新: ${lastUpdated}, 已过 ${Math.round(elapsed / 1000 / 60)} 分钟）`
        );
        return;
      }
    }

    console.log("开始更新 USDT 汇率...");
    const rate = await getUSDTRate();
    await setRate(rate);
    console.log(`汇率更新完成: USDT/CNY = ${rate.usdt_cny}`);
  } catch (err) {
    console.warn("汇率更新失败（不影响扫描）:", err.message);
  }
}

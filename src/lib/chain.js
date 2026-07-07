/**
 * BSC 链上操作模块
 * 查询 BEP-20 USDT 交易记录
 */

const { ethers } = require("ethers");

// BEP-20 USDT 合约地址 (BSC)
const USDT_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";

// USDT Transfer 事件签名
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,address,uint256)");

// USDT 精度：18位（虽然名字叫USDT但在BSC上是18位精度）
const USDT_DECIMALS = 18;

// 冷启动优化：在 handler 外部初始化 provider
let provider = null;

function getProvider() {
  if (!provider) {
    const rpcUrl = process.env.BSC_RPC || "https://bsc-dataseed.binance.org/";
    provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return provider;
}

/**
 * 获取当前最新区块号
 */
async function getCurrentBlockNumber() {
  const p = getProvider();
  return await p.getBlockNumber();
}

/**
 * 扫描指定区块范围内的 USDT 转入交易
 *
 * @param {string} targetAddress - 目标钱包地址（小写）
 * @param {number} fromBlock - 起始区块
 * @param {number} toBlock - 结束区块
 * @returns {Array<{txHash, from, amount, blockNumber}>}
 */
async function scanUSDTTransfers(targetAddress, fromBlock, toBlock) {
  const p = getProvider();
  const targetAddr = targetAddress.toLowerCase();

  console.log(
    `扫描 USDT 转入: 地址=${targetAddr}, 区块 ${fromBlock} -> ${toBlock}`
  );

  try {
    // 使用 eth_getLogs 查询 Transfer 事件
    const logs = await p.getLogs({
      address: USDT_CONTRACT,
      topics: [
        TRANSFER_TOPIC,
        null, // 任意 from
        ethers.zeroPadValue(targetAddr, 32), // to = 目标地址
      ],
      fromBlock,
      toBlock,
    });

    console.log(`找到 ${logs.length} 条 Transfer 事件`);

    // 解析日志
    const transfers = [];
    for (const log of logs) {
      // Transfer 事件: indexed address from, indexed address to, uint256 value
      const parsed = ethers.AbiCoder.defaultAbiCoder().decode(
        ["address", "uint256"],
        log.data
      );
      // log.topics[1] = from (indexed), log.topics[2] = to (indexed)
      const from = ethers.getAddress(log.topics[1]).toLowerCase();
      const amount = parseFloat(ethers.formatUnits(parsed[1], USDT_DECIMALS));

      transfers.push({
        from,
        to: targetAddr,
        amount,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      });

      console.log(
        `  转入: ${amount} USDT, tx: ${log.transactionHash}, 区块: ${log.blockNumber}`
      );
    }

    return transfers;
  } catch (err) {
    console.error("扫描 USDT 转账失败:", err.message);

    // 如果区块范围太大，自动缩小
    if (err.message.includes("query returned more than") || 
        err.message.includes("Log response size exceeded")) {
      console.warn("区块范围过大，请减小扫描范围");
    }
    throw err;
  }
}

/**
 * 智能扫描：处理大量区块
 * 自动分批，每批最多 2000 个区块
 */
async function scanUSDTTransfersBatch(targetAddress, fromBlock, toBlock) {
  const MAX_BLOCK_RANGE = 2000;
  const allTransfers = [];

  let currentFrom = fromBlock;
  while (currentFrom <= toBlock) {
    const currentTo = Math.min(currentFrom + MAX_BLOCK_RANGE - 1, toBlock);

    try {
      const transfers = await scanUSDTTransfers(
        targetAddress,
        currentFrom,
        currentTo
      );
      allTransfers.push(...transfers);
    } catch (err) {
      // 如果单批太大，再减半
      if (err.message.includes("query returned more than") ||
          err.message.includes("Log response size exceeded")) {
        const mid = Math.floor((currentFrom + currentTo) / 2);
        const t1 = await scanUSDTTransfers(targetAddress, currentFrom, mid);
        const t2 = await scanUSDTTransfers(targetAddress, mid + 1, currentTo);
        allTransfers.push(...t1, ...t2);
      } else {
        throw err;
      }
    }

    currentFrom = currentTo + 1;
  }

  return allTransfers;
}

/**
 * 确认交易已有足够的区块确认
 * BSC 出块约 3 秒，建议 12 个确认
 */
async function getConfirmations(txHash) {
  const p = getProvider();
  const tx = await p.getTransaction(txHash);
  if (!tx || tx.blockNumber == null) return 0;

  const currentBlock = await p.getBlockNumber();
  return currentBlock - tx.blockNumber + 1;
}

/**
 * 获取 USDT 对 CNY 的汇率
 * 使用 CoinGecko 免费 API（无需 key）
 * 备用：Binance API
 *
 * @returns {Object} { usdt_cny: number, usdt_usd: number, source: string }
 */
async function getUSDTRate() {
  // 优先用 Binance API（更稳定、更新更快）
  try {
    const resp = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=USDTCNY"
    );
    if (resp.ok) {
      const data = await resp.json();
      const cny = parseFloat(data.price);
      console.log(`汇率来源: Binance, USDT/CNY = ${cny}`);
      return { usdt_cny: cny, usdt_usd: 1.0, source: "binance" };
    }
  } catch (e) {
    console.warn("Binance 汇率获取失败，尝试 CoinGecko:", e.message);
  }

  // 备用：CoinGecko
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny,usd"
    );
    if (resp.ok) {
      const data = await resp.json();
      const cny = data.tether.cny;
      const usd = data.tether.usd;
      console.log(`汇率来源: CoinGecko, USDT/CNY = ${cny}, USDT/USD = ${usd}`);
      return { usdt_cny: cny, usdt_usd: usd, source: "coingecko" };
    }
  } catch (e) {
    console.warn("CoinGecko 汇率获取失败:", e.message);
  }

  // 最终兜底：USDT 基本锚定 1 USD，CNY 按 7.2 估算
  console.warn("所有汇率源失败，使用兜底汇率 7.2");
  return { usdt_cny: 7.2, usdt_usd: 1.0, source: "fallback" };
}

module.exports = {
  getCurrentBlockNumber,
  scanUSDTTransfers,
  scanUSDTTransfersBatch,
  getConfirmations,
  getUSDTRate,
  USDT_CONTRACT,
  USDT_DECIMALS,
};

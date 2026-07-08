/**
 * 多链链上操作模块
 * 支持: BSC / Polygon / Ethereum (EVM, ethers getLogs) + TRON (TronGrid API)
 *
 * 统一导出:
 *   getCurrentBlockNumber(chainType)
 *   scanChain(chainType, contractAddr, targetAddr, fromBlock, toBlock) -> [{txHash,from,amount,blockNumber,to}]
 *   getUSDTRate()
 *   CHAIN_CONFIG
 */

const { ethers } = require("ethers");

// ==================== 各链配置 ====================
const CHAIN_CONFIG = {
  bsc: {
    name: "BSC",
    rpc: process.env.BSC_RPC || "https://bsc-dataseed.binance.org/",
    // BEP-20 USDT（BSC 上精度 18）
    usdt: { contract: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    trx: null, // BSC 不支持 TRX
  },
  polygon: {
    name: "Polygon",
    rpc: process.env.POLYGON_RPC || "https://polygon-rpc.com/",
    // Polygon USDC（精度 6）
    usdc: { contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    usdt: { contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
  },
  ethereum: {
    name: "Ethereum",
    rpc: process.env.ETH_RPC || "https://eth.llamarpc.com/",
    // ERC-20 USDC（精度 6）
    usdc: { contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    usdt: { contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  },
  tron: {
    name: "TRON",
    // TronGrid 公共 API（无需 key，有速率限制）
    api: process.env.TRON_API || "https://api.trongrid.io",
    // TRC-20 USDT 合约见下方 TRON_USDT_CONTRACT 常量（精度 6）
    trx: { decimals: 6 },
  },
};

// TRON 主网 TRC-20 USDT 合约
const TRON_USDT_CONTRACT = "TR7NHqjeKQxX5zZHCwMyJtR8GmHj5g3B7B";
// TRON 区块浏览器 API 的基础
const TRONGRID_API = process.env.TRON_API || "https://api.trongrid.io";

// EVM Transfer 事件签名
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

// provider 缓存（按链）
const providers = {};
function getProvider(chainType) {
  if (!providers[chainType]) {
    const cfg = CHAIN_CONFIG[chainType];
    if (!cfg || !cfg.rpc) throw new Error(`链 ${chainType} 未配置 RPC`);
    providers[chainType] = new ethers.JsonRpcProvider(cfg.rpc);
  }
  return providers[chainType];
}

/**
 * 根据 trade_type 解析链类型 + 币类型
 * 例: usdt.bep20 -> {chain:'bsc', coin:'usdt'}, usdc.polygon -> {chain:'polygon', coin:'usdc'},
 *     tron.trx -> {chain:'tron', coin:'trx'}, usdt.trc20 -> {chain:'tron', coin:'usdt'}
 */
function resolveTradeType(tradeType) {
  const t = (tradeType || "").toLowerCase();
  if (t.includes("bep20") || t.includes("bsc")) return { chain: "bsc", coin: t.startsWith("usdc") ? "usdc" : "usdt" };
  if (t.includes("polygon")) return { chain: "polygon", coin: t.startsWith("usdc") ? "usdc" : "usdt" };
  if (t.includes("erc20") || t.includes("ethereum") || t.includes("eth")) return { chain: "ethereum", coin: t.startsWith("usdc") ? "usdc" : "usdt" };
  if (t.includes("trc20") || t.includes("trx") || t.includes("tron")) return { chain: "tron", coin: t.includes("trx") ? "trx" : "usdt" };
  return { chain: "bsc", coin: "usdt" };
}

/**
 * 取某链的合约地址 + 精度
 */
function getTokenMeta(chainType, coin) {
  const cfg = CHAIN_CONFIG[chainType];
  if (!cfg) return null;
  const meta = cfg[coin];
  if (!meta) return null;
  if (chainType === "tron" && coin === "usdt") {
    return { contract: TRON_USDT_CONTRACT, decimals: 6 };
  }
  return meta;
}

// ==================== EVM 扫描 ====================

async function getCurrentBlockNumber(chainType = "bsc") {
  if (chainType === "tron") {
    // TRON 用 /wallet/getnowblock 取 block 高度
    const r = await fetch(`${TRONGRID_API}/wallet/getnowblock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json();
    return j.block_header?.raw_data?.number || 0;
  }
  const p = getProvider(chainType);
  return await p.getBlockNumber();
}

/**
 * EVM 链扫描 Transfer 事件（按合约）
 */
async function scanEvmTransfers(chainType, contractAddr, decimals, targetAddr, fromBlock, toBlock) {
  const p = getProvider(chainType);
  const target = targetAddr.toLowerCase();
  const logs = await p.getLogs({
    address: contractAddr,
    topics: [TRANSFER_TOPIC, null, ethers.zeroPadValue(target, 32)],
    fromBlock,
    toBlock,
  });
  const transfers = [];
  for (const log of logs) {
    const parsed = ethers.AbiCoder.defaultAbiCoder().decode(["address", "uint256"], log.data);
    transfers.push({
      from: ethers.getAddress(log.topics[1]).toLowerCase(),
      to: target,
      amount: parseFloat(ethers.formatUnits(parsed[1], decimals)),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  return transfers;
}

/**
 * TRON 扫描：TRC-20 USDT 转入
 */
async function scanTronUsdtTransfers(targetAddr, fromBlock, toBlock) {
  // TronGrid 查询 TRX 交易 / TRC20 转账事件
  // 这里用 TRC20 合约事件接口
  const url = `${TRONGRID_API}/v1/contracts/${TRON_USDT_CONTRACT}/triggersmartcontract`;
  // 实际上 TronGrid 提供 /v1/accounts/{addr}/transactions/trc20 列出 TRC20 转账
  const listUrl = `${TRONGRID_API}/v1/accounts/${targetAddr}/transactions/trc20?limit=50&contract_address=${TRON_USDT_CONTRACT}`;
  const r = await fetch(listUrl, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`TronGrid 请求失败: ${r.status}`);
  const j = await r.json();
  const transfers = [];
  for (const tx of j.data || []) {
    // tx 结构: { transaction_id, token_info:{symbol,address,decimals,value}, from, to, block_timestamp, block_number }
    if ((tx.to || "").toLowerCase() !== targetAddr.toLowerCase()) continue;
    const decimals = parseInt(tx.token_info?.decimals || "6");
    const amount = parseInt(tx.token_info?.value || "0") / Math.pow(10, decimals);
    transfers.push({
      from: (tx.from || "").toLowerCase(),
      to: targetAddr.toLowerCase(),
      amount,
      txHash: tx.transaction_id,
      blockNumber: tx.block_number || 0,
    });
  }
  return transfers;
}

/**
 * TRON 扫描：TRX（原生）转入
 */
async function scanTronTrxTransfers(targetAddr, fromBlock, toBlock) {
  const listUrl = `${TRONGRID_API}/v1/accounts/${targetAddr}/transactions?limit=50&only_confirmed=true`;
  const r = await fetch(listUrl, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`TronGrid TRX 请求失败: ${r.status}`);
  const j = await r.json();
  const transfers = [];
  for (const tx of j.data || []) {
    const toAddr = tx.to;
    if ((toAddr || "").toLowerCase() !== targetAddr.toLowerCase()) continue;
    const amount = (parseInt(tx.raw_data?.contract?.[0]?.parameter?.value?.amount || "0")) / 1e6;
    transfers.push({
      from: (tx.from || "").toLowerCase(),
      to: targetAddr.toLowerCase(),
      amount,
      txHash: tx.txID,
      blockNumber: tx.blockNumber || 0,
    });
  }
  return transfers;
}

/**
 * 统一扫描入口
 * @param {string} chainType bsc/polygon/ethereum/tron
 * @param {string} coin usdt/usdc/trx/null（null 时根据 chainType 默认）
 * @param {string} targetAddr 目标地址
 * @param {number} fromBlock
 * @param {number} toBlock
 */
async function scanChain(chainType, coin, targetAddr, fromBlock, toBlock) {
  if (chainType === "tron") {
    if (coin === "trx") return await scanTronTrxTransfers(targetAddr, fromBlock, toBlock);
    return await scanTronUsdtTransfers(targetAddr, fromBlock, toBlock);
  }
  const meta = getTokenMeta(chainType, coin || "usdt");
  if (!meta) throw new Error(`链 ${chainType} 不支持币种 ${coin}`);
  return await scanEvmTransfers(chainType, meta.contract, meta.decimals, targetAddr, fromBlock, toBlock);
}

/**
 * 智能分批扫描（EVM 用，避免区块范围过大报错）
 */
async function scanChainBatch(chainType, coin, targetAddr, fromBlock, toBlock) {
  if (chainType === "tron") {
    return await scanChain(chainType, coin, targetAddr, fromBlock, toBlock);
  }
  const MAX = 2000;
  const all = [];
  let cur = fromBlock;
  while (cur <= toBlock) {
    const end = Math.min(cur + MAX - 1, toBlock);
    try {
      const r = await scanChain(chainType, coin, targetAddr, cur, end);
      all.push(...r);
    } catch (e) {
      if (e.message.includes("query returned more than") || e.message.includes("exceeded")) {
        const mid = Math.floor((cur + end) / 2);
        const a = await scanChain(chainType, coin, targetAddr, cur, mid);
        const b = await scanChain(chainType, coin, targetAddr, mid + 1, end);
        all.push(...a, ...b);
      } else throw e;
    }
    cur = end + 1;
  }
  return all;
}

/**
 * 确认交易区块确认数（EVM）
 */
async function getConfirmations(chainType, txHash) {
  if (chainType === "tron") return 999; // TRON 即时确认
  const p = getProvider(chainType);
  const tx = await p.getTransaction(txHash);
  if (!tx || tx.blockNumber == null) return 0;
  const cur = await p.getBlockNumber();
  return cur - tx.blockNumber + 1;
}

// ==================== 汇率 ====================
async function getUSDTRate() {
  try {
    const resp = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=USDTCNY");
    if (resp.ok) {
      const data = await resp.json();
      const cny = parseFloat(data.price);
      console.log(`汇率来源: Binance, USDT/CNY = ${cny}`);
      return { usdt_cny: cny, usdt_usd: 1.0, source: "binance" };
    }
  } catch (e) {
    console.warn("Binance 汇率失败:", e.message);
  }
  try {
    const resp = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny,usd");
    if (resp.ok) {
      const data = await resp.json();
      return { usdt_cny: data.tether.cny, usdt_usd: data.tether.usd, source: "coingecko" };
    }
  } catch (e) {
    console.warn("CoinGecko 汇率失败:", e.message);
  }
  return { usdt_cny: 7.2, usdt_usd: 1.0, source: "fallback" };
}

module.exports = {
  CHAIN_CONFIG,
  resolveTradeType,
  getTokenMeta,
  getCurrentBlockNumber,
  scanChain,
  scanChainBatch,
  scanEvmTransfers,
  scanTronUsdtTransfers,
  scanTronTrxTransfers,
  getConfirmations,
  getUSDTRate,
  // 向后兼容（scan.js 旧调用）
  scanUSDTTransfersBatch: async (addr, from, to) => scanChainBatch("bsc", "usdt", addr, from, to),
};

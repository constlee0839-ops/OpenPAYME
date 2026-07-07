/**
 * BEpusdt MD5 签名工具
 *
 * 签名规则：
 * 1. 筛选所有非空且非 signature 的参数
 * 2. 按参数名 ASCII 字典序排序
 * 3. 拼接为 key=value&key=value 格式
 * 4. 末尾直接追加 API Token（无 & 分隔符）
 * 5. MD5 加密，结果转小写
 */

const crypto = require("crypto");

/**
 * 生成签名
 * @param {Object} params - 请求参数（不含 signature）
 * @param {string} apiToken - API 认证令牌
 * @returns {string} MD5 签名（小写）
 */
function sign(params, apiToken) {
  // 筛选非空、非 signature 的参数
  const filtered = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "signature") continue;
    if (value === null || value === undefined || value === "") continue;
    // boolean 转 true/false 小写字符串
    if (typeof value === "boolean") {
      filtered[key] = value ? "true" : "false";
    } else {
      filtered[key] = String(value);
    }
  }

  // 按 ASCII 字典序排序
  const sortedKeys = Object.keys(filtered).sort();

  // 拼接 key=value&key=value
  const parts = sortedKeys.map((key) => `${key}=${filtered[key]}`);
  const signStr = parts.join("&");

  // 末尾追加 API Token（无 & 分隔符）
  const finalStr = signStr + apiToken;

  // MD5 加密转小写
  return crypto.createHash("md5").update(finalStr, "utf8").digest("hex");
}

/**
 * 验证签名
 * @param {Object} params - 完整请求参数（含 signature）
 * @param {string} apiToken - API 认证令牌
 * @returns {boolean} 签名是否正确
 */
function verify(params, apiToken) {
  if (!params.signature) return false;
  const expected = sign(params, apiToken);
  return params.signature === expected;
}

module.exports = { sign, verify };

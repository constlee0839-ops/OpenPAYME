/**
 * 飞书通知模块（两种接入方式，Webhook 优先）
 *
 * 方式一（优先）：群自定义机器人 Webhook
 *   环境变量：FEISHU_WEBHOOK（机器人地址）+ FEISHU_SECRET（签名密钥，可选）
 *   开启签名验证时按飞书算法加 timestamp + sign 头字段
 *
 * 方式二（fallback）：自建应用 API
 *   环境变量：FEISHU_APP_ID + FEISHU_APP_SECRET + FEISHU_CHAT_ID（可选，自动发现群）
 *
 * 凭证全部存 Lambda 环境变量，绝不写死在代码/仓库。
 * 未配置任何凭证时所有函数静默返回 false，不影响主流程。
 */

const crypto = require("crypto");
const db = require("./db");

let _appToken = null;
let _appTokenExpire = 0;

// ===== 方式一：群自定义机器人 Webhook（优先）=====
async function sendByWebhook(title, lines) {
  // 优先使用 config 表中用户后台配置的 webhook（如果有），否则 fallback 到环境变量
  let url = await db.getConfig('feishu_webhook') || process.env.FEISHU_WEBHOOK;
  let secret = await db.getConfig('feishu_secret') || process.env.FEISHU_SECRET || "";
  if (!url) return null; // 未配置任何来源
  const text =
    "【OpenPAYME】\n" +
    (title || "") +
    "\n" +
    (Array.isArray(lines) ? lines.join("\n") : lines || "");
  const body = { msg_type: "text", content: { text } };
  // 签名验证：timestamp + "\n" + secret 做 HMAC-SHA256，Base64 输出
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const stringToSign = timestamp + "\n" + secret;
    body.timestamp = String(timestamp);
    body.sign = crypto.createHmac("sha256", secret).update(stringToSign).digest("base64");
  }
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await resp.json();
    if (j.code !== 0) {
      console.error("[feishu] webhook 发送失败:", JSON.stringify(j));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[feishu] webhook 异常:", e.message);
    return false;
  }
}

// ===== 方式二：自建应用 API（fallback）=====
async function getTenantToken() {
  const now = Date.now();
  if (_appToken && now < _appTokenExpire) return _appToken;
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    console.log("[feishu] 未配置 FEISHU_APP_ID/SECRET，跳过应用通知");
    return null;
  }
  try {
    const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const j = await resp.json();
    if (j.code !== 0) {
      console.error("[feishu] 获取 tenant_token 失败:", JSON.stringify(j));
      return null;
    }
    _appToken = j.tenant_access_token;
    _appTokenExpire = now + (j.expire - 300) * 1000;
    return _appToken;
  } catch (e) {
    console.error("[feishu] 获取 tenant_token 异常:", e.message);
    return null;
  }
}

async function resolveChatId(token) {
  const cfg = process.env.FEISHU_CHAT_ID;
  if (cfg) return cfg;
  try {
    const resp = await fetch("https://open.feishu.cn/open-apis/im/v1/chats?page_size=50", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });
    const j = await resp.json();
    if (j.code === 0 && j.data && j.data.items && j.data.items.length) {
      return j.data.items[0].chat_id;
    }
  } catch (e) {
    console.error("[feishu] 自动发现群失败:", e.message);
  }
  return null;
}

async function sendByApp(title, lines, token, chatId) {
  const text =
    "【OpenPAYME】\n" +
    (title || "") +
    "\n" +
    (Array.isArray(lines) ? lines.join("\n") : lines || "");
  const resp = await fetch(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    }
  );
  const j = await resp.json();
  if (j.code !== 0) {
    console.error("[feishu] 应用发送失败:", JSON.stringify(j));
    return false;
  }
  return true;
}

/**
 * 发送飞书文本消息（Webhook 优先，自建应用 fallback）
 * @param {string} title 标题
 * @param {string[]} contentLines 内容行数组
 * @returns {Promise<boolean>} 是否成功
 */
async function sendFeishu(title, contentLines) {
  try {
    const wh = await sendByWebhook(title, contentLines);
    if (wh === true) return true; // webhook 成功，直接返回
    if (wh === false) console.warn("[feishu] webhook 发送失败，尝试自建应用 fallback");
    // wh===null(未配置 webhook) 或 wh===false(webhook 失败) => fallback 自建应用
    const token = await getTenantToken();
    if (!token) return false;
    const chatId = await resolveChatId(token);
    if (!chatId) return false;
    return await sendByApp(title, contentLines, token, chatId);
  } catch (e) {
    console.error("[feishu] 异常:", e.message);
    return false;
  }
}

module.exports = { sendFeishu, getTenantToken };

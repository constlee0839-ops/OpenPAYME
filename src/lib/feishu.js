/**
 * 飞书自建应用通知模块
 *
 * 凭证从 Lambda 环境变量读取（绝不写死在代码/仓库）：
 *   FEISHU_APP_ID     自建应用 App ID（形如 cli_xxxx）
 *   FEISHU_APP_SECRET 自建应用 App Secret
 *   FEISHU_CHAT_ID    目标群 chat_id（可选；不填则自动发现机器人所在第一个群）
 *
 * 通知场景：收款成功 / 管理员补单 / 系统异常
 * 未配置凭证时所有函数静默返回 false，不影响主流程。
 */

let _token = null;
let _tokenExpire = 0;

async function getTenantToken() {
  const now = Date.now();
  if (_token && now < _tokenExpire) return _token;
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    console.log('[feishu] 未配置 FEISHU_APP_ID/SECRET，跳过通知');
    return null;
  }
  try {
    const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const j = await resp.json();
    if (j.code !== 0) {
      console.error('[feishu] 获取 tenant_token 失败:', JSON.stringify(j));
      return null;
    }
    _token = j.tenant_access_token;
    _tokenExpire = now + (j.expire - 300) * 1000; // 提前5分钟过期，避免临界失效
    return _token;
  } catch (e) {
    console.error('[feishu] 获取 tenant_token 异常:', e.message);
    return null;
  }
}

async function resolveChatId(token) {
  const cfg = process.env.FEISHU_CHAT_ID;
  if (cfg) return cfg;
  // 未配置则自动发现机器人（自建应用）所在群，取第一个
  try {
    const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=50', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
    });
    const j = await resp.json();
    if (j.code === 0 && j.data && j.data.items && j.data.items.length) {
      return j.data.items[0].chat_id;
    }
  } catch (e) {
    console.error('[feishu] 自动发现群失败:', e.message);
  }
  return null;
}

/**
 * 发送飞书文本消息
 * @param {string} title 标题（会加在消息开头）
 * @param {string[]} contentLines 内容行数组
 * @returns {Promise<boolean>} 是否成功
 */
async function sendFeishu(title, contentLines) {
  try {
    const token = await getTenantToken();
    if (!token) return false;
    const chatId = await resolveChatId(token);
    if (!chatId) {
      console.warn('[feishu] 未配置 FEISHU_CHAT_ID 且无机器人所在群，无法发送');
      return false;
    }
    const text =
      '【OpenPAYME】\n' +
      (title || '') +
      '\n' +
      (Array.isArray(contentLines) ? contentLines.join('\n') : contentLines || '');
    const resp = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        }),
      }
    );
    const j = await resp.json();
    if (j.code !== 0) {
      console.error('[feishu] 发送失败:', JSON.stringify(j));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[feishu] 发送异常:', e.message);
    return false;
  }
}

module.exports = { sendFeishu, getTenantToken };

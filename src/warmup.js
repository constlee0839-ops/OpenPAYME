/**
 * Lambda 保活函数
 * 每5分钟由 EventBridge 触发一次，保持 Lambda 不冷启动
 */

exports.handler = async (event) => {
  console.log("保活触发:", new Date().toISOString());

  // 执行一个简单的数据库查询来保持连接
  try {
    const { createClient } = require("@libsql/client");
    const db = createClient({
      url: process.env.TURSO_URL || "libsql://bepusdt-const.aws-ap-northeast-1.turso.io",
      authToken: process.env.TURSO_TOKEN || "TURSO_TOKEN_REDACTED",
    });
    await db.execute("SELECT 1");
    await db.close();
    console.log("数据库连接正常");
  } catch (err) {
    console.warn("保活查询失败:", err.message);
  }

  return { statusCode: 200, body: "warm" };
};

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
      authToken: process.env.TURSO_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODM0MzYwMzAsImlkIjoiMDE5ZjNkMGYtZGQwMS03NzY1LTg2YjEtNDYwZDNkZmZlNmI5Iiwia2lkIjoiNjZ4SllYQnRBSGMxSWVsbTQ2cmpENkh1Z292b2dFdDMxNFZiRmU2Y21NYyIsInJpZCI6Ijk0NGQ4NDcwLTEzMmItNDJhNC05ZmZiLTU0NGZlODM1NTY5NCJ9.OS9v7two881_6OvCqcF7_dB8rxNfSzSwuePu2hhN2N-9Dsmd9loF618up_tB14vswCB6m--SE_It1XvkvFBeAQ",
    });
    await db.execute("SELECT 1");
    await db.close();
    console.log("数据库连接正常");
  } catch (err) {
    console.warn("保活查询失败:", err.message);
  }

  return { statusCode: 200, body: "warm" };
};

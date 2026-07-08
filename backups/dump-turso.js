/**
 * Turso 数据库备份导出脚本
 * 导出所有表的结构(SQL) + 数据(JSON) 到 backups/<date>/ 目录
 * 用法: node backups/dump-turso.js
 */
const { createClient } = require("@libsql/client");
const fs = require("fs");
const path = require("path");

const TURSO_URL = process.env.TURSO_URL || "libsql://bepusdt-const.aws-ap-northeast-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_TOKEN || "TURSO_TOKEN_REDACTED";

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

const OUT_DIR = path.join(__dirname, "2026-07-08");
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  try {
    // 1. 列出所有表
    const tablesRes = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tables = tablesRes.rows.map((r) => r.name);
    console.log("发现表:", tables.join(", "));

    const schemaLines = [];
    const dataAll = {};

    for (const t of tables) {
      // 2. 表结构
      const sch = await client.execute(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='${t}'`
      );
      const createSql = sch.rows[0]?.sql || "";
      schemaLines.push(`-- ===== 表 ${t} =====\n${createSql};\n`);

      // 3. 数据
      const rows = await client.execute(`SELECT * FROM "${t}"`);
      dataAll[t] = rows.rows;
      console.log(`  表 ${t}: ${rows.rows.length} 行`);
    }

    // 写 schema SQL
    fs.writeFileSync(
      path.join(OUT_DIR, "schema.sql"),
      schemaLines.join("\n") + "\n",
      "utf8"
    );

    // 写数据 JSON
    fs.writeFileSync(
      path.join(OUT_DIR, "data.json"),
      JSON.stringify(dataAll, null, 2),
      "utf8"
    );

    // 写恢复脚本
    const restoreSql = [];
    for (const t of tables) {
      const rows = dataAll[t];
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `"${c}"`).join(", ");
      for (const row of rows) {
        const vals = cols
          .map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return "NULL";
            if (typeof v === "number") return String(v);
            return `'${String(v).replace(/'/g, "''")}'`;
          })
          .join(", ");
        restoreSql.push(
          `INSERT OR IGNORE INTO "${t}" (${colList}) VALUES (${vals});`
        );
      }
    }
    fs.writeFileSync(
      path.join(OUT_DIR, "restore-data.sql"),
      restoreSql.join("\n") + "\n",
      "utf8"
    );

    console.log("\n✅ 备份完成:");
    console.log("  " + path.join(OUT_DIR, "schema.sql"));
    console.log("  " + path.join(OUT_DIR, "data.json"));
    console.log("  " + path.join(OUT_DIR, "restore-data.sql"));
    console.log("\n恢复方法: 在目标库执行 schema.sql 建表，再执行 restore-data.sql 灌数据");
  } catch (e) {
    console.error("备份失败:", e.message);
    process.exit(1);
  } finally {
    client.close();
  }
})();

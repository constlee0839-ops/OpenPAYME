/**
 * Lambda: queryOrder
 * 查询订单状态
 *
 * 触发方式: API Gateway (GET /orders/{orderId})
 *
 * 如果订单状态为 PENDING，会顺便触发一次扫描（5秒超时）
 */

const { getOrder, getRate } = require("./lib/db");

exports.handler = async (event) => {
  console.log("queryOrder 被调用, event:", JSON.stringify(event));

  try {
    // 从路径参数或查询参数中获取 orderId
    let orderId;

    if (event.pathParameters && event.pathParameters.orderId) {
      orderId = event.pathParameters.orderId;
    } else if (event.queryStringParameters && event.queryStringParameters.orderId) {
      orderId = event.queryStringParameters.orderId;
    } else if (event.orderId) {
      orderId = event.orderId;
    } else {
      return buildResponse(400, { error: "缺少订单ID" });
    }

    const order = await getOrder(orderId);

    if (!order) {
      return buildResponse(404, {
        error: "订单不存在",
        orderId,
      });
    }

    // 如果订单还在 PENDING，触发一次扫描看是否已到账
    if (order.status === "PENDING") {
      try {
        const { handler: scanHandler } = require("./scanTransactions");
        await Promise.race([
          scanHandler({ source: "queryOrder", orderId }),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);

        // 重新查询订单状态（扫描可能已更新状态）
        const updatedOrder = await getOrder(orderId);
        if (updatedOrder) {
          const rate = await getRate();
          return buildResponse(200, {
            success: true,
            order: formatOrder(updatedOrder),
            rate: rate
              ? { usdt_cny: rate.usdt_cny, source: rate.source, updatedAt: rate.updatedAt }
              : null,
          });
        }
      } catch (scanErr) {
        console.warn("查询触发扫描失败（不影响查询）:", scanErr.message);
      }
    }

    const rate = await getRate();
    return buildResponse(200, {
      success: true,
      order: formatOrder(order),
      rate: rate
        ? { usdt_cny: rate.usdt_cny, source: rate.source, updatedAt: rate.updatedAt }
        : null,
    });
  } catch (err) {
    console.error("查询订单失败:", err);
    return buildResponse(500, { error: `查询失败: ${err.message}` });
  }
};

function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(body),
  };
}

function formatOrder(order) {
  return {
    orderId: order.orderId,
    walletAddress: order.walletAddress,
    expectedAmount: order.expectedAmount,
    actualAmount: order.actualAmount || 0,
    status: order.status,
    txHash: order.txHash || "",
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt || "",
  };
}

// Nghiệp vụ đơn nghi gian lận: tìm (ĐỌC) và tạm giữ đơn (GHI).
import { ok, fail, formatVnd, formatTime, ordersInNight, cleanText, recordAudit } from "./common.js";

// Cùng 1 SĐT đặt ≥ 3 đơn COD trong 1 đêm với tổng ≥ 20 triệu -> nghi gian lận (bom hàng / đặt hộ).
export const FRAUD_RULE = { minOrders: 3, minTotal: 20_000_000 };
export const MAX_HOLD_PER_CALL = 20;
const HOLDABLE_STATUS = "CHO_XU_LY"; // chỉ giữ được đơn chưa đóng gói

export function findSuspiciousOrders(db) {
    const byPhone = new Map();
    for (const order of ordersInNight(db, db.reportDate)) {
        if (order.paymentMethod !== "COD") continue;
        if (!byPhone.has(order.customerPhone)) byPhone.set(order.customerPhone, []);
        byPhone.get(order.customerPhone).push(order);
    }

    const groups = [];
    for (const [phone, orders] of byPhone) {
        const total = orders.reduce((sum, o) => sum + o.amount, 0);
        if (orders.length < FRAUD_RULE.minOrders || total < FRAUD_RULE.minTotal) continue;
        const addresses = new Set(orders.map((o) => o.shippingAddress));
        groups.push({
            customerPhone: phone,
            orderCount: orders.length,
            total: formatVnd(total),
            distinctAddresses: addresses.size,
            reason: `${orders.length} đơn COD trong 1 đêm, tổng ${formatVnd(total)}, giao tới ${addresses.size} địa chỉ khác nhau`,
            orders: orders.map((o) => ({
                orderId: o.orderId,
                time: formatTime(o.createdAt),
                sku: o.sku,
                amount: formatVnd(o.amount),
                address: o.shippingAddress,
                status: o.status,
            })),
        });
    }

    return ok(
        "SUSPICIOUS_ORDERS",
        groups.length ? `Có ${groups.length} nhóm đơn nghi gian lận.` : "Không có đơn nào nghi gian lận.",
        { rule: `≥ ${FRAUD_RULE.minOrders} đơn COD cùng SĐT trong đêm, tổng ≥ ${formatVnd(FRAUD_RULE.minTotal)}`, groups },
    );
}

// ---------- GHI: tạm giữ đơn ----------

function planHold(db, args) {
    if (!Array.isArray(args.orderIds) || args.orderIds.length === 0) {
        return { error: fail("INVALID_ARGUMENT", "Cần danh sách mã đơn (orderIds) cần tạm giữ.") };
    }
    const orderIds = [...new Set(args.orderIds.map((id) => (typeof id === "string" ? id.trim().toUpperCase() : "")))];
    if (orderIds.length > MAX_HOLD_PER_CALL) {
        return { error: fail("TOO_MANY_ORDERS", `Mỗi lần chỉ giữ tối đa ${MAX_HOLD_PER_CALL} đơn.`) };
    }
    const missing = orderIds.filter((id) => !db.orders.has(id));
    if (missing.length) return { error: fail("ORDER_NOT_FOUND", `Không tìm thấy đơn: ${missing.map((id) => id || "(trống)").join(", ")}.`) };

    // Tất cả hoặc không: một đơn không hợp lệ thì không giữ đơn nào, tránh xử lý nửa vời.
    const orders = orderIds.map((id) => db.orders.get(id));
    const notHoldable = orders.filter((o) => o.status !== HOLDABLE_STATUS);
    if (notHoldable.length) {
        return { error: fail("NOT_HOLDABLE", `Không giữ được vì đơn không ở trạng thái chờ xử lý: ${notHoldable.map((o) => `${o.orderId} (${o.status})`).join(", ")}.`) };
    }
    const reason = cleanText(args.reason);
    if (!reason) return { error: fail("MISSING_REASON", "Cần nêu lý do tạm giữ để ghi nhật ký.") };

    return { plan: { orderIds, reason, total: orders.reduce((sum, o) => sum + o.amount, 0) } };
}

export function previewHoldOrders(db, args) {
    const { plan, error } = planHold(db, args);
    if (error) return error;
    return ok(
        "NEEDS_CONFIRMATION",
        `TẠM GIỮ ${plan.orderIds.length} đơn (tổng ${formatVnd(plan.total)}): ${plan.orderIds.join(", ")}. Kho sẽ không đóng gói/giao các đơn này cho tới khi bỏ giữ. Lý do: ${plan.reason}.`,
        { ...plan, total: formatVnd(plan.total) },
    );
}

export function holdOrders(db, args) {
    const { plan, error } = planHold(db, args);
    if (error) return error;
    for (const id of plan.orderIds) {
        const order = db.orders.get(id);
        order.status = "TAM_GIU";
        order.holdReason = plan.reason;
    }
    recordAudit(db, "HOLD_ORDERS", { orderIds: plan.orderIds, reason: plan.reason });
    return ok("ORDERS_HELD", `Đã tạm giữ ${plan.orderIds.length} đơn: ${plan.orderIds.join(", ")}.`, { orderIds: plan.orderIds, status: "TAM_GIU" });
}

// Chạy: npm test - kiểm tra tầng NGHIỆP VỤ, không dính tới AI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/data/seed.js";
import { getOvernightReport } from "../src/services/reportService.js";
import { getPaymentFailures, previewSetGatewayStatus, setGatewayStatus } from "../src/services/paymentService.js";
import { getStockAlerts, previewCreateRestockOrder, createRestockOrder } from "../src/services/inventoryService.js";
import { findSuspiciousOrders, previewHoldOrders, holdOrders } from "../src/services/orderService.js";

const fraudOrderIds = (db) => findSuspiciousOrders(db).data.groups[0].orders.map((o) => o.orderId);

// ---------- Tool tổng hợp ----------

test("dữ liệu sinh ổn định: 2 lần tạo ra cùng kết quả", () => {
    assert.deepEqual(getOvernightReport(createDb()), getOvernightReport(createDb()));
});

test("báo cáo đêm qua tìm đủ 3 sự cố cài sẵn, mức cao xếp trước", () => {
    const { data } = getOvernightReport(createDb());
    const titles = data.anomalies.map((a) => `${a.severity} ${a.type} ${a.title}`);
    assert.ok(titles.some((t) => t.startsWith("HIGH PAYMENT") && t.includes("VNPAY")), titles.join("\n"));
    assert.ok(titles.some((t) => t.startsWith("HIGH STOCK") && t.includes("SP012")));
    assert.ok(titles.some((t) => t.startsWith("HIGH FRAUD") && t.includes("0912000111")));
    assert.ok(!titles.some((t) => t.includes("MOMO") || t.includes("THE ")), "cổng bình thường không bị báo nhầm");
    const severities = data.anomalies.map((a) => a.severity);
    assert.deepEqual(severities, [...severities].sort((a, b) => (a === b ? 0 : a === "HIGH" ? -1 : 1)));
});

test("7 đêm trước đó không có bất thường nào (không báo động giả)", () => {
    const db = createDb();
    for (const date of ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]) {
        assert.deepEqual(getOvernightReport(db, { date }).data.anomalies, [], date);
    }
});

test("ngày sai / ngoài phạm vi / sai kiểu -> báo lỗi, không throw", () => {
    const db = createDb();
    for (const date of ["hôm qua", "2026-13-01", "2026-02-30", "08/10/2026", 123, {}, []]) {
        assert.equal(getOvernightReport(db, { date }).code, "INVALID_DATE", JSON.stringify(date));
    }
    for (const date of ["2026-09-30", "2026-10-09"]) {
        assert.equal(getOvernightReport(db, { date }).code, "DATE_OUT_OF_RANGE", date);
    }
    assert.equal(getOvernightReport(db).data.date, "2026-10-08");
    assert.equal(getOvernightReport(db, undefined).ok, true);
});

// ---------- Đọc chi tiết ----------

test("lỗi thanh toán: VNPAY bắt đầu lỗi khung 01:00, chủ yếu GATEWAY_TIMEOUT", () => {
    const [vnpay] = getPaymentFailures(createDb(), { gateway: " vnpay " }).data.gateways;
    assert.equal(vnpay.isAnomaly, true);
    assert.equal(vnpay.spikeStartedAt, "01:00");
    assert.ok(vnpay.failureCodes.GATEWAY_TIMEOUT > 30);
    assert.equal(getPaymentFailures(createDb(), { gateway: "PAYPAL" }).code, "INVALID_GATEWAY");
    assert.equal(getPaymentFailures(createDb()).data.gateways.length, 3);
});

test("tồn kho: SP012 khẩn cấp đứng đầu, SP007 dưới điểm đặt hàng, hàng còn nhiều không bị báo", () => {
    const { alerts } = getStockAlerts(createDb()).data;
    assert.deepEqual(alerts.map((a) => [a.sku, a.level]), [["SP012", "HIGH"], ["SP007", "MEDIUM"]]);
    assert.ok(alerts[0].hoursLeftAtLastNightPace < 1);
});

test("gian lận: đúng 1 nhóm, 4 đơn COD của SĐT 0912000111", () => {
    const { groups } = findSuspiciousOrders(createDb()).data;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].customerPhone, "0912000111");
    assert.equal(groups[0].orderCount, 4);
});

// ---------- Ghi: cổng thanh toán ----------

test("preview tắt cổng KHÔNG đổi dữ liệu; set mới đổi và ghi nhật ký", () => {
    const db = createDb();
    const args = { gateway: "VNPAY", enabled: false, reason: "Lỗi GATEWAY_TIMEOUT từ 01:00" };
    assert.equal(previewSetGatewayStatus(db, args).code, "NEEDS_CONFIRMATION");
    assert.equal(db.gateways.get("VNPAY").enabled, true);
    assert.equal(db.auditLog.length, 0);

    assert.equal(setGatewayStatus(db, args).code, "GATEWAY_UPDATED");
    assert.equal(db.gateways.get("VNPAY").enabled, false);
    assert.equal(db.auditLog.length, 1);
    assert.equal(setGatewayStatus(db, args).code, "ALREADY_IN_STATE");
});

test("không cho tắt cổng online cuối cùng; tham số sai bị chặn", () => {
    const db = createDb();
    setGatewayStatus(db, { gateway: "VNPAY", enabled: false, reason: "x" });
    setGatewayStatus(db, { gateway: "MOMO", enabled: false, reason: "x" });
    assert.equal(previewSetGatewayStatus(db, { gateway: "THE", enabled: false, reason: "x" }).code, "LAST_ONLINE_GATEWAY");
    assert.equal(previewSetGatewayStatus(db, { gateway: "COD", enabled: false, reason: "x" }).code, "INVALID_GATEWAY");
    assert.equal(previewSetGatewayStatus(db, { gateway: "THE", enabled: "false", reason: "x" }).code, "INVALID_ARGUMENT");
    assert.equal(previewSetGatewayStatus(db, { gateway: "VNPAY", enabled: true, reason: "   " }).code, "MISSING_REASON");
});

// ---------- Ghi: phiếu nhập hàng ----------

test("phiếu nhập: preview không tạo; tạo xong thì chặn tạo trùng", () => {
    const db = createDb();
    assert.equal(previewCreateRestockOrder(db, { sku: "sp012", quantity: 150 }).code, "NEEDS_CONFIRMATION");
    assert.equal(db.restockOrders.length, 0);

    const created = createRestockOrder(db, { sku: "SP012", quantity: "150" });
    assert.equal(created.code, "RESTOCK_CREATED");
    assert.equal(created.data.restockId, "PN-0001");
    assert.equal(createRestockOrder(db, { sku: "SP012", quantity: 10 }).code, "DUPLICATE_PENDING");
    assert.equal(getStockAlerts(db).data.alerts[0].pendingRestock, "PN-0001");
});

test("phiếu nhập: số lượng / mã sản phẩm sai bị chặn", () => {
    const db = createDb();
    for (const quantity of [0, -5, 1.5, 999_999, "abc", "", null, undefined]) {
        assert.equal(previewCreateRestockOrder(db, { sku: "SP012", quantity }).code, "INVALID_QUANTITY", JSON.stringify(quantity));
    }
    assert.equal(previewCreateRestockOrder(db, { sku: "SP999", quantity: 10 }).code, "UNKNOWN_SKU");
    assert.equal(previewCreateRestockOrder(db, {}).code, "UNKNOWN_SKU");
});

// ---------- Ghi: tạm giữ đơn ----------

test("tạm giữ: preview không đổi; giữ xong không giữ lại lần 2", () => {
    const db = createDb();
    const orderIds = fraudOrderIds(db);
    assert.equal(previewHoldOrders(db, { orderIds, reason: "Nghi bom hàng" }).code, "NEEDS_CONFIRMATION");
    assert.ok(orderIds.every((id) => db.orders.get(id).status === "CHO_XU_LY"));

    assert.equal(holdOrders(db, { orderIds, reason: "Nghi bom hàng" }).code, "ORDERS_HELD");
    assert.ok(orderIds.every((id) => db.orders.get(id).status === "TAM_GIU"));
    assert.equal(holdOrders(db, { orderIds, reason: "Nghi bom hàng" }).code, "NOT_HOLDABLE");
});

test("tạm giữ: tất cả hoặc không - 1 mã sai thì không giữ đơn nào", () => {
    const db = createDb();
    const orderIds = [...fraudOrderIds(db), "DH999999"];
    assert.equal(holdOrders(db, { orderIds, reason: "x" }).code, "ORDER_NOT_FOUND");
    assert.ok(fraudOrderIds(db).every((id) => db.orders.get(id).status === "CHO_XU_LY"));
});

test("tạm giữ: tham số sai bị chặn", () => {
    const db = createDb();
    const ids = fraudOrderIds(db);
    assert.equal(previewHoldOrders(db, { orderIds: [], reason: "x" }).code, "INVALID_ARGUMENT");
    assert.equal(previewHoldOrders(db, { orderIds: "DH105678", reason: "x" }).code, "INVALID_ARGUMENT");
    assert.equal(previewHoldOrders(db, { orderIds: Array.from({ length: 21 }, (_, i) => `DH${100001 + i}`), reason: "x" }).code, "TOO_MANY_ORDERS");
    assert.equal(previewHoldOrders(db, { orderIds: ids, reason: "" }).code, "MISSING_REASON");
    assert.equal(previewHoldOrders(db, { orderIds: ["DH100001"], reason: "x" }).code, "NOT_HOLDABLE"); // đơn cũ đã giao
});

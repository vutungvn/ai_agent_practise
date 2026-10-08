// Tool TỔNG HỢP: so sánh 1 đêm với trung bình 7 đêm trước, gom mọi bất thường thành 1 báo cáo.
// Số liệu tính bằng code; model chỉ đọc và diễn giải, không tự cộng trừ.
import { ONLINE_GATEWAYS, addDays } from "../data/seed.js";
import { ok, fail, formatVnd, formatPercent, round, describeWindow, ordersInNight, baselineDates, BASELINE_NIGHTS } from "./common.js";
import { gatewayStats, baselineFailureRate, isFailureAnomaly } from "./paymentService.js";
import { getStockAlerts } from "./inventoryService.js";
import { findSuspiciousOrders } from "./orderService.js";

export const MAX_DAYS_BACK = 7;
// Doanh thu dao động tự nhiên ~±25%/đêm (vài đơn điện thoại 9,5 triệu kéo lệch), nên chỉ báo khi giảm > 30%.
const DROP_THRESHOLD = -0.3;

export function resolveReportDate(db, raw) {
    if (raw === undefined || raw === null || raw === "") return { date: db.reportDate };
    const earliest = addDays(db.reportDate, -MAX_DAYS_BACK);
    const range = `Em có dữ liệu cho đêm của các sáng từ ${earliest} đến ${db.reportDate}.`;
    const date = typeof raw === "string" ? raw.trim() : "";
    // So khớp lại sau khi parse để loại ngày không có thật như 2026-02-30.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
        return { error: fail("INVALID_DATE", `Ngày "${raw}" không hợp lệ, cần dạng YYYY-MM-DD. ${range}`) };
    }
    if (date > db.reportDate || date < earliest) return { error: fail("DATE_OUT_OF_RANGE", range) };
    return { date };
}

function summarize(orders) {
    const paid = orders.filter((o) => o.paymentStatus === "SUCCESS");
    return { orders: orders.length, paidOrders: paid.length, revenue: paid.reduce((sum, o) => sum + o.amount, 0) };
}

const change = (now, base) => (base ? (now - base) / base : 0);
const signed = (ratio) => `${ratio >= 0 ? "+" : ""}${formatPercent(ratio)}`;

export function getOvernightReport(db, { date: rawDate } = {}) {
    const { date, error } = resolveReportDate(db, rawDate);
    if (error) return error;

    const tonightOrders = ordersInNight(db, date);
    const tonight = summarize(tonightOrders);
    const baseNights = baselineDates(date).map((d) => summarize(ordersInNight(db, d)));
    const avg = (key) => baseNights.reduce((sum, night) => sum + night[key], 0) / baseNights.length;
    const baseline = { orders: avg("orders"), paidOrders: avg("paidOrders"), revenue: avg("revenue") };

    const anomalies = [];

    const gateways = ONLINE_GATEWAYS.map((gateway) => {
        const stats = gatewayStats(tonightOrders, gateway);
        const baseRate = baselineFailureRate(db, date, gateway);
        if (isFailureAnomaly(stats, baseRate)) {
            anomalies.push({
                severity: "HIGH",
                type: "PAYMENT",
                title: `Cổng ${gateway} lỗi bất thường`,
                detail: `${stats.failed}/${stats.attempts} giao dịch thất bại (${formatPercent(stats.rate)}), bình thường ${formatPercent(baseRate)}.`,
                nextStep: "get_payment_failures để xem lỗi từ mấy giờ; có thể tạm tắt cổng bằng set_payment_gateway_status.",
            });
        }
        return { gateway, attempts: stats.attempts, failed: stats.failed, failureRate: formatPercent(stats.rate), normalFailureRate: formatPercent(baseRate) };
    });

    for (const [key, label] of [["revenue", "Doanh thu"], ["paidOrders", "Số đơn thanh toán thành công"]]) {
        const ratio = change(tonight[key], baseline[key]);
        if (ratio <= DROP_THRESHOLD) {
            anomalies.push({ severity: "MEDIUM", type: "SALES", title: `${label} giảm mạnh`, detail: `${signed(ratio)} so với trung bình ${BASELINE_NIGHTS} đêm trước.`, nextStep: "Kiểm tra lỗi thanh toán trước." });
        }
    }

    // Tồn kho và đơn chờ xử lý là trạng thái HIỆN TẠI, chỉ có ý nghĩa với đêm gần nhất.
    if (date === db.reportDate) {
        for (const alert of getStockAlerts(db).data.alerts) {
            anomalies.push({
                severity: alert.level,
                type: "STOCK",
                title: `${alert.name} (${alert.sku}) sắp hết hàng`,
                detail: `Còn ${alert.stock}, đêm qua bán ${alert.soldLastNight} (TB ${alert.avgSoldPerNight}/đêm)` +
                    (alert.hoursLeftAtLastNightPace !== null ? `, hết sau ~${alert.hoursLeftAtLastNightPace} giờ theo tốc độ đêm qua.` : "."),
                nextStep: alert.pendingRestock ? `Đã có phiếu nhập ${alert.pendingRestock}.` : `Có thể tạo phiếu nhập ${alert.suggestedQuantity} cái bằng create_restock_order.`,
            });
        }
        for (const group of findSuspiciousOrders(db).data.groups) {
            anomalies.push({
                severity: "HIGH",
                type: "FRAUD",
                title: `SĐT ${group.customerPhone} nghi gian lận`,
                detail: `${group.reason}.`,
                nextStep: `Có thể tạm giữ các đơn ${group.orders.map((o) => o.orderId).join(", ")} bằng hold_orders.`,
            });
        }
    }
    anomalies.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "HIGH" ? -1 : 1));

    return ok(
        "OVERNIGHT_REPORT",
        anomalies.length
            ? `Đêm ${date}: ${anomalies.length} bất thường (${anomalies.filter((a) => a.severity === "HIGH").length} mức cao).`
            : `Đêm ${date}: không có bất thường.`,
        {
            date,
            window: describeWindow(date),
            totals: {
                orders: tonight.orders,
                paidOrders: tonight.paidOrders,
                revenue: formatVnd(tonight.revenue),
                vsBaseline: { orders: signed(change(tonight.orders, baseline.orders)), revenue: signed(change(tonight.revenue, baseline.revenue)) },
            },
            baselineAverage: { nights: BASELINE_NIGHTS, orders: round(baseline.orders), revenue: formatVnd(baseline.revenue) },
            gateways,
            anomalies,
        },
    );
}

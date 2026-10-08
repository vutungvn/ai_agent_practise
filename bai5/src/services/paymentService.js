// Nghiệp vụ cổng thanh toán: xem lỗi (ĐỌC) và bật/tắt cổng (GHI).
import { ONLINE_GATEWAYS, NIGHT_HOURS, nightWindow } from "../data/seed.js";
import { ok, fail, formatPercent, formatTime, describeWindow, ordersInNight, baselineDates, cleanText, recordAudit } from "./common.js";

// Lỗi bất thường khi: đủ giao dịch để đánh giá, ≥ 10 lần lỗi, tỉ lệ ≥ 10% và ≥ 3 lần mức bình thường.
export const FAILURE_RULE = { minAttempts: 20, minFailed: 10, minRate: 0.1, multiplier: 3 };
const HOURLY_MIN_ATTEMPTS = 5;

export function normalizeGateway(raw) {
    const gateway = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    return ONLINE_GATEWAYS.includes(gateway) ? gateway : null;
}

// Tỉ lệ lỗi của 1 cổng trên 1 tập đơn.
export function gatewayStats(orders, gateway) {
    const attempts = orders.filter((o) => o.paymentMethod === gateway);
    const failed = attempts.filter((o) => o.paymentStatus === "FAILED");
    return { attempts: attempts.length, failed: failed.length, rate: attempts.length ? failed.length / attempts.length : 0, failedOrders: failed };
}

export function isFailureAnomaly(stats, baselineRate) {
    return stats.attempts >= FAILURE_RULE.minAttempts
        && stats.failed >= FAILURE_RULE.minFailed
        && stats.rate >= FAILURE_RULE.minRate
        && stats.rate >= FAILURE_RULE.multiplier * baselineRate;
}

export function baselineFailureRate(db, morningDate, gateway) {
    const orders = baselineDates(morningDate).flatMap((date) => ordersInNight(db, date));
    return gatewayStats(orders, gateway).rate;
}

export function getPaymentFailures(db, { gateway } = {}) {
    let targets = ONLINE_GATEWAYS;
    if (gateway !== undefined && gateway !== null && gateway !== "") {
        const normalized = normalizeGateway(gateway);
        if (!normalized) return fail("INVALID_GATEWAY", `Không có cổng "${gateway}". Các cổng online: ${ONLINE_GATEWAYS.join(", ")}.`);
        targets = [normalized];
    }

    const date = db.reportDate;
    const tonight = ordersInNight(db, date);
    const { start } = nightWindow(date);

    const gateways = targets.map((name) => {
        const stats = gatewayStats(tonight, name);
        const baseRate = baselineFailureRate(db, date, name);
        const spikeThreshold = Math.max(FAILURE_RULE.minRate, FAILURE_RULE.multiplier * baseRate);

        const hourly = Array.from({ length: NIGHT_HOURS }, (_, h) => {
            const from = new Date(start.getTime() + h * 3600_000);
            const to = new Date(from.getTime() + 3600_000);
            const slot = gatewayStats(tonight.filter((o) => o.createdAt >= from && o.createdAt < to), name);
            return { from: formatTime(from), attempts: slot.attempts, failed: slot.failed, failureRate: formatPercent(slot.rate), isSpike: slot.attempts >= HOURLY_MIN_ATTEMPTS && slot.rate >= spikeThreshold };
        });

        const failureCodes = {};
        for (const order of stats.failedOrders) failureCodes[order.failureCode] = (failureCodes[order.failureCode] ?? 0) + 1;

        return {
            gateway: name,
            enabled: db.gateways.get(name).enabled,
            attempts: stats.attempts,
            failed: stats.failed,
            failureRate: formatPercent(stats.rate),
            normalFailureRate: formatPercent(baseRate),
            isAnomaly: isFailureAnomaly(stats, baseRate),
            spikeStartedAt: hourly.find((slot) => slot.isSpike)?.from ?? null,
            failureCodes,
            affectedCustomers: new Set(stats.failedOrders.map((o) => o.customerPhone)).size,
            hourly,
        };
    });

    const broken = gateways.filter((g) => g.isAnomaly).map((g) => `${g.gateway} (${g.failureRate}, bình thường ${g.normalFailureRate})`);
    return ok(
        "PAYMENT_FAILURES",
        broken.length ? `Cổng lỗi bất thường: ${broken.join("; ")}.` : "Không có cổng nào lỗi bất thường.",
        { window: describeWindow(date), gateways },
    );
}

// ---------- GHI: bật/tắt cổng ----------

function planGatewayChange(db, args) {
    const gateway = normalizeGateway(args.gateway);
    if (!gateway) return { error: fail("INVALID_GATEWAY", `Chỉ bật/tắt được ${ONLINE_GATEWAYS.join(", ")}. COD luôn mở.`) };
    if (typeof args.enabled !== "boolean") return { error: fail("INVALID_ARGUMENT", "Thiếu hoặc sai tham số enabled (true = bật, false = tắt).") };
    const reason = cleanText(args.reason);
    if (!reason) return { error: fail("MISSING_REASON", "Cần nêu lý do để ghi nhật ký vận hành.") };

    if (db.gateways.get(gateway).enabled === args.enabled) {
        return { error: fail("ALREADY_IN_STATE", `Cổng ${gateway} đang ${args.enabled ? "bật" : "tắt"} sẵn rồi, không cần thao tác.`) };
    }
    const remainingOnline = ONLINE_GATEWAYS.filter((g) => g !== gateway && db.gateways.get(g).enabled);
    if (!args.enabled && remainingOnline.length === 0) {
        return { error: fail("LAST_ONLINE_GATEWAY", `Không thể tắt ${gateway} vì đây là cổng online cuối cùng còn mở.`) };
    }
    return { plan: { gateway, enabled: args.enabled, reason, remainingOnline } };
}

export function previewSetGatewayStatus(db, args) {
    const { plan, error } = planGatewayChange(db, args);
    if (error) return error;
    const message = plan.enabled
        ? `BẬT lại cổng thanh toán ${plan.gateway}. Lý do: ${plan.reason}.`
        : `TẮT cổng thanh toán ${plan.gateway}. Khách sẽ chỉ còn thanh toán bằng: ${[...plan.remainingOnline, "COD"].join(", ")}. Lý do: ${plan.reason}.`;
    return ok("NEEDS_CONFIRMATION", message, plan);
}

// Kiểm tra lại toàn bộ điều kiện lúc thực hiện, không dựa vào kết quả preview trước đó.
export function setGatewayStatus(db, args) {
    const { plan, error } = planGatewayChange(db, args);
    if (error) return error;
    db.gateways.get(plan.gateway).enabled = plan.enabled;
    recordAudit(db, plan.enabled ? "ENABLE_GATEWAY" : "DISABLE_GATEWAY", { gateway: plan.gateway, reason: plan.reason });
    return ok(
        "GATEWAY_UPDATED",
        `Đã ${plan.enabled ? "bật" : "tắt"} cổng ${plan.gateway}.`,
        { gateway: plan.gateway, enabled: plan.enabled, onlineGatewaysNow: [...db.gateways].filter(([, g]) => g.enabled).map(([name]) => name) },
    );
}

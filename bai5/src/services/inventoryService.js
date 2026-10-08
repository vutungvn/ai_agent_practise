// Nghiệp vụ tồn kho: cảnh báo sắp hết (ĐỌC) và tạo phiếu nhập hàng (GHI).
import { NIGHT_HOURS, addDays } from "../data/seed.js";
import { ok, fail, round, ordersInNight, baselineDates, cleanText, recordAudit } from "./common.js";

export const URGENT_HOURS = 12; // bán hết trong < 12 giờ theo tốc độ đêm qua -> khẩn
export const MAX_RESTOCK_QUANTITY = 5000;

function unitsBySku(orders) {
    const units = new Map();
    for (const o of orders) {
        if (o.paymentStatus === "SUCCESS") units.set(o.sku, (units.get(o.sku) ?? 0) + o.quantity);
    }
    return units;
}

const pendingRestockOf = (db, sku) => db.restockOrders.find((r) => r.sku === sku && r.status === "CHO_NCC_XAC_NHAN");

export function getStockAlerts(db) {
    const lastNight = unitsBySku(ordersInNight(db, db.reportDate));
    const baselineNights = baselineDates(db.reportDate).map((date) => unitsBySku(ordersInNight(db, date)));

    const alerts = [];
    for (const product of db.products.values()) {
        const sold = lastNight.get(product.sku) ?? 0;
        const avgSold = baselineNights.reduce((sum, units) => sum + (units.get(product.sku) ?? 0), 0) / baselineNights.length;
        const hoursLeft = sold > 0 ? product.stock / (sold / NIGHT_HOURS) : null;

        let level = null;
        if (hoursLeft !== null && hoursLeft < URGENT_HOURS) level = "HIGH";
        else if (product.stock <= product.reorderPoint) level = "MEDIUM";
        if (!level) continue;

        const pending = pendingRestockOf(db, product.sku);
        alerts.push({
            level,
            sku: product.sku,
            name: product.name,
            stock: product.stock,
            reorderPoint: product.reorderPoint,
            soldLastNight: sold,
            avgSoldPerNight: round(avgSold),
            hoursLeftAtLastNightPace: hoursLeft === null ? null : round(hoursLeft),
            // đủ bán ~2 đêm theo tốc độ đêm qua, tối thiểu gấp đôi điểm đặt hàng, làm tròn chục
            suggestedQuantity: Math.ceil(Math.max(product.reorderPoint * 2, sold * 2) / 10) * 10,
            supplier: product.supplier,
            leadTimeDays: product.leadTimeDays,
            pendingRestock: pending ? pending.restockId : null,
        });
    }
    alerts.sort((a, b) => (a.level === b.level ? (a.hoursLeftAtLastNightPace ?? Infinity) - (b.hoursLeftAtLastNightPace ?? Infinity) : a.level === "HIGH" ? -1 : 1));

    return ok(
        "STOCK_ALERTS",
        alerts.length ? `${alerts.length} sản phẩm cần chú ý, ${alerts.filter((a) => a.level === "HIGH").length} sản phẩm khẩn cấp.` : "Không có sản phẩm nào sắp hết hàng.",
        { alerts },
    );
}

// ---------- GHI: tạo phiếu nhập hàng ----------

function planRestock(db, args) {
    const sku = typeof args.sku === "string" ? args.sku.trim().toUpperCase() : "";
    const product = db.products.get(sku);
    if (!product) return { error: fail("UNKNOWN_SKU", `Không có sản phẩm mã "${args.sku ?? ""}".`) };

    const quantity = typeof args.quantity === "string" && args.quantity.trim() !== "" ? Number(args.quantity) : args.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_RESTOCK_QUANTITY) {
        return { error: fail("INVALID_QUANTITY", `Số lượng phải là số nguyên từ 1 đến ${MAX_RESTOCK_QUANTITY}.`) };
    }
    const pending = pendingRestockOf(db, sku);
    if (pending) return { error: fail("DUPLICATE_PENDING", `${product.name} đã có phiếu nhập ${pending.restockId} (${pending.quantity} cái) đang chờ nhà cung cấp, không tạo trùng.`) };

    return { plan: { sku, name: product.name, quantity, supplier: product.supplier, eta: addDays(db.reportDate, product.leadTimeDays), note: cleanText(args.note) } };
}

export function previewCreateRestockOrder(db, args) {
    const { plan, error } = planRestock(db, args);
    if (error) return error;
    return ok("NEEDS_CONFIRMATION", `Tạo phiếu nhập ${plan.quantity} x ${plan.name} (${plan.sku}) gửi ${plan.supplier}, dự kiến hàng về ${plan.eta}.`, plan);
}

export function createRestockOrder(db, args) {
    const { plan, error } = planRestock(db, args);
    if (error) return error;
    const restock = { restockId: `PN-${String(db.restockOrders.length + 1).padStart(4, "0")}`, ...plan, status: "CHO_NCC_XAC_NHAN" };
    db.restockOrders.push(restock);
    recordAudit(db, "CREATE_RESTOCK", { restockId: restock.restockId, sku: plan.sku, quantity: plan.quantity });
    return ok("RESTOCK_CREATED", `Đã tạo phiếu nhập ${restock.restockId}: ${plan.quantity} x ${plan.name}, dự kiến về ${plan.eta}.`, restock);
}

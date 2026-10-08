// Nối tên tool (definitions.js) với hàm nghiệp vụ (services/) và phân loại tool.
// Tool loại "write" bắt buộc có preview: tầng điều phối dùng preview để hỏi con người trước khi gọi run.
import { toolDeclarations } from "./definitions.js";
import { getOvernightReport } from "../services/reportService.js";
import { getPaymentFailures, previewSetGatewayStatus, setGatewayStatus } from "../services/paymentService.js";
import { getStockAlerts, previewCreateRestockOrder, createRestockOrder } from "../services/inventoryService.js";
import { findSuspiciousOrders, previewHoldOrders, holdOrders } from "../services/orderService.js";

export const TOOL_KIND = { AGGREGATE: "aggregate", READ: "read", WRITE: "write" };

const BINDINGS = {
    get_overnight_report: { kind: TOOL_KIND.AGGREGATE, run: getOvernightReport },
    get_payment_failures: { kind: TOOL_KIND.READ, run: getPaymentFailures },
    get_stock_alerts: { kind: TOOL_KIND.READ, run: getStockAlerts },
    find_suspicious_orders: { kind: TOOL_KIND.READ, run: findSuspiciousOrders },
    set_payment_gateway_status: { kind: TOOL_KIND.WRITE, title: "Bật/tắt cổng thanh toán", preview: previewSetGatewayStatus, run: setGatewayStatus },
    create_restock_order: { kind: TOOL_KIND.WRITE, title: "Tạo phiếu nhập hàng", preview: previewCreateRestockOrder, run: createRestockOrder },
    hold_orders: { kind: TOOL_KIND.WRITE, title: "Tạm giữ đơn hàng", preview: previewHoldOrders, run: holdOrders },
};

export function createToolRegistry() {
    const registry = new Map();
    for (const declaration of toolDeclarations) {
        const binding = BINDINGS[declaration.name];
        // Lỗi lập trình (khai báo tool mà quên nối nghiệp vụ) thì báo ngay lúc khởi động, không đợi tới lúc model gọi.
        if (!binding) throw new Error(`Tool ${declaration.name} chưa được nối với nghiệp vụ`);
        if (binding.kind === TOOL_KIND.WRITE && typeof binding.preview !== "function") throw new Error(`Tool ghi ${declaration.name} thiếu preview`);
        registry.set(declaration.name, { name: declaration.name, declaration, ...binding });
    }
    return registry;
}

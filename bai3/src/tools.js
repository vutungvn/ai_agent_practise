import { Type } from "@google/genai";
import { getOrderForCustomer, changeShippingAddress, HOTLINE } from "./orderService.js";

// Không tool nào nhận customerId: code tự lấy từ phiên đăng nhập,
// để khách không thể tự nhận là người khác.
export const toolDeclarations = [
    {
        name: "get_order",
        description:
            "CHỈ ĐỌC. Tra cứu một đơn hàng của khách đang đăng nhập: trạng thái, địa chỉ hiện tại, " +
            "và đơn có được đổi địa chỉ không (data.canChangeAddress). Luôn gọi tool này trước update_shipping_address.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                orderId: { type: Type.STRING, description: "Mã đơn hàng, ví dụ ORD001" },
            },
            required: ["orderId"],
        },
    },
    {
        name: "update_shipping_address",
        description:
            "GHI DỮ LIỆU. Đổi địa chỉ giao hàng của đơn. Chỉ gọi khi get_order trả về canChangeAddress=true " +
            "VÀ khách đã xác nhận địa chỉ mới. Truyền NGUYÊN VĂN địa chỉ khách nhập, không tự thêm/sửa/đoán tỉnh thành.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                orderId: { type: Type.STRING, description: "Mã đơn hàng, ví dụ ORD001" },
                newAddress: { type: Type.STRING, description: "Địa chỉ mới, nguyên văn như khách nhập" },
            },
            required: ["orderId", "newAddress"],
        },
    },
];

export function createToolExecutor({ db, customerId }) {
    const handlers = {
        get_order: (args) => getOrderForCustomer(db, customerId, args.orderId),
        update_shipping_address: (args) => changeShippingAddress(db, customerId, args.orderId, args.newAddress),
    };

    // Không bao giờ throw: lỗi gì cũng trả về object để model báo lại cho khách.
    return function executeTool(name, args) {
        const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
        if (!handler) {
            return { ok: false, code: "UNKNOWN_TOOL", message: `Không có tool tên ${name}.` };
        }
        try {
            return handler(args ?? {});
        } catch (err) {
            console.error("[TOOL ERROR]", err);
            return {
                ok: false,
                code: "INTERNAL_ERROR",
                message: `Hệ thống đang gặp sự cố. Bạn vui lòng thử lại sau hoặc gọi tổng đài ${HOTLINE}.`,
            };
        }
    };
}

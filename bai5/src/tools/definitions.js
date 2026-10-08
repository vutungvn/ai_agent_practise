// ĐỊNH NGHĨA TOOL: chỉ mô tả cho model biết tool nào làm gì, nhận tham số gì. Không chứa nghiệp vụ.
// Không tool nào có tham số kiểu "confirmed": việc xác nhận do tầng điều phối hỏi con người, model không tự khai được.
import { Type } from "@google/genai";
import { ONLINE_GATEWAYS } from "../data/seed.js";

export const toolDeclarations = [
    {
        name: "get_overnight_report",
        description:
            "[TỔNG HỢP] Báo cáo 1 đêm (22:00 -> 07:00) so với trung bình 7 đêm trước: số đơn, doanh thu, tỉ lệ lỗi từng cổng thanh toán, " +
            "và danh sách bất thường đã xếp theo mức độ (thanh toán, tồn kho, đơn nghi gian lận). Gọi ĐẦU TIÊN khi được hỏi chung chung về đêm qua.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                date: { type: Type.STRING, description: "Ngày của buổi sáng kết thúc đêm cần xem, dạng YYYY-MM-DD. Bỏ trống = đêm qua." },
            },
        },
    },
    {
        name: "get_payment_failures",
        description: "[CHỈ ĐỌC] Chi tiết lỗi thanh toán đêm qua theo cổng: tỉ lệ lỗi theo từng giờ, giờ bắt đầu lỗi, mã lỗi, số khách bị ảnh hưởng, cổng đang bật hay tắt.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                gateway: { type: Type.STRING, enum: ONLINE_GATEWAYS, description: "Bỏ trống để xem tất cả cổng." },
            },
        },
    },
    {
        name: "get_stock_alerts",
        description: "[CHỈ ĐỌC] Sản phẩm sắp hết hàng: tồn hiện tại, bán đêm qua so với trung bình, số giờ còn bán được, số lượng đề xuất nhập, phiếu nhập đang chờ.",
    },
    {
        name: "find_suspicious_orders",
        description: "[CHỈ ĐỌC] Đơn nghi gian lận đêm qua: cùng SĐT đặt nhiều đơn COD giá trị cao tới nhiều địa chỉ. Trả về các nhóm đơn và mã đơn.",
    },
    {
        name: "set_payment_gateway_status",
        description:
            "[GHI - cần giám đốc xác nhận] Bật hoặc tắt tạm thời một cổng thanh toán online. COD luôn mở. " +
            "Chỉ gọi khi giám đốc yêu cầu xử lý. Hệ thống sẽ tự hiện bảng xác nhận cho giám đốc trước khi thực hiện.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                gateway: { type: Type.STRING, enum: ONLINE_GATEWAYS },
                enabled: { type: Type.BOOLEAN, description: "true = bật lại, false = tắt" },
                reason: { type: Type.STRING, description: "Lý do ngắn, ghi vào nhật ký vận hành" },
            },
            required: ["gateway", "enabled", "reason"],
        },
    },
    {
        name: "create_restock_order",
        description:
            "[GHI - cần giám đốc xác nhận] Tạo phiếu nhập hàng gửi nhà cung cấp cho 1 sản phẩm. " +
            "Chỉ gọi khi giám đốc yêu cầu. Nếu giám đốc không nói số lượng, dùng suggestedQuantity từ get_stock_alerts.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                sku: { type: Type.STRING, description: "Mã sản phẩm, ví dụ SP012" },
                quantity: { type: Type.INTEGER, description: "Số lượng nhập, 1-5000" },
                note: { type: Type.STRING, description: "Ghi chú cho nhà cung cấp (tuỳ chọn)" },
            },
            required: ["sku", "quantity"],
        },
    },
    {
        name: "hold_orders",
        description:
            "[GHI - cần giám đốc xác nhận] Tạm giữ các đơn đang chờ xử lý để kho chưa đóng gói/giao, chờ xác minh. " +
            "Tối đa 20 đơn mỗi lần. Chỉ gọi khi giám đốc yêu cầu.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                orderIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Mã đơn, ví dụ DH105678" },
                reason: { type: Type.STRING, description: "Lý do tạm giữ" },
            },
            required: ["orderIds", "reason"],
        },
    },
];

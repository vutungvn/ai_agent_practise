// Dữ liệu đơn hàng giả lập thay cho hệ thống đơn hàng thật.
import { normalizeOrderId } from "./preprocess.js";

const SEED_ORDERS = [
    { orderId: "ORD1001", status: "DANG_GIAO", paymentMethod: "THE", paymentStatus: "DA_THANH_TOAN", note: "Trễ 2 ngày so với dự kiến" },
    { orderId: "ORD1002", status: "CHO_THANH_TOAN", paymentMethod: "VNPAY", paymentStatus: "THAT_BAI", note: "Giao dịch VNPAY bị lỗi, đơn chưa được xử lý" },
    { orderId: "ORD1003", status: "CHO_NHAP_HANG", paymentMethod: "VNPAY", paymentStatus: "DA_THANH_TOAN", note: "Kho hết hàng, dự kiến nhập lại sau 5 ngày" },
    { orderId: "ORD1004", status: "DA_GIAO", paymentMethod: "COD", paymentStatus: "DA_THANH_TOAN", deliveredDaysAgo: 2 },
    { orderId: "ORD1005", status: "DA_HUY", paymentMethod: "THE", paymentStatus: "CHO_HOAN_TIEN", note: "Khách huỷ, chưa hoàn tiền" },
    { orderId: "ORD1006", status: "DA_GIAO", paymentMethod: "COD", paymentStatus: "DA_THANH_TOAN", deliveredDaysAgo: 40 },
    { orderId: "ORD1007", status: "DANG_GIAO", paymentMethod: "COD", paymentStatus: "CHUA_THANH_TOAN" },
];

// Mỗi lần gọi trả về bản sao mới để các test không ảnh hưởng nhau.
export function createOrderDb() {
    return new Map(SEED_ORDERS.map((order) => [order.orderId, { ...order }]));
}

// Dùng cho tool get_order (CHỈ ĐỌC). Không bao giờ throw.
export function getOrder(db, rawOrderId) {
    const orderId = normalizeOrderId(rawOrderId);
    if (!orderId) return { ok: false, code: "INVALID_ORDER_ID", message: "Mã đơn không hợp lệ (dạng ORD + số)." };
    const order = db.get(orderId);
    if (!order) return { ok: false, code: "ORDER_NOT_FOUND", message: `Không tìm thấy đơn ${orderId}.` };
    return { ok: true, code: "FOUND", data: { ...order } };
}

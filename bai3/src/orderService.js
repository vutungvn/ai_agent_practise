// Logic nghiệp vụ đổi địa chỉ. Không phụ thuộc AI, test được mà không cần API key.
import { parseAddress, getProvinceName } from "./address.js";

export const HOTLINE = "1900 1234";
const MAX_ADDRESS_CHANGES = 1;

// Whitelist: chỉ 2 trạng thái này được đổi. Mọi trạng thái khác (kể cả thêm sau này) đều bị chặn.
const EDITABLE_STATUSES = new Set(["CHO_XAC_NHAN", "DANG_CHUAN_BI"]);
const IN_DELIVERY_STATUSES = new Set(["DANG_GIAO", "DA_GIAO"]);

const STATUS_LABELS = {
    CHO_XAC_NHAN: "Chờ xác nhận",
    DANG_CHUAN_BI: "Đang chuẩn bị hàng",
    DANG_GIAO: "Đang giao",
    DA_GIAO: "Đã giao",
    DA_HUY: "Đã huỷ",
};

const fail = (code, message) => ({ ok: false, code, message });

// " ord001 " -> "ORD001"; sai định dạng -> null
export function normalizeOrderId(raw) {
    if (typeof raw !== "string") return null;
    const orderId = raw.trim().toUpperCase();
    return /^ORD\d+$/.test(orderId) ? orderId : null;
}

// B3: đơn phải tồn tại VÀ thuộc về khách đang đăng nhập.
function findOwnedOrder(db, customerId, rawOrderId) {
    const orderId = normalizeOrderId(rawOrderId);
    if (!orderId) {
        return { error: fail("INVALID_ORDER_ID", "Mã đơn hàng không hợp lệ. Mã đơn có dạng ORD kèm số, ví dụ ORD001.") };
    }
    const order = db.orders.get(orderId);
    // Cùng một thông báo cho "không tồn tại" và "của người khác" để không lộ thông tin đơn của khách khác.
    if (!order || order.customerId !== customerId) {
        return {
            error: fail("ORDER_NOT_FOUND", `Mình không tìm thấy đơn ${orderId} trong tài khoản của bạn. Bạn kiểm tra lại mã đơn giúp mình nhé.`),
        };
    }
    return { order };
}

// B4 (trạng thái) + B5 (số lần đã đổi). Trả về null nếu được đổi.
function checkEligibility(order) {
    const label = STATUS_LABELS[order.status] ?? order.status;
    if (IN_DELIVERY_STATUSES.has(order.status)) {
        return fail(
            "STATUS_NOT_ALLOWED",
            `Đơn ${order.orderId} đang ở trạng thái "${label}" nên không thể đổi địa chỉ qua kênh này. Bạn vui lòng gọi tổng đài ${HOTLINE} để được hỗ trợ.`,
        );
    }
    if (!EDITABLE_STATUSES.has(order.status)) {
        return fail("STATUS_NOT_ALLOWED", `Đơn ${order.orderId} đang ở trạng thái "${label}" nên không thể đổi địa chỉ.`);
    }
    if (order.addressChangeCount >= MAX_ADDRESS_CHANGES) {
        return fail(
            "ALREADY_CHANGED",
            `Đơn ${order.orderId} đã được đổi địa chỉ 1 lần, đây là mức tối đa cho mỗi đơn. Nếu cần hỗ trợ thêm, bạn vui lòng gọi tổng đài ${HOTLINE}.`,
        );
    }
    return null;
}

// Dùng cho tool get_order (CHỈ ĐỌC).
export function getOrderForCustomer(db, customerId, rawOrderId) {
    const { order, error } = findOwnedOrder(db, customerId, rawOrderId);
    if (error) return error;

    const blocked = checkEligibility(order);
    const provinceName = getProvinceName(order.province);
    return {
        ok: true,
        code: blocked ? blocked.code : "ELIGIBLE",
        message: blocked ? blocked.message : `Đơn ${order.orderId} có thể đổi địa chỉ. Địa chỉ mới phải thuộc ${provinceName}.`,
        data: {
            orderId: order.orderId,
            status: order.status,
            statusLabel: STATUS_LABELS[order.status] ?? order.status,
            currentAddress: order.shippingAddress,
            province: provinceName,
            canChangeAddress: !blocked,
        },
    };
}

// Dùng cho tool update_shipping_address (GHI). Kiểm tra lại TOÀN BỘ điều kiện,
// không tin rằng model đã gọi get_order trước đó.
export function changeShippingAddress(db, customerId, rawOrderId, rawNewAddress) {
    // B3
    const { order, error } = findOwnedOrder(db, customerId, rawOrderId);
    if (error) return error;

    // B4, B5
    const blocked = checkEligibility(order);
    if (blocked) return blocked;

    // B7: địa chỉ rỗng / thiếu tỉnh / chỉ có tỉnh
    const parsed = parseAddress(rawNewAddress);
    if (!parsed.ok) return parsed;

    // B7: khác tỉnh
    if (parsed.province.key !== order.province) {
        const oldProvince = getProvinceName(order.province);
        return fail(
            "DIFFERENT_PROVINCE",
            `Địa chỉ mới thuộc ${parsed.province.name}, khác tỉnh/thành với địa chỉ hiện tại (${oldProvince}). ` +
            `ShopFast chỉ hỗ trợ đổi địa chỉ trong cùng tỉnh/thành. Nếu bạn muốn giao tới ${parsed.province.name}, ` +
            `bạn vui lòng huỷ đơn ${order.orderId} và đặt đơn mới với địa chỉ này nhé.`,
        );
    }

    // B9: mọi điều kiện đã đạt, giờ mới ghi dữ liệu.
    const oldAddress = order.shippingAddress;
    order.shippingAddress = parsed.address;
    order.addressChangeCount += 1;
    db.addressChangeLog.push({
        orderId: order.orderId,
        customerId,
        oldAddress,
        newAddress: parsed.address,
        changedAt: new Date().toISOString(),
    });

    return {
        ok: true,
        code: "ADDRESS_CHANGED",
        message: `Đã đổi địa chỉ giao hàng của đơn ${order.orderId} thành: "${parsed.address}". Lưu ý: mỗi đơn chỉ được đổi địa chỉ 1 lần.`,
        data: { orderId: order.orderId, oldAddress, newAddress: parsed.address },
    };
}

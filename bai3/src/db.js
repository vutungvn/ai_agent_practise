// Dữ liệu giả lập thay cho database thật của ShopFast.
// province lưu theo key trong src/address.js.

export const CUSTOMERS = {
    KH001: "Nguyễn Văn An",
    KH002: "Trần Thị Bình",
};

const SEED_ORDERS = [
    { orderId: "ORD001", customerId: "KH001", status: "CHO_XAC_NHAN", shippingAddress: "12 Láng Hạ, Đống Đa, Hà Nội", province: "ha-noi", addressChangeCount: 0 },
    { orderId: "ORD002", customerId: "KH001", status: "DANG_CHUAN_BI", shippingAddress: "45 Lê Lợi, Quận 1, TP. Hồ Chí Minh", province: "ho-chi-minh", addressChangeCount: 0 },
    { orderId: "ORD003", customerId: "KH001", status: "DANG_GIAO", shippingAddress: "8 Kim Mã, Ba Đình, Hà Nội", province: "ha-noi", addressChangeCount: 0 },
    { orderId: "ORD004", customerId: "KH001", status: "DA_GIAO", shippingAddress: "20 Bạch Đằng, Hải Châu, Đà Nẵng", province: "da-nang", addressChangeCount: 0 },
    { orderId: "ORD005", customerId: "KH001", status: "CHO_XAC_NHAN", shippingAddress: "3 Xuân Thủy, Cầu Giấy, Hà Nội", province: "ha-noi", addressChangeCount: 1 },
    { orderId: "ORD006", customerId: "KH002", status: "CHO_XAC_NHAN", shippingAddress: "99 Nguyễn Trãi, Thanh Xuân, Hà Nội", province: "ha-noi", addressChangeCount: 0 },
    { orderId: "ORD007", customerId: "KH001", status: "DA_HUY", shippingAddress: "1 Trần Phú, Hà Đông, Hà Nội", province: "ha-noi", addressChangeCount: 0 },
];

// Mỗi lần gọi trả về một bản sao mới, để các test không ảnh hưởng nhau.
export function createDb() {
    return {
        orders: new Map(SEED_ORDERS.map((order) => [order.orderId, { ...order }])),
        addressChangeLog: [],
    };
}


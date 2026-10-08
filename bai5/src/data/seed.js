// Dữ liệu giả lập thay cho database thật: 15 đêm đơn hàng (22:00 -> 07:00), tồn kho, cổng thanh toán.
// Sinh bằng PRNG có seed nên lần chạy nào cũng ra cùng số liệu. Đêm gần nhất được cài sẵn 3 sự cố:
//   1. Cổng VNPAY lỗi GATEWAY_TIMEOUT từ 01:30
//   2. Nồi chiên Z5 (SP012) bán đột biến, tồn kho chỉ còn 6
//   3. Một SĐT đặt 4 đơn COD điện thoại giá trị cao tới 4 địa chỉ khác nhau

export const REPORT_DATE = "2026-10-08"; // "sáng nay" của dữ liệu giả lập
export const HISTORY_NIGHTS = 15;
export const NIGHT_HOURS = 9; // 22:00 -> 07:00
export const ONLINE_GATEWAYS = ["VNPAY", "MOMO", "THE"]; // COD luôn mở, không bật/tắt

const PRODUCTS = [
    { sku: "SP001", name: "Điện thoại X Pro", price: 9_490_000, stock: 42, reorderPoint: 10, supplier: "Phân phối Minh Long", leadTimeDays: 3, weight: 2 },
    { sku: "SP002", name: "Tai nghe không dây A3", price: 590_000, stock: 180, reorderPoint: 40, supplier: "Phân phối Minh Long", leadTimeDays: 3, weight: 10 },
    { sku: "SP003", name: "Sạc nhanh 33W", price: 190_000, stock: 320, reorderPoint: 60, supplier: "Phụ kiện Hoàng Gia", leadTimeDays: 2, weight: 14 },
    { sku: "SP004", name: "Áo thun basic", price: 149_000, stock: 540, reorderPoint: 100, supplier: "May mặc Việt Tiến Phát", leadTimeDays: 4, weight: 16 },
    { sku: "SP005", name: "Bình giữ nhiệt 750ml", price: 259_000, stock: 210, reorderPoint: 40, supplier: "Gia dụng Sao Mai", leadTimeDays: 2, weight: 9 },
    { sku: "SP006", name: "Giày chạy bộ X1", price: 1_190_000, stock: 75, reorderPoint: 20, supplier: "Thể thao Bình Minh", leadTimeDays: 5, weight: 5 },
    { sku: "SP007", name: "Ốp lưng chống sốc", price: 99_000, stock: 8, reorderPoint: 15, supplier: "Phụ kiện Hoàng Gia", leadTimeDays: 2, weight: 1 },
    { sku: "SP008", name: "Balo laptop 15 inch", price: 449_000, stock: 95, reorderPoint: 20, supplier: "Thể thao Bình Minh", leadTimeDays: 5, weight: 5 },
    { sku: "SP009", name: "Chuột không dây", price: 229_000, stock: 260, reorderPoint: 50, supplier: "Phụ kiện Hoàng Gia", leadTimeDays: 2, weight: 9 },
    { sku: "SP010", name: "Bàn phím cơ K2", price: 990_000, stock: 60, reorderPoint: 15, supplier: "Phân phối Minh Long", leadTimeDays: 3, weight: 4 },
    { sku: "SP011", name: "Đèn bàn LED", price: 299_000, stock: 140, reorderPoint: 30, supplier: "Gia dụng Sao Mai", leadTimeDays: 2, weight: 6 },
    { sku: "SP012", name: "Nồi chiên không dầu Z5", price: 1_290_000, stock: 6, reorderPoint: 20, supplier: "Gia dụng Sao Mai", leadTimeDays: 2, weight: 3 },
    { sku: "SP013", name: "Cốc giữ nhiệt mini", price: 129_000, stock: 400, reorderPoint: 80, supplier: "Gia dụng Sao Mai", leadTimeDays: 2, weight: 12 },
    { sku: "SP014", name: "Ổ cắm thông minh", price: 349_000, stock: 150, reorderPoint: 30, supplier: "Phân phối Minh Long", leadTimeDays: 3, weight: 5 },
    { sku: "SP015", name: "Kem chống nắng 50ml", price: 219_000, stock: 300, reorderPoint: 60, supplier: "Mỹ phẩm Thảo Nguyên", leadTimeDays: 4, weight: 11 },
];

const METHODS = [["VNPAY", 35], ["MOMO", 20], ["THE", 15], ["COD", 30]];
const DISTRICTS = ["Cầu Giấy, Hà Nội", "Đống Đa, Hà Nội", "Hà Đông, Hà Nội", "Quận 1, TP.HCM", "Quận 7, TP.HCM", "Thủ Đức, TP.HCM", "Hải Châu, Đà Nẵng", "Ninh Kiều, Cần Thơ"];

const FRAUD_PHONE = "0912000111";
const FRAUD_ORDERS = [
    { time: "02:05", address: "15 Trần Thái Tông, Cầu Giấy, Hà Nội" },
    { time: "02:18", address: "88 Nguyễn Văn Linh, Quận 7, TP.HCM" },
    { time: "02:31", address: "4 Lê Duẩn, Hải Châu, Đà Nẵng" },
    { time: "02:47", address: "210 Võ Văn Ngân, Thủ Đức, TP.HCM" },
];

export function addDays(dateStr, delta) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
}

// Đêm "của" sáng morningDate: 22:00 hôm trước -> 07:00 sáng đó (giờ Việt Nam).
export function nightWindow(morningDate) {
    return {
        start: new Date(`${addDays(morningDate, -1)}T22:00:00+07:00`),
        end: new Date(`${morningDate}T07:00:00+07:00`),
    };
}

function mulberry32(seed) {
    let a = seed;
    return function rand() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pickWeighted(rand, items, weightOf) {
    const total = items.reduce((sum, item) => sum + weightOf(item), 0);
    let r = rand() * total;
    for (const item of items) {
        r -= weightOf(item);
        if (r < 0) return item;
    }
    return items.at(-1);
}

function generateNight(rand, morningDate, isLastNight) {
    const { start, end } = nightWindow(morningDate);
    const vnpayOutageFrom = new Date(`${morningDate}T01:30:00+07:00`);
    const orders = [];
    const count = 360 + Math.floor(rand() * 60);

    for (let i = 0; i < count; i++) {
        const createdAt = new Date(start.getTime() + rand() * (end - start));
        const product = pickWeighted(rand, PRODUCTS, (p) => (isLastNight && p.sku === "SP012" ? 25 : p.weight));
        const quantity = rand() < 0.85 ? 1 : 2;
        const [paymentMethod] = pickWeighted(rand, METHODS, (m) => m[1]);

        let failureCode = null;
        if (paymentMethod !== "COD") {
            if (isLastNight && paymentMethod === "VNPAY" && createdAt >= vnpayOutageFrom && rand() < 0.45) failureCode = "GATEWAY_TIMEOUT";
            else if (rand() < 0.03) failureCode = rand() < 0.5 ? "KHONG_DU_SO_DU" : "KHACH_HUY";
        }

        orders.push({
            createdAt,
            sku: product.sku,
            quantity,
            amount: product.price * quantity,
            paymentMethod,
            paymentStatus: failureCode ? "FAILED" : "SUCCESS",
            failureCode,
            customerPhone: `09${String(Math.floor(rand() * 5000)).padStart(8, "0")}`,
            shippingAddress: `${1 + Math.floor(rand() * 200)} ${DISTRICTS[Math.floor(rand() * DISTRICTS.length)]}`,
            status: failureCode ? "THANH_TOAN_LOI" : isLastNight ? "CHO_XU_LY" : "DA_GIAO",
        });
    }

    if (isLastNight) {
        for (const { time, address } of FRAUD_ORDERS) {
            orders.push({
                createdAt: new Date(`${morningDate}T${time}:00+07:00`),
                sku: "SP001",
                quantity: 1,
                amount: 9_490_000,
                paymentMethod: "COD",
                paymentStatus: "SUCCESS",
                failureCode: null,
                customerPhone: FRAUD_PHONE,
                shippingAddress: address,
                status: "CHO_XU_LY",
            });
        }
    }
    return orders;
}

// Mỗi lần gọi trả về một database mới, độc lập (test không ảnh hưởng nhau).
export function createDb({ seed = 20261008 } = {}) {
    const rand = mulberry32(seed);
    const all = [];
    for (let n = HISTORY_NIGHTS - 1; n >= 0; n--) {
        all.push(...generateNight(rand, addDays(REPORT_DATE, -n), n === 0));
    }
    all.sort((a, b) => a.createdAt - b.createdAt);

    return {
        reportDate: REPORT_DATE,
        orders: new Map(all.map((order, i) => {
            const orderId = `DH${100001 + i}`;
            return [orderId, { orderId, ...order }];
        })),
        products: new Map(PRODUCTS.map(({ weight, ...product }) => [product.sku, { ...product }])),
        gateways: new Map(ONLINE_GATEWAYS.map((gateway) => [gateway, { enabled: true }])),
        restockOrders: [],
        auditLog: [],
    };
}

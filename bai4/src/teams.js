// 4 đội xử lý của ShopFast. keywords (viết không dấu) chỉ dùng cho bộ phân loại dự phòng khi model lỗi/timeout.
export const TEAMS = {
    KHO_HANG: {
        name: "Sản phẩm & Tồn kho",
        description: "Hỏi còn hàng/hết hàng, size, màu, thông tin sản phẩm, khi nào có hàng lại; đơn đang chờ nhập hàng.",
        keywords: ["con hang", "het hang", "ton kho", "co hang", "ve hang", "con size", "con mau", "nhap hang", "thong tin san pham"],
    },
    THANH_TOAN: {
        name: "Thanh toán & Hoàn tiền",
        description: "Bị trừ tiền 2 lần, thanh toán lỗi/chưa ghi nhận, hoàn tiền, hoá đơn VAT, mã giảm giá khi thanh toán.",
        keywords: ["thanh toan", "tru tien", "bi tru", "hoan tien", "chuyen khoan", "vnpay", "momo", "the tin dung", "hoa don", "vat"],
    },
    VAN_CHUYEN: {
        name: "Giao hàng",
        description: "Đơn đang giao/giao chậm, đổi địa chỉ, liên hệ shipper, báo đã giao nhưng chưa nhận, chặn giao.",
        keywords: ["giao hang", "chua nhan", "chua giao", "giao cham", "van chuyen", "shipper", "van don", "doi dia chi", "bao gio giao", "khi nao toi"],
    },
    DOI_TRA: {
        name: "Đổi trả & Bảo hành",
        description: "Hàng lỗi, hỏng, giao sai sản phẩm, không đúng mô tả, muốn đổi/trả hàng đã nhận, bảo hành.",
        keywords: ["doi tra", "tra hang", "tra lai", "hang loi", "bi loi", "sai hang", "giao nham", "bao hanh", "bi hong", "khong dung mo ta"],
    },
};

export const TEAM_IDS = Object.keys(TEAMS);

// Khi không đoán được đội nào: đẩy về đội nhận nhiều ticket nhất và gắn cờ cần người xem lại.
export const DEFAULT_TEAM = "VAN_CHUYEN";

export const isTeam = (value) => typeof value === "string" && Object.hasOwn(TEAMS, value);

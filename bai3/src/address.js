// Quy ước: tỉnh/thành nằm ở CUỐI địa chỉ, sau dấu phẩy: "5 Trần Duy Hưng, Cầu Giấy, Hà Nội".
// Chỉ xét phần cuối để không nhận nhầm tên đường trùng tên tỉnh
// (đường Nguyễn Huệ ≠ TP Huế, đường Hồ Chí Minh ở Thanh Hóa...).

// 34 tỉnh/thành sau sắp xếp đơn vị hành chính (01/07/2025).
// aliases: cách viết khác, đã ở dạng chuẩn hoá (không dấu, chữ thường).
const PROVINCES = [
    { key: "ha-noi", name: "Hà Nội", aliases: ["hanoi", "hn"] },
    { key: "hue", name: "Huế", aliases: ["thua thien hue"] },
    { key: "hai-phong", name: "Hải Phòng" },
    { key: "da-nang", name: "Đà Nẵng", aliases: ["danang"] },
    { key: "ho-chi-minh", name: "TP. Hồ Chí Minh", aliases: ["hcm", "tphcm", "sai gon", "saigon"] },
    { key: "can-tho", name: "Cần Thơ" },
    { key: "lai-chau", name: "Lai Châu" },
    { key: "dien-bien", name: "Điện Biên" },
    { key: "son-la", name: "Sơn La" },
    { key: "lang-son", name: "Lạng Sơn" },
    { key: "cao-bang", name: "Cao Bằng" },
    { key: "tuyen-quang", name: "Tuyên Quang" },
    { key: "lao-cai", name: "Lào Cai" },
    { key: "thai-nguyen", name: "Thái Nguyên" },
    { key: "phu-tho", name: "Phú Thọ" },
    { key: "bac-ninh", name: "Bắc Ninh" },
    { key: "quang-ninh", name: "Quảng Ninh" },
    { key: "hung-yen", name: "Hưng Yên" },
    { key: "ninh-binh", name: "Ninh Bình" },
    { key: "thanh-hoa", name: "Thanh Hóa" },
    { key: "nghe-an", name: "Nghệ An" },
    { key: "ha-tinh", name: "Hà Tĩnh" },
    { key: "quang-tri", name: "Quảng Trị" },
    { key: "quang-ngai", name: "Quảng Ngãi" },
    { key: "gia-lai", name: "Gia Lai" },
    { key: "dak-lak", name: "Đắk Lắk", aliases: ["daklak"] },
    { key: "khanh-hoa", name: "Khánh Hòa" },
    { key: "lam-dong", name: "Lâm Đồng" },
    { key: "dong-nai", name: "Đồng Nai" },
    { key: "tay-ninh", name: "Tây Ninh" },
    { key: "vinh-long", name: "Vĩnh Long" },
    { key: "dong-thap", name: "Đồng Tháp" },
    { key: "an-giang", name: "An Giang" },
    { key: "ca-mau", name: "Cà Mau" },
];

const COUNTRY_NAMES = new Set(["viet nam", "vietnam", "vn"]);
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// "Đống Đa, TP. Hà Nội" -> "dong da tp ha noi"
export function normalizeText(text) {
    return String(text)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, "d")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

// "tp ha noi" -> "ha noi", "tinh nghe an" -> "nghe an"
function stripAdminPrefix(normalized) {
    return normalized.replace(/^(thanh pho|tp|tinh)\s+/, "");
}

const ALIAS_TO_PROVINCE = new Map();
for (const province of PROVINCES) {
    for (const alias of [stripAdminPrefix(normalizeText(province.name)), ...(province.aliases ?? [])]) {
        ALIAS_TO_PROVINCE.set(alias, province);
    }
}

export function getProvinceName(key) {
    return PROVINCES.find((province) => province.key === key)?.name ?? key;
}

// Trả về { ok: true, address, province } hoặc { ok: false, code, message }.
// Không throw, kể cả khi raw là null/số/object.
export function parseAddress(raw) {
    // Bẫy: rỗng, chỉ có khoảng trắng / dấu câu, hoặc không phải chuỗi.
    if (typeof raw !== "string" || !HAS_LETTER_OR_DIGIT.test(raw)) {
        return {
            ok: false,
            code: "EMPTY_ADDRESS",
            message: "Bạn chưa nhập địa chỉ mới. Bạn vui lòng gửi địa chỉ đầy đủ gồm số nhà, đường, phường/xã và tỉnh/thành phố nhé.",
        };
    }

    const address = raw.trim().replace(/\s*\n\s*/g, ", ").replace(/\s+/g, " ");
    const parts = address
        .split(/[,;]/)
        .map((part) => part.trim())
        .filter((part) => HAS_LETTER_OR_DIGIT.test(part));
    while (parts.length > 0 && COUNTRY_NAMES.has(normalizeText(parts.at(-1)))) {
        parts.pop();
    }

    const lastPart = parts.at(-1);
    const province = lastPart ? ALIAS_TO_PROVINCE.get(stripAdminPrefix(normalizeText(lastPart))) : undefined;

    // Bẫy: thiếu tên tỉnh/thành.
    if (!province) {
        return {
            ok: false,
            code: "MISSING_PROVINCE",
            message:
                "Địa chỉ của bạn chưa có tỉnh/thành phố (hoặc tỉnh/thành chưa nằm ở cuối). " +
                'Bạn vui lòng ghi tỉnh/thành ở cuối, cách nhau bằng dấu phẩy, ví dụ: "5 Trần Duy Hưng, Cầu Giấy, Hà Nội".',
        };
    }

    // Chỉ có mỗi tên tỉnh, ví dụ "Hà Nội".
    if (parts.length < 2) {
        return {
            ok: false,
            code: "INCOMPLETE_ADDRESS",
            message: "Địa chỉ mới mới chỉ có tên tỉnh/thành. Bạn vui lòng bổ sung số nhà, tên đường và phường/xã nhé.",
        };
    }

    return { ok: true, address, province };
}

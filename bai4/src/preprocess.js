// Tiền xử lý bằng code, không gọi AI. Xử lý bẫy "ticket 4.000 từ" TRƯỚC khi tốn token.

export const MAX_WORDS = 600; // dài hơn mức này thì cắt
const HEAD_WORDS = 200; // khách hay viết yêu cầu ở đầu rồi mới dán lịch sử chat...
const TAIL_WORDS = 400; // ...hoặc dán lịch sử rồi viết yêu cầu mới nhất ở cuối.
const MAX_CHARS = 6000; // chặn cả trường hợp 1 "từ" dài hàng chục nghìn ký tự (không có khoảng trắng)

// " ord1002 " -> "ORD1002"; sai định dạng -> null
export function normalizeOrderId(raw) {
    if (typeof raw !== "string") return null;
    const orderId = raw.trim().toUpperCase();
    return /^ORD\d{3,10}$/.test(orderId) ? orderId : null;
}

// Lấy mã đơn từ TOÀN BỘ nội dung, kể cả phần lịch sử chat sắp bị cắt bỏ.
export function extractOrderIds(text) {
    const found = text.match(/\bORD\d{3,10}\b/gi) ?? [];
    return [...new Set(found.map((id) => id.toUpperCase()))];
}

export function preprocessTicket(rawText) {
    if (typeof rawText !== "string") return { ok: false, code: "EMPTY_TICKET" };

    const text = rawText.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return { ok: false, code: "EMPTY_TICKET" };

    const orderIds = extractOrderIds(text);
    if (words.length <= MAX_WORDS && text.length <= MAX_CHARS) {
        return { ok: true, text, wordCount: words.length, truncated: false, orderIds };
    }

    const head = words.slice(0, HEAD_WORDS).join(" ");
    const tail = words.slice(-TAIL_WORDS).join(" ");
    const dropped = Math.max(0, words.length - HEAD_WORDS - TAIL_WORDS);
    let trimmed = words.length <= MAX_WORDS
        ? text
        : `${head}\n[... đã lược bỏ ${dropped} từ ở giữa (lịch sử chat cũ) ...]\n${tail}`;
    if (trimmed.length > MAX_CHARS) {
        const half = MAX_CHARS / 2;
        trimmed = `${trimmed.slice(0, half)}\n[... đã lược bỏ phần giữa ...]\n${trimmed.slice(-half)}`;
    }
    return { ok: true, text: trimmed, wordCount: words.length, truncated: true, orderIds };
}

// Bỏ dấu tiếng Việt để so khớp từ khoá: "Đã trừ tiền" -> "da tru tien"
export function foldVietnamese(text) {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

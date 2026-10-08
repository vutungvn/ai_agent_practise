// Bước xác nhận của con người trên giao diện dòng lệnh. Model không nhìn thấy và không trả lời thay được bước này.

// Không nhận "đúng"/"dừng": bỏ dấu đều thành "dung", mơ hồ -> hỏi lại.
const YES = new Set(["co", "c", "y", "yes", "ok", "dong y", "xac nhan", "lam di"]);
const NO = new Set(["khong", "k", "ko", "n", "no", "huy", "thoi", "dung lai", "khong dong y"]);
export const MAX_CONFIRM_ATTEMPTS = 3;

const fold = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

// "Có." -> YES, "hủy" -> NO, "để tôi nghĩ" -> UNCLEAR
export function parseConfirmation(raw) {
    if (typeof raw !== "string") return "UNCLEAR";
    const text = fold(raw).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
    if (YES.has(text)) return "YES";
    if (NO.has(text)) return "NO";
    return "UNCLEAR";
}

export function formatConfirmationRequest({ title, message }) {
    const line = "─".repeat(64);
    return `\n┌${line}\n│ ⚠  CẦN XÁC NHẬN: ${title}\n│ ${message}\n└${line}`;
}

// ask(question) -> Promise<string>. Hỏi tối đa 3 lần; vẫn không rõ thì coi là KHÔNG đồng ý (an toàn).
export function createConsoleConfirm(ask, print = console.log) {
    return async function confirm(request) {
        print(formatConfirmationRequest(request));
        for (let attempt = 1; attempt <= MAX_CONFIRM_ATTEMPTS; attempt++) {
            const answer = parseConfirmation(await ask("  Anh/chị xác nhận thực hiện? (có/không): "));
            if (answer === "YES") return true;
            if (answer === "NO") return false;
            if (attempt < MAX_CONFIRM_ATTEMPTS) print('  Em chưa rõ ý anh/chị, vui lòng gõ "có" hoặc "không".');
        }
        print("  Không nhận được xác nhận rõ ràng nên em huỷ thao tác này.");
        return false;
    };
}

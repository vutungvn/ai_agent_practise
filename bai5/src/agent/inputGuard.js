// Chặn đầu vào rỗng / không có chữ / quá dài TRƯỚC khi gọi model: trả lời lịch sự ngay, không tốn lời gọi.
import { MESSAGES } from "./messages.js";

export const MAX_INPUT_CHARS = 1000;

export function checkInput(raw) {
    if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reply: MESSAGES.EMPTY_INPUT };
    const text = raw.trim();
    if (!/[\p{L}\p{N}]/u.test(text)) return { ok: false, reply: MESSAGES.NO_CONTENT }; // "???", "...", emoji
    if (text.length > MAX_INPUT_CHARS) return { ok: false, reply: MESSAGES.TOO_LONG };
    return { ok: true, text };
}

// Tiện ích dùng chung cho tầng nghiệp vụ. Tầng này KHÔNG biết gì về AI.
import { addDays, nightWindow } from "../data/seed.js";

export const BASELINE_NIGHTS = 7;

// Mọi hàm nghiệp vụ trả về object, không throw ra ngoài vì lỗi dữ liệu đầu vào.
export const ok = (code, message, data) => ({ ok: true, code, message, ...(data === undefined ? {} : { data }) });
export const fail = (code, message) => ({ ok: false, code, message });

export const formatVnd = (n) => `${Math.round(n).toLocaleString("vi-VN")} đ`;
export const formatPercent = (ratio) => `${(ratio * 100).toFixed(1)}%`;
export const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

const toVietnamTime = (date) => new Date(date.getTime() + 7 * 3600_000).toISOString();
export const formatTime = (date) => toVietnamTime(date).slice(11, 16); // "01:30"
export const formatDateTime = (date) => `${formatTime(date)} ${toVietnamTime(date).slice(0, 10)}`;

export function describeWindow(morningDate) {
    const { start, end } = nightWindow(morningDate);
    return `${formatDateTime(start)} -> ${formatDateTime(end)}`;
}

export function ordersInNight(db, morningDate) {
    const { start, end } = nightWindow(morningDate);
    return [...db.orders.values()].filter((o) => o.createdAt >= start && o.createdAt < end);
}

// 7 đêm liền trước đêm đang xét, dùng làm mức "bình thường".
export function baselineDates(morningDate) {
    return Array.from({ length: BASELINE_NIGHTS }, (_, i) => addDays(morningDate, -(i + 1)));
}

export const cleanText = (value, maxLength = 200) => (typeof value === "string" ? value.trim().slice(0, maxLength) : "");

export function recordAudit(db, action, detail) {
    db.auditLog.push({ at: new Date().toISOString(), action, detail, confirmedBy: "Giám đốc vận hành" });
}

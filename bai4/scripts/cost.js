// Chạy: npm run cost   (không cần API key) - in bảng so sánh 3 kiến trúc kèm cách tính.
import { ASSUMPTIONS, ARCHITECTURES, estimate, avgTicketTokens } from "../src/costModel.js";
import { PRICING, MODEL } from "../src/llm.js";

const vnd = (n) => `${Math.round(n).toLocaleString("vi-VN")} đ`;
const a = ASSUMPTIONS;

console.log(`Model: ${MODEL} | giá: $${PRICING.inputUsdPer1M}/1M input, $${PRICING.outputUsdPer1M}/1M output | 1 USD = ${PRICING.usdToVnd.toLocaleString("vi-VN")} đ`);
console.log(`Khối lượng: ${a.ticketsPerDay} ticket/ngày x ${a.daysPerMonth} ngày = ${(a.ticketsPerDay * a.daysPerMonth).toLocaleString("vi-VN")} ticket/tháng; ${a.lookupShare * 100}% cần tra cứu`);
console.log(`Token nội dung ticket trung bình: ${avgTicketTokens(a, true).toFixed(0)} (đã cắt ticket dài) / ${avgTicketTokens(a, false).toFixed(0)} (không cắt)\n`);

const rows = Object.keys(ARCHITECTURES).map((key) => estimate(key));
console.table(rows.map((r) => ({
    "Kiến trúc": r.label,
    "Lời gọi/ticket": r.llmCallsPerTicket.toFixed(2),
    "Token in/ticket": Math.round(r.inputTokens),
    "Token out/ticket": Math.round(r.outputTokens),
    "API/tháng": vnd(r.apiVndPerMonth),
    "≤ 4tr?": r.withinBudget ? "có" : "KHÔNG",
    "Trễ TB (ms)": Math.round(r.avgLatencyMs),
    "Trễ ca tra cứu (ms)": Math.round(r.lookupLatencyMs),
    "Trễ xấu nhất, chưa chặn (ms)": Math.round(r.worstLatencyMs),
    "Trần ticket/ngày (4tr)": Math.floor(a.ticketsPerDay * a.budgetVndPerMonth / r.apiVndPerMonth),
    "Chính xác": `${(r.accuracy * 100).toFixed(1)}%`,
    "Gán sai/tháng": Math.round(r.misroutesPerMonth),
    "Giờ chuyển tay": Math.round(r.misrouteHoursPerMonth),
    "Tiền chuyển tay": vnd(r.misrouteVndPerMonth),
})));

const untrimmed = estimate("B_FULL_AGENT", { trimmed: false });
console.log(`\nNếu KHÔNG cắt ticket dài, agent đầy đủ tốn ${vnd(untrimmed.apiVndPerMonth)}/tháng (ticket 4.000 từ ~${a.longWords * a.tokensPerWord} token bị gửi lại ở MỌI vòng tool).`);

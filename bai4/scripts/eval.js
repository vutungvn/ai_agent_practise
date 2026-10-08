// Chạy: npm run eval   (cần GEMINI_API_KEY, tốn vài chục lời gọi model)
// Đo số THẬT trên bộ ticket mẫu: độ chính xác, độ trễ, token -> quy ra chi phí/tháng cho 3.000 ticket/ngày.
import { GoogleGenAI } from "@google/genai";
import { createRouter, RESPONSE_BUDGET_MS } from "../src/router.js";
import { createOrderDb } from "../src/orderDb.js";
import { MODEL, PRICING } from "../src/llm.js";
import { ASSUMPTIONS } from "../src/costModel.js";
import { SAMPLE_TICKETS } from "../data/sampleTickets.js";

if (!process.env.GEMINI_API_KEY) {
    console.error("Chưa có GEMINI_API_KEY. Copy .env.example thành .env và điền key.");
    process.exit(1);
}

const routeTicket = createRouter({
    ai: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
    db: createOrderDb(),
    log: (msg) => console.warn(`  [WARN] ${msg}`),
});

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const rows = [];
for (const ticket of SAMPLE_TICKETS) {
    const result = await routeTicket(ticket); // chạy tuần tự để độ trễ không bị ảnh hưởng bởi rate limit
    const predicted = result.routes.map((r) => r.team);
    rows.push({
        id: ticket.ticketId,
        words: result.meta.wordCount,
        expected: ticket.expected.join("+"),
        predicted: predicted.join("+"),
        ok: sameSet(predicted, ticket.expected) ? "✓" : "✗",
        via: result.routes.map((r) => r.via).join("+"),
        review: result.routes.some((r) => r.needsHumanReview) ? "!" : "",
        calls: result.meta.llmCalls,
        ms: result.meta.latencyMs,
        tokIn: result.meta.inputTokens,
        tokOut: result.meta.outputTokens,
        costUsd: result.meta.costUsd,
    });
}
console.table(rows.map(({ costUsd, ...r }) => r));

const n = rows.length;
const correct = rows.filter((r) => r.ok === "✓").length;
const latencies = rows.map((r) => r.ms).sort((a, b) => a - b);
const p95 = latencies[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
const avgUsd = rows.reduce((s, r) => s + r.costUsd, 0) / n;
const perMonth = ASSUMPTIONS.ticketsPerDay * ASSUMPTIONS.daysPerMonth;

console.log(`\nModel ${MODEL}`);
console.log(`Độ chính xác (đúng đủ tập đội): ${correct}/${n} = ${(100 * correct / n).toFixed(1)}%`);
console.log(`Độ trễ: TB ${Math.round(latencies.reduce((s, x) => s + x, 0) / n)}ms | p95 ${p95}ms | max ${latencies.at(-1)}ms | vượt ${RESPONSE_BUDGET_MS}ms: ${latencies.filter((x) => x > RESPONSE_BUDGET_MS).length}`);
console.log(`Chi phí TB: $${avgUsd.toFixed(6)}/ticket -> ~${Math.round(avgUsd * perMonth * PRICING.usdToVnd).toLocaleString("vi-VN")} đ/tháng cho ${perMonth.toLocaleString("vi-VN")} ticket`);
console.log("(Bộ mẫu có tỉ lệ ticket khó cao hơn thực tế ~2 lần, nên chi phí ở đây là cận trên.)");

// Kiến trúc lai: tiền xử lý (code) -> phân loại (1 lời gọi) -> chỉ vấn đề cần tra cứu mới vào agent.
// Mọi bước đều có đường lui nên luôn trả kết quả trước hạn 5 giây.
import { TEAMS } from "./teams.js";
import { preprocessTicket } from "./preprocess.js";
import { classifyTicket } from "./classifier.js";
import { keywordClassify } from "./fallback.js";
import { runLookupAgent } from "./lookupAgent.js";
import { createUsage, costUsd } from "./llm.js";

export const RESPONSE_BUDGET_MS = 5000;
const SAFETY_MARGIN_MS = 500; // để dành cho ghi ticket + gửi phản hồi cho khách
const CLASSIFIER_TIMEOUT_MS = 2000; // còn ≥ 2,5s cho agent

export function createRouter({
    ai,
    db,
    budgetMs = RESPONSE_BUDGET_MS,
    safetyMarginMs = SAFETY_MARGIN_MS,
    classifierTimeoutMs = CLASSIFIER_TIMEOUT_MS,
    now = Date.now,
    log = () => {},
}) {
    return async function routeTicket({ ticketId, text }) {
        const startedAt = now();
        const deadline = startedAt + budgetMs - safetyMarginMs;
        const usage = createUsage();

        const pre = preprocessTicket(text);
        if (!pre.ok) {
            return { ticketId, status: "REJECTED", code: pre.code, routes: [], meta: { latencyMs: now() - startedAt, ...usage, costUsd: 0 } };
        }

        let issues;
        let classifiedBy = "classifier";
        try {
            const timeoutMs = Math.min(classifierTimeoutMs, deadline - now());
            issues = await classifyTicket({ ai, text: pre.text, orderIds: pre.orderIds, timeoutMs, usage });
        } catch (err) {
            log(`[${ticketId}] classifier lỗi (${err.code ?? err.message}) -> dùng từ khoá`);
            issues = keywordClassify(pre.text);
            classifiedBy = "fallback";
        }

        // Các vấn đề cần tra cứu chạy agent SONG SONG, cùng chung một hạn chót.
        const routes = await Promise.all(issues.map(async (issue) => {
            const base = { team: issue.team, summary: issue.summary, orderId: issue.orderId, via: classifiedBy, needsHumanReview: classifiedBy === "fallback" };
            if (!issue.needsLookup) return base;

            // Mã đơn có thể nằm trong phần lịch sử chat đã bị cắt: lấy từ danh sách trích ở bước tiền xử lý.
            const orderId = issue.orderId ?? (pre.orderIds.length === 1 ? pre.orderIds[0] : null);
            if (!orderId) return { ...base, needsHumanReview: true, note: "Cần tra cứu nhưng ticket không có mã đơn" };

            try {
                const decision = await runLookupAgent({ ai, db, issue: { ...issue, orderId }, ticketText: pre.text, deadline, now, usage });
                return { ...base, orderId, team: decision.team, via: "agent", reason: decision.reason, needsHumanReview: decision.needsHumanReview, lookups: decision.lookups };
            } catch (err) {
                log(`[${ticketId}] agent lỗi (${err.code ?? err.message}) -> giữ đội của classifier`);
                return { ...base, orderId, needsHumanReview: true, note: `Agent không chốt được (${err.code ?? "ERROR"}), giữ đội tạm` };
            }
        }));

        const merged = mergeByTeam(routes).map((route) => ({ ...route, teamName: TEAMS[route.team].name }));
        return {
            ticketId,
            status: "ROUTED",
            primaryTeam: merged[0].team,
            routes: merged,
            meta: {
                wordCount: pre.wordCount,
                truncated: pre.truncated,
                orderIdsFound: pre.orderIds,
                classifiedBy,
                latencyMs: now() - startedAt,
                ...usage,
                costUsd: costUsd(usage),
            },
        };
    };
}

// 2 vấn đề cùng về 1 đội -> gộp làm 1 phiếu con, tránh đội đó nhận trùng.
export function mergeByTeam(routes) {
    const byTeam = new Map();
    for (const route of routes) {
        const existing = byTeam.get(route.team);
        if (!existing) {
            byTeam.set(route.team, { ...route });
            continue;
        }
        existing.summary = [existing.summary, route.summary].filter(Boolean).join("; ");
        existing.needsHumanReview ||= route.needsHumanReview;
        existing.orderId ??= route.orderId;
    }
    return [...byTeam.values()];
}

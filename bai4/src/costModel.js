// Ước tính chi phí / độ trễ / độ chính xác của 3 kiến trúc TRƯỚC khi build.
// Mọi con số là GIẢ ĐỊNH ghi rõ ở đây; chạy `npm run eval` để thay bằng số đo thật.
import { PRICING } from "./llm.js";

export const ASSUMPTIONS = {
    ticketsPerDay: 3000,
    daysPerMonth: 30,
    lookupShare: 0.3, // 30% ticket cần tra đơn
    longTicketShare: 0.02, // ~2% ticket dán cả lịch sử chat
    tokensPerWord: 1.5, // tiếng Việt: ~1,5 token / từ
    avgWords: 120,
    longWords: 4000,
    trimmedWords: 600, // sau tiền xử lý
    minutesPerMisroute: 6,
    staffVndPerHour: 40_000, // ~7 triệu/tháng / 176 giờ
    budgetVndPerMonth: 4_000_000,
    callMs: { classifier: 900, agentStep: 1100, dbLookup: 50 }, // độ trễ trung bình 1 lời gọi model output ngắn
};

// Mỗi kiến trúc mô tả bằng: các lời gọi model cho ticket thường / ticket cần tra cứu, và độ chính xác giả định.
// Một lời gọi = { base: token prompt cố định (system + schema/tool), ticket: true nếu chứa nội dung ticket, extra: token lịch sử cộng dồn, out: token output }
export const ARCHITECTURES = {
    A_SINGLE_CLASSIFIER: {
        label: "(a) 1 lời gọi phân loại",
        plain: [{ base: 700, ticket: true, out: 120 }],
        lookup: [{ base: 700, ticket: true, out: 120 }],
        accuracy: { plain: 0.95, lookup: 0.6 }, // không thấy trạng thái đơn -> đoán theo chữ
        maintenance: "Thấp: 1 prompt + 1 schema",
    },
    B_FULL_AGENT: {
        label: "(b) Agent đầy đủ cho mọi ticket",
        // ticket thường: phần lớn chốt ngay, ~40% vẫn gọi get_order "cho chắc" -> trung bình 1,4 lời gọi
        plain: [{ base: 1200, ticket: true, out: 80 }, { base: 1200, ticket: true, extra: 330, out: 80, weight: 0.4 }],
        lookup: [
            { base: 1200, ticket: true, out: 80 },
            { base: 1200, ticket: true, extra: 330, out: 80 },
            { base: 1200, ticket: true, extra: 660, out: 80, weight: 0.5 }, // nửa số ca tra thêm 1 lần
        ],
        accuracy: { plain: 0.95, lookup: 0.92 },
        maintenance: "Trung bình-cao: prompt dài, vòng lặp tool, khó tái hiện lỗi",
    },
    C_HYBRID: {
        label: "(c) Lai: phân loại -> agent khi cần",
        plain: [{ base: 700, ticket: true, out: 120 }],
        lookup: [
            { base: 700, ticket: true, out: 120 }, // tầng 1
            { base: 800, excerpt: 225, out: 80 }, // agent: chỉ nhận tóm tắt + 150 từ trích
            { base: 800, excerpt: 225, extra: 330, out: 80 },
        ],
        accuracy: { plain: 0.95, lookup: 0.92 },
        maintenance: "Trung bình: 2 prompt + luật fallback, mỗi tầng test riêng",
    },
};

export function avgTicketTokens(a = ASSUMPTIONS, trimmed = true) {
    const longWords = trimmed ? a.trimmedWords : a.longWords;
    const words = (1 - a.longTicketShare) * a.avgWords + a.longTicketShare * longWords;
    return words * a.tokensPerWord;
}

function pathCost(calls, ticketTokens) {
    let input = 0;
    let output = 0;
    for (const call of calls) {
        const w = call.weight ?? 1;
        input += w * (call.base + (call.ticket ? ticketTokens : 0) + (call.excerpt ?? 0) + (call.extra ?? 0));
        output += w * call.out;
    }
    return { input, output, calls: calls.reduce((s, c) => s + (c.weight ?? 1), 0) };
}

function pathLatency(archKey, calls, a) {
    if (archKey === "B_FULL_AGENT") return calls.reduce((s, c) => s + (c.weight ?? 1) * a.callMs.agentStep, 0) + (calls.length > 1 ? a.callMs.dbLookup : 0);
    // (a) và (c): lời gọi đầu là classifier, các lời gọi sau là bước agent
    return calls.reduce((s, c, i) => s + (c.weight ?? 1) * (i === 0 ? a.callMs.classifier : a.callMs.agentStep), 0) + (calls.length > 1 ? a.callMs.dbLookup : 0);
}

export function estimate(archKey, { trimmed = true, a = ASSUMPTIONS } = {}) {
    const arch = ARCHITECTURES[archKey];
    const ticketTokens = avgTicketTokens(a, trimmed);
    const plain = pathCost(arch.plain, ticketTokens);
    const lookup = pathCost(arch.lookup, ticketTokens);
    const mix = (x, y) => (1 - a.lookupShare) * x + a.lookupShare * y;

    const inputTokens = mix(plain.input, lookup.input);
    const outputTokens = mix(plain.output, lookup.output);
    const usdPerTicket = (inputTokens * PRICING.inputUsdPer1M + outputTokens * PRICING.outputUsdPer1M) / 1e6;
    const ticketsPerMonth = a.ticketsPerDay * a.daysPerMonth;
    const apiVndPerMonth = usdPerTicket * ticketsPerMonth * PRICING.usdToVnd;

    const accuracy = mix(arch.accuracy.plain, arch.accuracy.lookup);
    const misroutesPerMonth = (1 - accuracy) * ticketsPerMonth;
    const misrouteVndPerMonth = misroutesPerMonth * (a.minutesPerMisroute / 60) * a.staffVndPerHour;

    const plainMs = pathLatency(archKey, arch.plain, a);
    const lookupMs = pathLatency(archKey, arch.lookup, a);
    // ca xấu nhất: mọi lời gọi (kể cả có weight) đều xảy ra, mỗi lời gọi chậm gấp đôi trung bình
    const worstMs = 2 * pathLatency(archKey, arch.lookup.map((c) => ({ ...c, weight: 1 })), a);

    return {
        archKey,
        label: arch.label,
        maintenance: arch.maintenance,
        llmCallsPerTicket: mix(plain.calls, lookup.calls),
        inputTokens,
        outputTokens,
        usdPerTicket,
        apiVndPerMonth,
        withinBudget: apiVndPerMonth <= a.budgetVndPerMonth,
        avgLatencyMs: mix(plainMs, lookupMs),
        lookupLatencyMs: lookupMs,
        worstLatencyMs: worstMs,
        accuracy,
        misroutesPerMonth,
        misrouteHoursPerMonth: misroutesPerMonth * a.minutesPerMisroute / 60,
        misrouteVndPerMonth,
    };
}

// Gọi Gemini có giới hạn thời gian + đếm token để tính chi phí thật.
import { ThinkingLevel } from "@google/genai";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// Bảng giá dùng để quy đổi token ra tiền. Cập nhật theo bảng giá Google tại thời điểm chạy.
export const PRICING = {
    inputUsdPer1M: 0.3,
    outputUsdPer1M: 2.5, // token "thinking" cũng tính giá output
    usdToVnd: 26_000,
};

// Phân loại/định tuyến không cần suy luận dài: tắt bớt thinking để giảm độ trễ và tiền output.
export function thinkingConfig() {
    const level = (process.env.GEMINI_THINKING_LEVEL || "MINIMAL").toUpperCase();
    if (level === "OFF" || !Object.hasOwn(ThinkingLevel, level)) return undefined;
    return { thinkingLevel: ThinkingLevel[level] };
}

export function createUsage() {
    return { llmCalls: 0, inputTokens: 0, outputTokens: 0 };
}

export function costUsd({ inputTokens, outputTokens }) {
    return (inputTokens * PRICING.inputUsdPer1M + outputTokens * PRICING.outputUsdPer1M) / 1_000_000;
}

export class TimeoutError extends Error {
    constructor(ms) {
        super(`Quá ${ms}ms`);
        this.code = "TIMEOUT";
    }
}

// Huỷ request khi hết giờ. Promise.race để chắc chắn không bao giờ chờ quá timeoutMs,
// kể cả khi client không tôn trọng abortSignal.
export async function generateWithTimeout(ai, { contents, config, timeoutMs, usage }) {
    if (timeoutMs <= 0) throw new TimeoutError(0);
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError(timeoutMs));
        }, timeoutMs);
    });
    try {
        usage.llmCalls += 1;
        const response = await Promise.race([
            ai.models.generateContent({ model: MODEL, contents, config: { ...config, abortSignal: controller.signal } }),
            timeout,
        ]);
        const meta = response.usageMetadata ?? {};
        usage.inputTokens += meta.promptTokenCount ?? 0;
        usage.outputTokens += (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
        return response;
    } finally {
        clearTimeout(timer);
    }
}

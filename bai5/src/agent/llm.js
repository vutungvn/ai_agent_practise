// Gọi Gemini có giới hạn thời gian, để 1 request treo không làm treo cả phiên.
export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
export const CALL_TIMEOUT_MS = 30_000;

export async function generateWithTimeout(ai, { contents, config, timeoutMs = CALL_TIMEOUT_MS }) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(Object.assign(new Error(`Model không phản hồi sau ${timeoutMs}ms`), { code: "TIMEOUT" }));
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            ai.models.generateContent({ model: MODEL, contents, config: { ...config, abortSignal: controller.signal } }),
            timeout,
        ]);
    } finally {
        clearTimeout(timer);
    }
}

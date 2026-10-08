// Gemini giả cho test: không cần API key. script(request, index) trả về response cho lời gọi thứ index.
let callSeq = 0;

export function textResponse(text) {
    return { text, functionCalls: undefined, candidates: [{ content: { role: "model", parts: [{ text }] } }] };
}

export function callResponse(...calls) {
    const functionCalls = calls.map(([name, args]) => ({ id: `call_${++callSeq}`, name, args }));
    return { functionCalls, candidates: [{ content: { role: "model", parts: functionCalls.map((fc) => ({ functionCall: fc })) } }] };
}

export function createFakeAi(script) {
    const requests = [];
    const ai = {
        models: {
            async generateContent(request) {
                // Chụp lại contents tại thời điểm gọi (orchestrator tiếp tục sửa mảng history sau đó).
                requests.push({ ...request, contents: structuredClone(request.contents) });
                const step = Array.isArray(script) ? script[requests.length - 1] : script;
                if (step === undefined) throw new Error(`Không có kịch bản cho lời gọi thứ ${requests.length}`);
                return typeof step === "function" ? step(request, requests.length - 1) : step;
            },
        },
    };
    return { ai, requests };
}

// Lấy kết quả tool mà orchestrator gửi lại cho model ở lời gọi gần nhất.
export function lastToolResults(request) {
    return request.contents.at(-1).parts.filter((p) => p.functionResponse).map((p) => p.functionResponse.response);
}

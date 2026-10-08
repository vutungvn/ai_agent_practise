// Gemini giả cho test: không cần API key, điều khiển được output và độ trễ.
const USAGE = { promptTokenCount: 100, candidatesTokenCount: 20 };

export const jsonResponse = (obj) => ({ text: JSON.stringify(obj), usageMetadata: USAGE });
export const textResponse = (text) => ({ text, usageMetadata: USAGE });

let callSeq = 0;
export function callResponse(name, args) {
    const call = { id: `call_${++callSeq}`, name, args };
    return {
        functionCalls: [call],
        candidates: [{ content: { role: "model", parts: [{ functionCall: call }] } }],
        usageMetadata: USAGE,
    };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// classify / agent: hàm nhận request, trả response (có thể async). Ghi lại mọi request để kiểm tra.
export function createFakeAi({ classify, agent }) {
    const requests = { classifier: [], agent: [] };
    const ai = {
        models: {
            async generateContent(request) {
                const isClassifier = Boolean(request.config.responseSchema);
                (isClassifier ? requests.classifier : requests.agent).push(request);
                const handler = isClassifier ? classify : agent;
                if (!handler) throw new Error(`Không mong đợi lời gọi ${isClassifier ? "classifier" : "agent"}`);
                return handler(request);
            },
        },
    };
    return { ai, requests };
}

// Agent giả "biết luật": vòng 1 gọi get_order, vòng 2 đọc kết quả tool rồi chốt đội.
export function scriptedAgent(decide) {
    return (request) => {
        const last = request.contents.at(-1);
        const toolResult = last.parts.find((p) => p.functionResponse)?.functionResponse.response;
        if (!toolResult) {
            const orderId = /Mã đơn: (\S+)/.exec(request.contents[0].parts[0].text)[1];
            return callResponse("get_order", { orderId });
        }
        return callResponse("route_issue", { team: decide(toolResult), reason: `status=${toolResult.data?.status}` });
    };
}

// Luật giống system prompt của agent thật.
export function ruleBasedTeam(result) {
    if (!result.ok) return "VAN_CHUYEN";
    const { status, paymentStatus } = result.data;
    if (paymentStatus === "THAT_BAI" || status === "CHO_THANH_TOAN" || paymentStatus === "CHO_HOAN_TIEN") return "THANH_TOAN";
    if (status === "CHO_NHAP_HANG") return "KHO_HANG";
    return "VAN_CHUYEN";
}

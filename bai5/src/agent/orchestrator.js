// ĐIỀU PHỐI: vòng lặp agent (tối đa 8 vòng), giữ lịch sử hội thoại, xử lý mọi ngoại lệ.
import { createToolRegistry } from "../tools/registry.js";
import { buildSystemInstruction } from "./prompt.js";
import { generateWithTimeout, CALL_TIMEOUT_MS } from "./llm.js";
import { checkInput } from "./inputGuard.js";
import { runToolCall } from "./toolRunner.js";
import { MESSAGES, maxRoundsMessage, apiErrorMessage } from "./messages.js";

export const MAX_ROUNDS = 8; // 1 vòng = 1 lần gọi model
const MAX_HISTORY = 40; // giữ lịch sử vừa đủ để hỏi tiếp ("tắt nó đi"), không phình mãi

export function createOpsAgent({
    ai,
    db,
    confirm,
    registry = createToolRegistry(),
    callTimeoutMs = CALL_TIMEOUT_MS,
    log = () => {},
    onToolCall = () => {},
}) {
    const history = [];
    const config = {
        systemInstruction: buildSystemInstruction(db.reportDate),
        tools: [{ functionDeclarations: [...registry.values()].map((tool) => tool.declaration) }],
        temperature: 0.2,
    };

    // Kết thúc bất thường: bỏ các lượt dở dang, chỉ giữ câu hỏi + câu trả lời để lịch sử luôn hợp lệ cho lượt sau.
    function endAbnormally(snapshot, text, reply) {
        history.length = snapshot;
        history.push({ role: "user", parts: [{ text }] }, { role: "model", parts: [{ text: reply }] });
        return reply;
    }

    // Cắt lịch sử cũ, luôn bắt đầu bằng một câu hỏi của người dùng (không phải kết quả tool lẻ loi).
    function trimHistory() {
        while (history.length > MAX_HISTORY) {
            history.shift();
            while (history.length && !(history[0].role === "user" && history[0].parts?.[0]?.text !== undefined)) history.shift();
        }
    }

    // Không bao giờ throw: mọi lỗi đều thành câu trả lời lịch sự.
    async function ask(rawText) {
        const input = checkInput(rawText);
        if (!input.ok) return { reply: input.reply, actions: [], rounds: 0 };

        trimHistory();
        const snapshot = history.length;
        history.push({ role: "user", parts: [{ text: input.text }] });
        const actions = [];

        try {
            for (let round = 1; round <= MAX_ROUNDS; round++) {
                const response = await generateWithTimeout(ai, { contents: history, config, timeoutMs: callTimeoutMs });
                const calls = response.functionCalls ?? [];
                const modelContent = response.candidates?.[0]?.content;

                if (calls.length === 0) {
                    const reply = response.text?.trim();
                    if (!reply) return { reply: endAbnormally(snapshot, input.text, MESSAGES.EMPTY_REPLY), actions, rounds: round };
                    history.push(modelContent ?? { role: "model", parts: [{ text: reply }] });
                    return { reply, actions, rounds: round };
                }

                // Giữ nguyên content của model (có thought signature) rồi trả kết quả tool.
                history.push(modelContent ?? { role: "model", parts: calls.map((call) => ({ functionCall: call })) });
                const parts = [];
                for (const call of calls) { // tuần tự: mỗi thao tác ghi được hỏi xác nhận riêng
                    onToolCall(call);
                    const { result, action } = await runToolCall({ registry, db, call, confirm, log });
                    if (action) actions.push(action);
                    log(`[TOOL] ${call.name}(${JSON.stringify(call.args ?? {})}) -> ${result.code}`);
                    parts.push({ functionResponse: { id: call.id, name: call.name, response: result } });
                }
                history.push({ role: "user", parts });
            }
            return { reply: endAbnormally(snapshot, input.text, maxRoundsMessage(MAX_ROUNDS, actions)), actions, rounds: MAX_ROUNDS };
        } catch (err) {
            log(`[LỖI] ${err.status ?? err.code ?? ""} ${err.message}`);
            return { reply: endAbnormally(snapshot, input.text, apiErrorMessage(err, actions)), actions, rounds: null };
        }
    }

    return { ask, history };
}

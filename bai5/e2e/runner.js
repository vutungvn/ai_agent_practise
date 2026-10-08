// Chạy 1 kịch bản (scenarios.js) trên một agent mới với database mới, rồi chấm điểm.
import { createDb } from "../src/data/seed.js";
import { createOpsAgent } from "../src/agent/orchestrator.js";
import { createConsoleConfirm } from "../src/cli/confirm.js";

export async function runScenario(scenario, { ai, log = () => {} }) {
    const db = createDb();
    const c = { db, toolCalls: [], asked: [], turns: [], lastReply: "" };
    let turnNo = 0;
    let answers = {};
    let currentTool = null;

    // Dùng đúng giao diện xác nhận của chat.js, chỉ thay bàn phím bằng câu trả lời soạn sẵn theo từng tool.
    const consoleConfirm = createConsoleConfirm(async () => {
        const queue = answers[currentTool] ?? [];
        const answer = queue.length ? queue.shift() : "không"; // không soạn sẵn -> từ chối cho an toàn
        c.asked.at(-1).answers.push(answer);
        log(`giám đốc gõ: "${answer}"`);
        return answer;
    }, log);
    const confirm = (request) => {
        currentTool = request.tool;
        c.asked.push({ turn: turnNo, tool: request.tool, message: request.message, answers: [] });
        return consoleConfirm(request);
    };

    const agent = createOpsAgent({
        ai,
        db,
        confirm,
        onToolCall: (call) => {
            c.toolCalls.push({ turn: turnNo, name: call.name, args: call.args ?? {} });
            log(`tool: ${call.name}(${JSON.stringify(call.args ?? {})})`);
        },
    });

    for (const turn of scenario.turns) {
        turnNo++;
        answers = structuredClone(turn.answers ?? {});
        const started = Date.now();
        const result = await agent.ask(turn.say);
        c.turns.push({ say: turn.say, reply: result.reply, rounds: result.rounds, actions: result.actions, ms: Date.now() - started });
        c.lastReply = result.reply;
    }

    const check = (list) => list.map(([label, fn]) => {
        try {
            return { label, pass: Boolean(fn(c)) };
        } catch (err) {
            return { label, pass: false, error: err.message };
        }
    });
    const hard = check(scenario.expect);
    const apiError = c.turns.some((t) => t.rounds === null);
    const status = apiError ? "LỖI API" : hard.every((r) => r.pass) ? "PASS" : "FAIL";
    return { c, hard, soft: check(scenario.soft ?? []), status };
}

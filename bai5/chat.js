// Chạy: npm start   (cần GEMINI_API_KEY trong .env)
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { GoogleGenAI } from "@google/genai";
import { createDb } from "./src/data/seed.js";
import { createOpsAgent } from "./src/agent/orchestrator.js";
import { MODEL } from "./src/agent/llm.js";
import { createConsoleConfirm } from "./src/cli/confirm.js";
import { CAPABILITIES } from "./src/agent/messages.js";

if (!process.env.GEMINI_API_KEY) {
    console.error("Chưa có GEMINI_API_KEY. Copy .env.example thành .env và điền key.");
    process.exit(1);
}

const rl = readline.createInterface({ input, output });
// Ctrl+C / Ctrl+D: thoát êm, không in stack trace.
rl.on("close", () => {
    console.log("\nTạm biệt anh/chị!");
    process.exit(0);
});
const ask = async (question) => {
    try {
        return await rl.question(question);
    } catch {
        return "";
    }
};

const db = createDb();
const agent = createOpsAgent({
    ai: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
    db,
    confirm: createConsoleConfirm(ask),
    log: (msg) => (process.env.DEBUG ? console.log(`  ${msg}`) : undefined),
    onToolCall: (call) => console.log(`  … đang tra cứu: ${call.name}`),
});

console.log(`Trợ lý vận hành ShopFast | dữ liệu sáng ${db.reportDate} | model ${MODEL}`);
console.log(`${CAPABILITIES}\nGõ "thoat" để thoát.\n`);

while (true) {
    const text = await ask("Giám đốc: ");
    if (["thoat", "thoát", "exit", "quit"].includes(text.trim().toLowerCase())) break;
    const { reply, actions } = await agent.ask(text);
    console.log(`\nTrợ lý: ${reply}\n`);
    for (const action of actions) console.log(`  [${action.status}] ${action.message}`);
    if (actions.length) console.log();
}
rl.close();

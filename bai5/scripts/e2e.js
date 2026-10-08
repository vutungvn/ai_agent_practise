// Chạy kịch bản test với Gemini THẬT (cần GEMINI_API_KEY trong .env).
//   npm run e2e                         chạy tất cả kịch bản
//   npm run e2e -- A2 C1                chỉ chạy A2 và C1
//   npm run e2e -- --repeat=3           chạy mỗi kịch bản 3 lần để đo độ ổn định
//   npm run e2e -- --interval=4000      giãn mỗi lời gọi model ≥ 4 giây (gói miễn phí hay bị 429)
//   npm run e2e -- --verbose            in thêm khung xác nhận và từng tool được gọi
//   npm run e2e -- --save               lưu toàn bộ kết quả (UTF-8) vào ket-qua-e2e.txt
import { writeFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { MODEL } from "../src/agent/llm.js";
import { SCENARIOS } from "../e2e/scenarios.js";
import { runScenario } from "../e2e/runner.js";

if (!process.env.GEMINI_API_KEY) {
    console.error("Chưa có GEMINI_API_KEY. Copy .env.example thành .env và điền key.");
    process.exit(1);
}

const args = process.argv.slice(2);
const option = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const repeat = Math.max(1, option("repeat", 1));
const intervalMs = Math.max(0, option("interval", 0));
const verbose = args.includes("--verbose");
const SAVE_FILE = "ket-qua-e2e.txt";
if (args.includes("--save")) {
    // Ghi file trực tiếp bằng UTF-8: chuyển hướng qua PowerShell 5.1 dễ làm lỗi font tiếng Việt.
    const chunks = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => {
        chunks.push(String(chunk));
        return write(chunk, ...rest);
    };
    process.on("exit", () => {
        writeFileSync(SAVE_FILE, chunks.join(""), "utf8");
        write(`Đã lưu kết quả vào ${SAVE_FILE}\n`);
    });
}
const onlyIds = args.filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
const selected = onlyIds.length ? SCENARIOS.filter((s) => onlyIds.includes(s.id)) : SCENARIOS;
if (selected.length === 0) {
    console.error(`Không có kịch bản ${onlyIds.join(", ")}. Có: ${SCENARIOS.map((s) => s.id).join(", ")}`);
    process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Giãn khoảng cách giữa các lời gọi model để tránh vượt giới hạn số request/phút.
function throttled(ai) {
    let last = 0;
    return {
        models: {
            async generateContent(request) {
                const wait = last + intervalMs - Date.now();
                if (wait > 0) await sleep(wait);
                last = Date.now();
                return ai.models.generateContent(request);
            },
        },
    };
}

const realAi = throttled(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
const log = (msg) => verbose && console.log(`      ${msg}`);

console.log(`E2E với model thật | ${MODEL} | ${selected.length} kịch bản x ${repeat} lần | giãn ${intervalMs}ms/lời gọi\n`);
const summary = [];

for (const scenario of selected) {
    for (let run = 1; run <= repeat; run++) {
        const tag = repeat > 1 ? `${scenario.id}#${run}` : scenario.id;
        console.log(`${"─".repeat(80)}\n[${tag}] ${scenario.group} - ${scenario.title}`);
        const { c, hard, soft, status } = await runScenario(scenario, { ai: realAi, log });

        for (const t of c.turns) {
            console.log(`\n  Giám đốc: ${JSON.stringify(t.say)}`);
            console.log(`  Trợ lý:   ${t.reply.replace(/\n/g, "\n            ")}`);
            for (const a of t.actions) console.log(`            [${a.status}] ${a.message}`);
            console.log(`            (${t.rounds ?? "lỗi"} vòng, ${t.ms}ms)`);
        }
        console.log(`\n  Tool đã gọi: ${c.toolCalls.map((t) => t.name).join(" -> ") || "(không)"}`);
        if (c.asked.length) console.log(`  Bị hỏi xác nhận: ${c.asked.map((a) => `${a.tool} [${a.answers.join(", ")}]`).join("; ")}`);

        for (const r of hard) console.log(`  ${r.pass ? "✓" : "✗"} ${r.label}${r.error ? ` (lỗi kiểm tra: ${r.error})` : ""}`);
        for (const r of soft) console.log(`  ${r.pass ? "✓" : "?"} (mềm) ${r.label}`);

        console.log(`  => ${status}${status === "LỖI API" ? " (lỗi gọi model, xem câu trả lời ở trên; thử --interval=4000)" : ""}\n`);
        summary.push({
            "Kịch bản": tag,
            "Nhóm": scenario.group,
            "Kết quả": status,
            "Cứng": `${hard.filter((r) => r.pass).length}/${hard.length}`,
            "Mềm": soft.length ? `${soft.filter((r) => r.pass).length}/${soft.length}` : "-",
            "Lời gọi model": c.turns.reduce((s, t) => s + (t.rounds ?? 0), 0),
            "Thời gian (s)": (c.turns.reduce((s, t) => s + t.ms, 0) / 1000).toFixed(1),
        });
    }
}

console.log("TỔNG KẾT");
console.table(summary);
const count = (status) => summary.filter((r) => r["Kết quả"] === status).length;
console.log(`PASS ${count("PASS")} | FAIL ${count("FAIL")} | LỖI API ${count("LỖI API")} / ${summary.length}`);
console.log('Dấu "?" ở kiểm tra mềm: model diễn đạt khác dự kiến. Đọc lại câu trả lời ở trên để tự đánh giá.');
process.exitCode = count("FAIL") + count("LỖI API") > 0 ? 1 : 0;

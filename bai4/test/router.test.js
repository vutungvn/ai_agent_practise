// Chạy: npm test   (không cần API key - dùng Gemini giả trong fakeAi.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { preprocessTicket, MAX_WORDS } from "../src/preprocess.js";
import { parseClassification, buildClassifierInput } from "../src/classifier.js";
import { keywordClassify } from "../src/fallback.js";
import { createRouter, mergeByTeam } from "../src/router.js";
import { createOrderDb, getOrder } from "../src/orderDb.js";
import { estimate } from "../src/costModel.js";
import { SAMPLE_TICKETS, makeChatHistory } from "../data/sampleTickets.js";
import { createFakeAi, jsonResponse, textResponse, callResponse, scriptedAgent, ruleBasedTeam, sleep } from "./fakeAi.js";

const sample = (id) => SAMPLE_TICKETS.find((t) => t.ticketId === id);
const issue = (team, extra = {}) => ({ team, summary: `vấn đề ${team}`, needsLookup: false, orderId: null, ...extra });
const makeRouter = (ai, opts = {}) => createRouter({ ai, db: createOrderDb(), ...opts });

// ---------- Tiền xử lý: bẫy ticket 4.000 từ ----------

test("ticket ngắn giữ nguyên", () => {
    const pre = preprocessTicket("  Áo   thun size L còn hàng không?  ");
    assert.equal(pre.text, "Áo thun size L còn hàng không?");
    assert.equal(pre.truncated, false);
});

test("ticket ~4.000 từ bị cắt còn ≤ 600 từ, giữ đầu + cuối, vẫn lấy được mã đơn ở phần bị cắt", () => {
    const pre = preprocessTicket(sample("T18").text);
    assert.ok(pre.wordCount >= 4000, `wordCount=${pre.wordCount}`);
    assert.equal(pre.truncated, true);
    const words = pre.text.split(/\s+/).length;
    assert.ok(words <= MAX_WORDS + 20, `còn ${words} từ`);
    assert.ok(pre.text.startsWith("Đơn của mình sao mãi chưa giao vậy"));
    assert.ok(!pre.text.includes("ORD1002"), "mã đơn nằm ở phần giữa đã bị cắt");
    assert.deepEqual(pre.orderIds, ["ORD1002"]); // nhưng vẫn được trích ra trước khi cắt
});

test("ticket dài có yêu cầu ở cuối: phần cuối được giữ", () => {
    const pre = preprocessTicket(sample("T17").text);
    assert.ok(pre.text.endsWith("Tóm lại đơn ORD1003 của mình bao giờ mới được giao vậy?"));
});

test("một chuỗi khổng lồ không có khoảng trắng vẫn bị chặn độ dài", () => {
    const pre = preprocessTicket("a".repeat(100_000));
    assert.ok(pre.text.length < 7000);
});

test("ticket rỗng / khoảng trắng / không phải chuỗi -> EMPTY_TICKET", () => {
    for (const raw of ["", "   \n\t ", null, undefined, 42, {}]) {
        assert.equal(preprocessTicket(raw).code, "EMPTY_TICKET", JSON.stringify(raw));
    }
});

// ---------- Kiểm tra output của model ----------

test("parseClassification: lọc đội lạ, tối đa 3 vấn đề, chuẩn hoá mã đơn", () => {
    const issues = parseClassification(JSON.stringify({
        issues: [
            { team: "THANH_TOAN", summary: "trừ tiền 2 lần", needsLookup: false, orderId: " ord1001 " },
            { team: "MARKETING", summary: "đội không tồn tại", needsLookup: false },
            { team: "KHO_HANG", summary: "a", needsLookup: "true", orderId: "abc" },
            { team: "DOI_TRA", summary: "b", needsLookup: true },
            { team: "VAN_CHUYEN", summary: "c", needsLookup: false },
        ],
    }));
    assert.deepEqual(issues.map((i) => i.team), ["THANH_TOAN", "KHO_HANG", "DOI_TRA"]);
    assert.equal(issues[0].orderId, "ORD1001");
    assert.equal(issues[1].orderId, null);
    assert.equal(issues[1].needsLookup, false); // chuỗi "true" không được tính
});

test("parseClassification: JSON hỏng hoặc không có vấn đề hợp lệ -> throw INVALID_OUTPUT", () => {
    for (const raw of ["xin chào", "", "{}", '{"issues":[]}', '{"issues":[{"team":"ABC"}]}']) {
        assert.throws(() => parseClassification(raw), { code: "INVALID_OUTPUT" }, raw);
    }
});

test("input gửi classifier có gợi ý mã đơn và bọc ticket trong thẻ <ticket>", () => {
    const input = buildClassifierInput("nội dung", ["ORD1002"]);
    assert.match(input, /ORD1002/);
    assert.match(input, /<ticket>\nnội dung\n<\/ticket>/);
});

// ---------- Dự phòng bằng từ khoá ----------

test("từ khoá: ticket đa vấn đề ra 2 đội", () => {
    const teams = keywordClassify(sample("T15").text).map((i) => i.team).sort();
    assert.deepEqual(teams, ["KHO_HANG", "THANH_TOAN"]);
});

test("từ khoá: không khớp gì -> đội mặc định", () => {
    assert.equal(keywordClassify("xin chào").length, 1);
});

test("gộp 2 vấn đề cùng đội thành 1 phiếu", () => {
    const merged = mergeByTeam([issue("THANH_TOAN"), issue("KHO_HANG"), { ...issue("THANH_TOAN"), needsHumanReview: true }]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].summary, "vấn đề THANH_TOAN; vấn đề THANH_TOAN");
    assert.equal(merged[0].needsHumanReview, true);
});

// ---------- Router: luồng chính ----------

test("ticket chỉ cần gán nhãn: 1 lời gọi, KHÔNG vào agent", async () => {
    const { ai, requests } = createFakeAi({ classify: () => jsonResponse({ issues: [issue("KHO_HANG")] }) });
    const result = await makeRouter(ai)(sample("T01"));
    assert.equal(result.primaryTeam, "KHO_HANG");
    assert.equal(result.routes[0].via, "classifier");
    assert.equal(result.meta.llmCalls, 1);
    assert.equal(requests.agent.length, 0);
    assert.ok(result.meta.costUsd > 0);
});

test("bẫy đa vấn đề: tồn kho + thanh toán -> 2 phiếu con cho 2 đội", async () => {
    const { ai } = createFakeAi({
        classify: () => jsonResponse({ issues: [issue("KHO_HANG"), issue("THANH_TOAN", { orderId: "ORD1001" })] }),
    });
    const result = await makeRouter(ai)(sample("T15"));
    assert.deepEqual(result.routes.map((r) => r.team), ["KHO_HANG", "THANH_TOAN"]);
    assert.equal(result.routes[1].orderId, "ORD1001");
});

test("ticket cần tra cứu: agent tra đơn và SỬA đội đoán sai của classifier", async () => {
    const { ai, requests } = createFakeAi({
        // classifier đoán "giao hàng" vì khách hỏi chưa giao...
        classify: () => jsonResponse({ issues: [issue("VAN_CHUYEN", { needsLookup: true, orderId: "ORD1002" })] }),
        agent: scriptedAgent(ruleBasedTeam),
    });
    const result = await makeRouter(ai)(sample("T09"));
    // ...nhưng đơn thanh toán VNPAY thất bại nên thực ra là việc của đội thanh toán.
    assert.equal(result.primaryTeam, "THANH_TOAN");
    assert.equal(result.routes[0].via, "agent");
    assert.deepEqual(result.routes[0].lookups, [{ tool: "get_order", orderId: "ORD1002", code: "FOUND" }]);
    assert.equal(result.meta.llmCalls, 3);
    assert.equal(requests.agent.length, 2);
});

test("đa vấn đề + 1 vấn đề cần tra cứu: chỉ vấn đề đó vào agent", async () => {
    const { ai, requests } = createFakeAi({
        classify: () => jsonResponse({ issues: [issue("VAN_CHUYEN", { needsLookup: true, orderId: "ORD1002" }), issue("KHO_HANG")] }),
        agent: scriptedAgent(ruleBasedTeam),
    });
    const result = await makeRouter(ai)(sample("T16"));
    assert.deepEqual(result.routes.map((r) => r.team), ["THANH_TOAN", "KHO_HANG"]);
    assert.deepEqual(result.routes.map((r) => r.via), ["agent", "classifier"]);
    assert.equal(requests.agent.length, 2);
});

test("bẫy 4.000 từ: classifier nhận bản đã cắt + gợi ý mã đơn; agent dùng mã đơn trích từ phần bị cắt", async () => {
    const { ai, requests } = createFakeAi({
        // model không thấy mã đơn trong đoạn đã cắt nên trả orderId = null
        classify: () => jsonResponse({ issues: [issue("VAN_CHUYEN", { needsLookup: true })] }),
        agent: scriptedAgent(ruleBasedTeam),
    });
    const result = await makeRouter(ai)(sample("T18"));
    const sentWords = requests.classifier[0].contents.split(/\s+/).length;
    assert.ok(sentWords < 700, `gửi ${sentWords} từ`);
    assert.match(requests.classifier[0].contents, /ORD1002/);
    assert.equal(result.meta.truncated, true);
    assert.equal(result.routes[0].orderId, "ORD1002");
    assert.equal(result.primaryTeam, "THANH_TOAN");
});

test("cần tra cứu nhưng không có mã đơn: giữ đội tạm, gắn cờ cần người xem, không gọi agent", async () => {
    const { ai, requests } = createFakeAi({ classify: () => jsonResponse({ issues: [issue("VAN_CHUYEN", { needsLookup: true })] }) });
    const result = await makeRouter(ai)({ ticketId: "X", text: "Đơn của mình sao chưa giao vậy?" });
    assert.equal(result.primaryTeam, "VAN_CHUYEN");
    assert.equal(result.routes[0].needsHumanReview, true);
    assert.equal(requests.agent.length, 0);
});

test("ticket rỗng bị từ chối, không tốn lời gọi model", async () => {
    const { ai, requests } = createFakeAi({});
    const result = await makeRouter(ai)({ ticketId: "X", text: "    " });
    assert.equal(result.status, "REJECTED");
    assert.equal(requests.classifier.length, 0);
});

// ---------- Router: lỗi và quá giờ không làm hỏng luồng ----------

test("classifier trả rác -> dùng từ khoá, vẫn ra 2 đội cho ticket đa vấn đề", async () => {
    const { ai } = createFakeAi({ classify: () => textResponse("Xin lỗi, tôi không hiểu") });
    const result = await makeRouter(ai)(sample("T15"));
    assert.equal(result.meta.classifiedBy, "fallback");
    assert.deepEqual(result.routes.map((r) => r.team).sort(), ["KHO_HANG", "THANH_TOAN"]);
    assert.ok(result.routes.every((r) => r.needsHumanReview));
});

test("classifier treo -> cắt đúng hạn, dùng từ khoá", async () => {
    const { ai } = createFakeAi({ classify: () => new Promise(() => {}) });
    const started = Date.now();
    const result = await makeRouter(ai, { classifierTimeoutMs: 100 })(sample("T02"));
    assert.ok(Date.now() - started < 1000);
    assert.equal(result.primaryTeam, "THANH_TOAN");
    assert.equal(result.meta.classifiedBy, "fallback");
});

test("agent treo -> trả kết quả trước hạn chót, giữ đội classifier + cần người xem", async () => {
    const { ai } = createFakeAi({
        classify: () => jsonResponse({ issues: [issue("VAN_CHUYEN", { needsLookup: true, orderId: "ORD1002" })] }),
        agent: () => new Promise(() => {}),
    });
    // ngân sách thu nhỏ 10 lần để test chạy nhanh: 500ms, chừa 50ms
    const result = await makeRouter(ai, { budgetMs: 500, safetyMarginMs: 50 })(sample("T09"));
    assert.ok(result.meta.latencyMs < 500, `${result.meta.latencyMs}ms`);
    assert.equal(result.primaryTeam, "VAN_CHUYEN");
    assert.equal(result.routes[0].needsHumanReview, true);
    assert.match(result.routes[0].note, /TIMEOUT/);
});

test("classifier chậm ăn hết thời gian -> agent không được chạy quá hạn", async () => {
    const { ai, requests } = createFakeAi({
        classify: async () => {
            await sleep(420);
            return jsonResponse({ issues: [issue("VAN_CHUYEN", { needsLookup: true, orderId: "ORD1002" })] });
        },
        agent: async (request) => {
            await sleep(50); // chậm hơn 30ms còn lại
            return scriptedAgent(ruleBasedTeam)(request);
        },
    });
    const result = await makeRouter(ai, { budgetMs: 500, safetyMarginMs: 50, classifierTimeoutMs: 450 })(sample("T09"));
    assert.ok(result.meta.latencyMs < 500, `${result.meta.latencyMs}ms`);
    assert.equal(result.routes[0].needsHumanReview, true);
    assert.ok(requests.agent.length <= 1);
});

test("agent lặp get_order mãi không chốt -> dừng sau MAX_ROUNDS", async () => {
    const { ai, requests } = createFakeAi({
        classify: () => jsonResponse({ issues: [issue("VAN_CHUYEN", { needsLookup: true, orderId: "ORD1001" })] }),
        agent: () => callResponse("get_order", { orderId: "ORD1001" }),
    });
    const result = await makeRouter(ai)(sample("T11"));
    assert.equal(requests.agent.length, 3);
    assert.match(result.routes[0].note, /MAX_ROUNDS/);
});

test("agent chốt đội không tồn tại -> bị chặn", async () => {
    const { ai } = createFakeAi({
        classify: () => jsonResponse({ issues: [issue("VAN_CHUYEN", { needsLookup: true, orderId: "ORD1001" })] }),
        agent: () => callResponse("route_issue", { team: "BAN_GIAM_DOC", reason: "x" }),
    });
    const result = await makeRouter(ai)(sample("T11"));
    assert.equal(result.primaryTeam, "VAN_CHUYEN");
    assert.match(result.routes[0].note, /INVALID_TEAM/);
});

test("API lỗi mạng ở classifier -> không throw ra ngoài", async () => {
    const { ai } = createFakeAi({ classify: () => Promise.reject(new Error("fetch failed")) });
    const result = await makeRouter(ai)(sample("T07"));
    assert.equal(result.status, "ROUTED");
    assert.equal(result.primaryTeam, "DOI_TRA");
});

// ---------- Dữ liệu đơn + mô hình chi phí ----------

test("get_order: chuẩn hoá mã, đơn không tồn tại, mã sai", () => {
    const db = createOrderDb();
    assert.equal(getOrder(db, " ord1003 ").data.status, "CHO_NHAP_HANG");
    assert.equal(getOrder(db, "ORD9999").code, "ORDER_NOT_FOUND");
    assert.equal(getOrder(db, "abc").code, "INVALID_ORDER_ID");
});

test("mô hình chi phí: kiến trúc lai nằm trong 4 triệu/tháng và ca tra cứu < 4,5s", () => {
    const hybrid = estimate("C_HYBRID");
    assert.ok(hybrid.withinBudget, `${hybrid.apiVndPerMonth}`);
    assert.ok(hybrid.lookupLatencyMs < 4500);
    assert.ok(hybrid.apiVndPerMonth < estimate("B_FULL_AGENT").apiVndPerMonth);
    assert.ok(hybrid.misroutesPerMonth < estimate("A_SINGLE_CLASSIFIER").misroutesPerMonth);
});

test("lịch sử chat giả đủ ~4.000 từ", () => {
    assert.ok(makeChatHistory(4000).split(/\s+/).length >= 4000);
});

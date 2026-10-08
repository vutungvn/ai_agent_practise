// Chạy: npm test - kiểm tra tầng ĐIỀU PHỐI bằng Gemini giả (không cần API key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/data/seed.js";
import { createOpsAgent, MAX_ROUNDS } from "../src/agent/orchestrator.js";
import { createToolRegistry, TOOL_KIND } from "../src/tools/registry.js";
import { toolDeclarations } from "../src/tools/definitions.js";
import { parseConfirmation, createConsoleConfirm } from "../src/cli/confirm.js";
import { findSuspiciousOrders } from "../src/services/orderService.js";
import { createFakeAi, textResponse, callResponse, lastToolResults } from "./fakeAi.js";

const DISABLE_VNPAY = ["set_payment_gateway_status", { gateway: "VNPAY", enabled: false, reason: "GATEWAY_TIMEOUT từ 01:00" }];

// confirm giả: ghi lại các lần được hỏi, trả lời theo answers.
function fakeConfirm(...answers) {
    const asked = [];
    const confirm = async (request) => {
        asked.push(request);
        const answer = answers.shift();
        if (answer instanceof Error) throw answer;
        return answer;
    };
    return { confirm, asked };
}

function setup(script, { answers = [], ...options } = {}) {
    const db = createDb();
    const { ai, requests } = createFakeAi(script);
    const { confirm, asked } = fakeConfirm(...answers);
    const agent = createOpsAgent({ ai, db, confirm, ...options });
    return { agent, db, requests, asked };
}

// ---------- Ràng buộc của đề bài ----------

test("có ≥ 4 tool, trong đó ≥ 1 tool ghi và ≥ 1 tool tổng hợp; tool ghi nào cũng có preview", () => {
    const tools = [...createToolRegistry().values()];
    assert.ok(tools.length >= 4);
    assert.ok(tools.some((t) => t.kind === TOOL_KIND.WRITE));
    assert.ok(tools.some((t) => t.kind === TOOL_KIND.AGGREGATE));
    assert.ok(tools.filter((t) => t.kind === TOOL_KIND.WRITE).every((t) => typeof t.preview === "function"));
    assert.equal(tools.length, toolDeclarations.length);
});

test("không tool nào có tham số cho model tự khai đã xác nhận", () => {
    for (const d of toolDeclarations) {
        const props = Object.keys(d.parameters?.properties ?? {});
        assert.ok(!props.some((p) => /confirm/i.test(p)), d.name);
    }
});

// ---------- Đầu vào rỗng / vô nghĩa ----------

test("rỗng, khoảng trắng, không phải chuỗi, chỉ ký tự đặc biệt, quá dài -> trả lời lịch sự, không gọi model", async () => {
    const { agent, requests } = setup([]);
    for (const input of ["", "    ", "\n\t", null, undefined, 42, {}, "???", "... !!!", "🙂🙂", "a".repeat(5000)]) {
        const { reply, rounds } = await agent.ask(input);
        assert.ok(reply.length > 20, JSON.stringify(input));
        assert.match(reply, /anh\/chị/i);
        assert.equal(rounds, 0);
    }
    assert.equal(requests.length, 0);
});

test("câu vô nghĩa có chữ được chuyển cho model và nhận câu trả lời lịch sự", async () => {
    const { agent, requests } = setup([textResponse("Em chưa hiểu ý anh/chị ạ. Em có thể giúp xem bất thường đêm qua...")]);
    const { reply } = await agent.ask("asdkj qwe zzz");
    assert.match(reply, /chưa hiểu/);
    assert.equal(requests.length, 1);
});

// ---------- Luồng đọc ----------

test("câu hỏi chung: gọi tool tổng hợp rồi trả lời, KHÔNG hỏi xác nhận", async () => {
    const { agent, requests, asked } = setup([
        callResponse(["get_overnight_report", {}]),
        (request) => {
            const [report] = lastToolResults(request);
            assert.equal(report.code, "OVERNIGHT_REPORT");
            return textResponse(`Đêm qua có ${report.data.anomalies.length} bất thường.`);
        },
    ]);
    const { reply, rounds, actions } = await agent.ask("Đêm qua có gì bất thường không?");
    assert.equal(reply, "Đêm qua có 4 bất thường.");
    assert.equal(rounds, 2);
    assert.equal(asked.length, 0);
    assert.deepEqual(actions, []);
    assert.equal(requests[0].config.tools[0].functionDeclarations.length, toolDeclarations.length);
});

test("nhiều tool đọc trong 1 lượt chạy được hết", async () => {
    const { agent } = setup([
        callResponse(["get_payment_failures", { gateway: "VNPAY" }], ["get_stock_alerts", {}]),
        (request) => {
            assert.deepEqual(lastToolResults(request).map((r) => r.code), ["PAYMENT_FAILURES", "STOCK_ALERTS"]);
            return textResponse("ok");
        },
    ]);
    assert.equal((await agent.ask("Thanh toán và tồn kho thế nào?")).reply, "ok");
});

// ---------- Chốt chặn xác nhận cho thao tác ghi ----------

test("ghi + giám đốc ĐỒNG Ý -> hỏi đúng 1 lần với nội dung preview, rồi mới thực hiện", async () => {
    const { agent, db, asked } = setup([
        callResponse(DISABLE_VNPAY),
        (request) => {
            assert.equal(lastToolResults(request)[0].code, "GATEWAY_UPDATED");
            return textResponse("Đã tắt VNPAY.");
        },
    ], { answers: [true] });
    const { reply, actions } = await agent.ask("Tắt VNPAY đi");
    assert.equal(reply, "Đã tắt VNPAY.");
    assert.equal(asked.length, 1);
    assert.match(asked[0].message, /TẮT cổng thanh toán VNPAY/);
    assert.equal(db.gateways.get("VNPAY").enabled, false);
    assert.equal(actions[0].status, "DONE");
});

test("ghi + giám đốc TỪ CHỐI -> không đổi dữ liệu, model nhận CANCELLED_BY_USER", async () => {
    const { agent, db } = setup([
        callResponse(DISABLE_VNPAY),
        (request) => {
            assert.equal(lastToolResults(request)[0].code, "CANCELLED_BY_USER");
            return textResponse("Em chưa tắt VNPAY.");
        },
    ], { answers: [false] });
    const { actions } = await agent.ask("Tắt VNPAY đi");
    assert.equal(db.gateways.get("VNPAY").enabled, true);
    assert.equal(db.auditLog.length, 0);
    assert.equal(actions[0].status, "CANCELLED");
});

test("confirm trả giá trị 'gần đúng' (\"có\", 1, undefined) hoặc lỗi -> đều tính là KHÔNG đồng ý", async () => {
    for (const answer of ["có", 1, undefined, new Error("stdin đóng")]) {
        const { agent, db } = setup([callResponse(DISABLE_VNPAY), textResponse("ok")], { answers: [answer] });
        await agent.ask("Tắt VNPAY");
        assert.equal(db.gateways.get("VNPAY").enabled, true, String(answer));
    }
});

test("tham số ghi sai -> báo model luôn, KHÔNG làm phiền giám đốc", async () => {
    const { agent, asked } = setup([
        callResponse(["create_restock_order", { sku: "SP012", quantity: -3 }]),
        (request) => {
            assert.equal(lastToolResults(request)[0].code, "INVALID_QUANTITY");
            return textResponse("Số lượng không hợp lệ.");
        },
    ]);
    await agent.ask("Nhập -3 nồi chiên");
    assert.equal(asked.length, 0);
});

test("2 thao tác ghi trong 1 lượt -> hỏi xác nhận riêng từng cái", async () => {
    const orderIds = findSuspiciousOrders(createDb()).data.groups[0].orders.map((o) => o.orderId);
    const { agent, db, asked } = setup([
        callResponse(DISABLE_VNPAY, ["hold_orders", { orderIds, reason: "Nghi bom hàng" }]),
        textResponse("xong"),
    ], { answers: [true, false] });
    const { actions } = await agent.ask("Tắt VNPAY và giữ các đơn nghi ngờ");
    assert.equal(asked.length, 2);
    assert.deepEqual(actions.map((a) => a.status), ["DONE", "CANCELLED"]);
    assert.equal(db.gateways.get("VNPAY").enabled, false);
    assert.ok(orderIds.every((id) => db.orders.get(id).status === "CHO_XU_LY"));
});

// ---------- Giới hạn 8 vòng và ngoại lệ ----------

test(`model gọi tool mãi -> dừng đúng sau ${MAX_ROUNDS} lần gọi, trả lời lịch sự, phiên vẫn dùng tiếp được`, async () => {
    let calls = 0;
    const { agent, requests } = setup((request) => {
        calls++;
        return calls <= MAX_ROUNDS ? callResponse(["get_stock_alerts", {}]) : textResponse("câu trả lời lượt sau");
    });
    const first = await agent.ask("Hàng nào sắp hết?");
    assert.equal(requests.length, MAX_ROUNDS);
    assert.equal(first.rounds, MAX_ROUNDS);
    assert.match(first.reply, /8 bước/);

    const second = await agent.ask("Còn gì nữa không?");
    assert.equal(second.reply, "câu trả lời lượt sau");
    // lịch sử gửi đi xen kẽ hợp lệ: lượt trước chỉ còn câu hỏi + câu trả lời
    assert.deepEqual(requests.at(-1).contents.map((c) => c.role), ["user", "model", "user"]);
});

test("lỗi API 429 -> câu trả lời thân thiện, không throw; câu sau vẫn chạy", async () => {
    const { agent } = setup([
        () => Promise.reject(Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 })),
        textResponse("đã ổn"),
    ]);
    const first = await agent.ask("Đêm qua thế nào?");
    assert.match(first.reply, /quá tải/);
    assert.equal((await agent.ask("Đêm qua thế nào?")).reply, "đã ổn");
});

test("lỗi API SAU khi đã thực hiện thao tác ghi -> câu trả lời nói rõ thao tác đó đã xong", async () => {
    const { agent } = setup([
        callResponse(DISABLE_VNPAY),
        () => Promise.reject(new Error("fetch failed")),
    ], { answers: [true] });
    const { reply } = await agent.ask("Tắt VNPAY");
    assert.match(reply, /không kết nối được/i);
    assert.match(reply, /ĐÃ thực hiện: Đã tắt cổng VNPAY/);
});

test("model treo -> hết giờ thì trả lời lịch sự", async () => {
    const { agent } = setup([() => new Promise(() => {})], { callTimeoutMs: 50 });
    assert.match((await agent.ask("Đêm qua thế nào?")).reply, /phản hồi quá lâu/);
});

test("tool không tồn tại / args lạ / nghiệp vụ throw -> model nhận lỗi, không crash", async () => {
    const registry = createToolRegistry();
    registry.set("get_stock_alerts", { ...registry.get("get_stock_alerts"), run: () => { throw new Error("DB mất kết nối"); } });
    const { agent } = setup([
        callResponse(["xoa_toan_bo_du_lieu", {}], ["get_overnight_report", "không phải object"], ["get_stock_alerts", {}]),
        (request) => {
            assert.deepEqual(lastToolResults(request).map((r) => r.code), ["UNKNOWN_TOOL", "OVERNIGHT_REPORT", "INTERNAL_ERROR"]);
            return textResponse("Em gặp lỗi khi xem tồn kho.");
        },
    ], { registry });
    assert.equal((await agent.ask("test")).reply, "Em gặp lỗi khi xem tồn kho.");
});

test("model trả về rỗng -> câu trả lời dự phòng", async () => {
    const { agent } = setup([textResponse("   ")]);
    assert.match((await agent.ask("Đêm qua thế nào?")).reply, /hỏi lại/);
});

test("nhớ ngữ cảnh: câu hỏi thứ 2 gửi kèm lịch sử câu 1", async () => {
    const { agent, requests } = setup([textResponse("VNPAY lỗi."), textResponse("ok")]);
    await agent.ask("Cổng nào lỗi?");
    await agent.ask("Tắt nó đi");
    assert.deepEqual(requests[1].contents.map((c) => c.parts[0].text), ["Cổng nào lỗi?", "VNPAY lỗi.", "Tắt nó đi"]);
});

// ---------- Bước xác nhận trên giao diện ----------

test("hiểu câu trả lời xác nhận tiếng Việt", () => {
    for (const s of ["có", "Có.", "OK", "y", "đồng ý", "Xác nhận!", "làm đi"]) assert.equal(parseConfirmation(s), "YES", s);
    for (const s of ["không", "Không!", "k", "ko", "huỷ", "hủy", "thôi", "dừng lại"]) assert.equal(parseConfirmation(s), "NO", s);
    for (const s of ["", "để tôi nghĩ", "đúng", "có lẽ không", null]) assert.equal(parseConfirmation(s), "UNCLEAR", String(s));
});

test("giao diện xác nhận: trả lời mơ hồ 3 lần -> huỷ; mơ hồ rồi 'có' -> đồng ý", async () => {
    const replies = (list) => async () => list.shift() ?? "";
    const silent = () => {};
    assert.equal(await createConsoleConfirm(replies(["hmm", "?", "để xem"]), silent)({ title: "t", message: "m" }), false);
    assert.equal(await createConsoleConfirm(replies(["hmm", "có"]), silent)({ title: "t", message: "m" }), true);
});

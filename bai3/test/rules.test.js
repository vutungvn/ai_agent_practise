// Chạy: npm test   (không cần API key)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/db.js";
import { parseAddress } from "../src/address.js";
import { changeShippingAddress, getOrderForCustomer, HOTLINE } from "../src/orderService.js";
import { createToolExecutor, toolDeclarations } from "../src/tools.js";

// Đơn bị từ chối thì dữ liệu phải y nguyên như lúc đầu.
function assertUnchanged(db, orderId) {
    assert.deepEqual(db.orders.get(orderId), createDb().orders.get(orderId));
    assert.equal(db.addressChangeLog.length, 0);
}

// ---------- Đọc địa chỉ ----------

test("địa chỉ hợp lệ, nhận đúng tỉnh", () => {
    assert.equal(parseAddress("5 Trần Duy Hưng, Cầu Giấy, Hà Nội").province.key, "ha-noi");
    assert.equal(parseAddress("45 Lê Lợi, Quận 1, TP.HCM").province.key, "ho-chi-minh");
    assert.equal(parseAddress("5 Lê Lợi, ha noi, Việt Nam").province.key, "ha-noi");
});

test("địa chỉ rỗng / chỉ khoảng trắng / không phải chuỗi -> EMPTY_ADDRESS, không crash", () => {
    for (const raw of ["", "     ", "\t \n ", " , , ", null, undefined, 123, {}]) {
        assert.equal(parseAddress(raw).code, "EMPTY_ADDRESS", `input: ${JSON.stringify(raw)}`);
    }
});

test("thiếu tỉnh/thành -> MISSING_PROVINCE", () => {
    assert.equal(parseAddress("12 Nguyễn Trãi, Thanh Xuân").code, "MISSING_PROVINCE");
    assert.equal(parseAddress("12 Láng Hạ Hà Nội").code, "MISSING_PROVINCE"); // không có dấu phẩy
});

test("tên đường trùng tên tỉnh không bị nhận nhầm", () => {
    assert.equal(parseAddress("123 Nguyễn Huệ, Quận 1").code, "MISSING_PROVINCE"); // không phải Huế
    assert.equal(parseAddress("10 Hồ Chí Minh, Thanh Hóa").province.key, "thanh-hoa");
});

test("chỉ có tên tỉnh -> INCOMPLETE_ADDRESS", () => {
    assert.equal(parseAddress("Hà Nội").code, "INCOMPLETE_ADDRESS");
});

// ---------- Nghiệp vụ ----------

test("#1 đổi thành công cùng tỉnh", () => {
    const db = createDb();
    const result = changeShippingAddress(db, "KH001", "ORD001", "5 Trần Duy Hưng, Cầu Giấy, Hà Nội");
    assert.equal(result.code, "ADDRESS_CHANGED");
    assert.equal(db.orders.get("ORD001").shippingAddress, "5 Trần Duy Hưng, Cầu Giấy, Hà Nội");
    assert.equal(db.orders.get("ORD001").addressChangeCount, 1);
    assert.equal(db.addressChangeLog.length, 1);
});

test("mã đơn viết thường, có khoảng trắng vẫn nhận", () => {
    const db = createDb();
    assert.equal(changeShippingAddress(db, "KH001", "  ord002 ", "7 Nguyễn Huệ, Quận 1, Hồ Chí Minh").code, "ADDRESS_CHANGED");
});

test("#2 đổi lần thứ hai bị từ chối", () => {
    const db = createDb();
    changeShippingAddress(db, "KH001", "ORD001", "5 Trần Duy Hưng, Cầu Giấy, Hà Nội");
    const second = changeShippingAddress(db, "KH001", "ORD001", "7 Tôn Thất Tùng, Đống Đa, Hà Nội");
    assert.equal(second.code, "ALREADY_CHANGED");
    assert.equal(db.orders.get("ORD001").shippingAddress, "5 Trần Duy Hưng, Cầu Giấy, Hà Nội");
    assert.equal(db.orders.get("ORD001").addressChangeCount, 1);
});

test("#3 đơn đã đổi sẵn 1 lần -> ALREADY_CHANGED", () => {
    const db = createDb();
    assert.equal(changeShippingAddress(db, "KH001", "ORD005", "5 Trần Duy Hưng, Cầu Giấy, Hà Nội").code, "ALREADY_CHANGED");
    assertUnchanged(db, "ORD005");
});

test("#4 #5 DANG_GIAO / DA_GIAO bị từ chối, có số tổng đài", () => {
    for (const [orderId, address] of [["ORD003", "1 Kim Mã, Ba Đình, Hà Nội"], ["ORD004", "5 Lê Duẩn, Hải Châu, Đà Nẵng"]]) {
        const db = createDb();
        const result = changeShippingAddress(db, "KH001", orderId, address);
        assert.equal(result.code, "STATUS_NOT_ALLOWED");
        assert.match(result.message, new RegExp(HOTLINE));
        assertUnchanged(db, orderId);
    }
});

test("trạng thái ngoài whitelist (DA_HUY) cũng bị chặn", () => {
    const db = createDb();
    assert.equal(changeShippingAddress(db, "KH001", "ORD007", "5 Trần Duy Hưng, Cầu Giấy, Hà Nội").code, "STATUS_NOT_ALLOWED");
    assertUnchanged(db, "ORD007");
});

test("#6 khác tỉnh -> DIFFERENT_PROVINCE, hướng dẫn huỷ đơn", () => {
    const db = createDb();
    const result = changeShippingAddress(db, "KH001", "ORD002", "10 Tràng Tiền, Hoàn Kiếm, Hà Nội");
    assert.equal(result.code, "DIFFERENT_PROVINCE");
    assert.match(result.message, /huỷ đơn/);
    assertUnchanged(db, "ORD002");
});

test("#7 #8 #9 địa chỉ rỗng / thiếu tỉnh không ghi dữ liệu", () => {
    for (const [address, code] of [["     ", "EMPTY_ADDRESS"], [null, "EMPTY_ADDRESS"], ["12 Nguyễn Trãi, Thanh Xuân", "MISSING_PROVINCE"]]) {
        const db = createDb();
        assert.equal(changeShippingAddress(db, "KH001", "ORD001", address).code, code);
        assertUnchanged(db, "ORD001");
    }
});

test("#11 #12 đơn của người khác và đơn không tồn tại: cùng mã lỗi, không ghi", () => {
    const db = createDb();
    const notOwned = changeShippingAddress(db, "KH001", "ORD006", "1 Tô Hiệu, Cầu Giấy, Hà Nội");
    const notExist = changeShippingAddress(db, "KH001", "ORD999", "1 Tô Hiệu, Cầu Giấy, Hà Nội");
    assert.equal(notOwned.code, "ORDER_NOT_FOUND");
    assert.equal(notExist.code, "ORDER_NOT_FOUND");
    assertUnchanged(db, "ORD006");
    // get_order cũng không được lộ thông tin đơn của người khác
    assert.equal(getOrderForCustomer(db, "KH001", "ORD006").data, undefined);
});

test("#13 mã đơn sai định dạng -> INVALID_ORDER_ID", () => {
    const db = createDb();
    for (const orderId of ["abc", "", undefined, 42]) {
        assert.equal(changeShippingAddress(db, "KH001", orderId, "5 Trần Duy Hưng, Cầu Giấy, Hà Nội").code, "INVALID_ORDER_ID");
    }
});

test("get_order báo trước được hay không được đổi", () => {
    const db = createDb();
    assert.equal(getOrderForCustomer(db, "KH001", "ORD001").data.canChangeAddress, true);
    assert.equal(getOrderForCustomer(db, "KH001", "ORD003").data.canChangeAddress, false);
});

// ---------- Lớp tool ----------

test("#14 tool không nhận customerId, model có truyền thêm cũng bị bỏ qua", () => {
    for (const tool of toolDeclarations) {
        assert.ok(!("customerId" in tool.parameters.properties), tool.name);
    }
    const db = createDb();
    const executeTool = createToolExecutor({ db, customerId: "KH001" });
    const result = executeTool("update_shipping_address", { orderId: "ORD006", newAddress: "1 Tô Hiệu, Cầu Giấy, Hà Nội", customerId: "KH002" });
    assert.equal(result.code, "ORDER_NOT_FOUND");
    assertUnchanged(db, "ORD006");
});

test("tool lạ hoặc thiếu args không làm crash", () => {
    const executeTool = createToolExecutor({ db: createDb(), customerId: "KH001" });
    assert.equal(executeTool("delete_all_orders", {}).code, "UNKNOWN_TOOL");
    assert.equal(executeTool("update_shipping_address", undefined).code, "INVALID_ORDER_ID");
    assert.equal(executeTool("get_order", null).code, "INVALID_ORDER_ID");
});

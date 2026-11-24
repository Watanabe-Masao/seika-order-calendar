import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage, retryKey } from "../scripts/notify.mjs";
import { makeCalendar } from "../site/order.js";
import { fixtureData as data } from "./fixture-data.mjs";

const cal = makeCalendar(data);

test("お盆前：8/12は★4日分を通知", () => {
  const m = buildMessage(cal, "2027-08-12");
  assert.match(m, /明日 8\/12\(木\) は 🟧★4日分 の発注です/);
  assert.match(m, /対象：8\/13\(金\)〜8\/16\(月\)/);
  assert.match(m, /次の発注日：8\/16\(月\)/);
  assert.match(m, /通常の週なら 1日分（8\/14\(土\) 休市、8\/16\(月\) 休市）/);
  assert.match(m, /https:\/\/watanabe-masao\.github\.io\/seika-order-calendar\//);
});

test("年末：12/28は★7日分", () => {
  assert.match(buildMessage(cal, "2026-12-28"), /🟧★7日分/);
});

test("通常の発注日・発注できない日は通知しない", () => {
  assert.equal(buildMessage(cal, "2027-08-26"), null); // 通常の木曜 1日分
  assert.equal(buildMessage(cal, "2027-08-23"), null); // 通常の月曜 2日分
  assert.equal(buildMessage(cal, "2027-08-13"), null); // 発注不可
});

test("2027年の通知は月5回以下", () => {
  const per = {};
  for (let d = new Date(2027, 0, 1); d.getFullYear() === 2027; d.setDate(d.getDate() + 1)) {
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (buildMessage(cal, s)) per[s.slice(0, 7)] = (per[s.slice(0, 7)] || 0) + 1;
  }
  assert.ok(Object.values(per).every(n => n <= 5), JSON.stringify(per));
});

test("リトライキーは同じ内容なら同じ・UUID形式", () => {
  const a = retryKey("2027-08-12", "x"), b = retryKey("2027-08-12", "x"), c = retryKey("2027-08-13", "x");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

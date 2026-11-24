import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessage, retryKey } from "../scripts/notify.mjs";
import { makeCalendar } from "../site/order.js";
import { fixtureData as data } from "./fixture-data.mjs";

const cal = makeCalendar(data);

test("お盆前：前日の配信（8/11）", () => {
  const m = buildMessage(cal, "2027-08-12", "eve");
  assert.equal(m, [
    "【青果 発注のお知らせ】",
    "明日 8/12(木) は 🟧★4日分 の発注",
    "8/13(金)〜8/15(日) は発注ありません",
    "",
    "次回の発注は 8/16(月)  2日分発注",
    "https://watanabe-masao.github.io/seika-order-calendar/",
  ].join("\n"));
});

test("お盆前：当日の配信（8/12）", () => {
  const m = buildMessage(cal, "2027-08-12", "day");
  assert.match(m, /^【青果 発注のお知らせ】\n本日 8\/12\(木\) は 🟧★4日分 の発注\n明日から 8\/15\(日\) まで発注ありません\n\n次回の発注は 8\/16\(月\)  2日分発注\n/);
});

test("翌日だけ発注なしなら「明日は発注ありません」", () => {
  let found = null;
  for (let d = new Date(2025, 0, 1); d.getFullYear() <= 2027 && !found; d.setDate(d.getDate() + 1)) {
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const m = buildMessage(cal, s, "day");
    if (m && m.includes("\n明日は発注ありません\n")) found = s;
  }
  assert.ok(found, "該当日が見つからない");
});

test("年末：12/28は★7日分、次回は1/4", () => {
  const m = buildMessage(cal, "2026-12-28", "eve");
  assert.match(m, /🟧★7日分/);
  assert.match(m, /12\/29\(火\)〜1\/3\(日\) は発注ありません/);
  assert.match(m, /次回の発注は 1\/4\(月\)  2日分発注/);
});

test("データ末尾は次回未確定", () => {
  assert.match(buildMessage(cal, "2027-12-28", "eve"), /翌年の休市日の公開後に確定/);
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

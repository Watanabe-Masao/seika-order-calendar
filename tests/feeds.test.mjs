import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeeds, fold } from "../scripts/feeds.mjs";
import { makeCalendar } from "../site/order.js";

import { fixtureData as data } from "./fixture-data.mjs";
const { files, from, to } = buildFeeds(data, "2026-11-24");

const events = text => text.split("BEGIN:VEVENT").slice(1).map(e => e.replace(/\r\n /g, ""));
const find = (text, date) => events(text).find(e => e.includes(`DTSTART;VALUE=DATE:${date}`));

test("期間は1年前〜データ最終日", () => {
  assert.equal(from, "2025-11-24");
  assert.equal(to, "2027-12-31");
});

test("日数ごとに別のファイル", () => {
  assert.ok(find(files["order-3plus.ics"], "20270812"));
  assert.ok(!find(files["order-1.ics"], "20270812"));
  assert.ok(find(files["order-1.ics"], "20270826")); // 木曜は通常1日分
  assert.ok(find(files["order-2.ics"], "20270823")); // 月曜は通常2日分
});

test("お盆の発注日は★付き・説明に通常時の日数と休市日", () => {
  const e = find(files["order-3plus.ics"], "20270812");
  assert.match(e, /SUMMARY:★発注 4日分/);
  assert.match(e, /通常の週（日・水休み）なら 1日分/);
  assert.match(e, /8\/14\(土\) 休市/);
});

test("通常の週の発注日には★なし", () => {
  assert.match(find(files["order-1.ics"], "20270826"), /SUMMARY:発注 1日分\r?\n/);
});

test("休市日：日・水は印なし、祝日は★、日・水の臨時開市は★開市日", () => {
  const c = files["closed.ics"];
  assert.match(find(c, "20270822"), /SUMMARY:休市日\r?\n/);   // 日曜
  assert.match(find(c, "20270816"), /SUMMARY:★休市日/);      // お盆の月曜
  assert.match(find(c, "20261227"), /SUMMARY:★開市日/);      // 日曜の臨時開市
  assert.ok(!find(c, "20270505") || /★開市日/.test(find(c, "20270505"))); // 水曜祝日の青果開市
});

test("UIDは日付で固定（更新しても重複しない）", () => {
  assert.match(find(files["order-3plus.ics"], "20270812"), /UID:order-20270812@/);
});

test("iCalendarの形式：CRLF・75オクテット以内", () => {
  for (const body of Object.values(files)) {
    assert.ok(body.startsWith("BEGIN:VCALENDAR\r\n"));
    for (const line of body.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  }
  assert.equal(fold("a".repeat(80)), "a".repeat(75) + "\r\n " + "a".repeat(5));
});

test("イレギュラー判定：通常の週と結果が違う日だけ", () => {
  const cal = makeCalendar(data);
  assert.equal(cal.info("2027-08-26").irregular, false);
  assert.equal(cal.info("2027-08-12").irregular, true);
  assert.equal(cal.info("2027-08-13").irregular, true); // 通常の金曜は発注可→この日は不可
  assert.equal(cal.dayIrregular("2027-08-18"), "");     // 水曜休市は通常
  assert.equal(cal.dayIrregular("2027-08-16"), "closed");
  assert.equal(cal.dayIrregular("2026-12-27"), "open");
});

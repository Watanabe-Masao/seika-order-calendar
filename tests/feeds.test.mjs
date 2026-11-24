import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeeds, fold } from "../scripts/feeds.mjs";
import { makeCalendar } from "../site/order.js";
import { fixtureData as data } from "./fixture-data.mjs";

const { files, from, to } = buildFeeds(data, "2026-11-24");
const body = files["seika.ics"];

const events = text => text.split("BEGIN:VEVENT").slice(1).map(e => e.replace(/\r\n /g, ""));
const on = date => events(body).filter(e => e.includes(`DTSTART;VALUE=DATE:${date}`));
const summaryOf = e => e.match(/SUMMARY:(.*)\r?\n/)[1];
const summaries = date => on(date).map(summaryOf);

test("1本のカレンダーにまとめる", () => {
  assert.deepEqual(Object.keys(files), ["seika.ics"]);
  assert.match(body, /X-WR-CALNAME:青果 発注カレンダー/);
});

test("期間は1年前〜データ最終日", () => {
  assert.equal(from, "2025-11-24");
  assert.equal(to, "2027-12-31");
});

test("種類ごとの印：🟦1日分・🟩2日分・🟧3日分以上・⬜休市日", () => {
  assert.deepEqual(summaries("20270826"), ["🟦発注 1日分"]);           // 木曜
  assert.deepEqual(summaries("20270823"), ["🟩発注 2日分"]);           // 月曜
  assert.deepEqual(summaries("20270812"), ["🟧★発注 4日分"]);          // お盆前
  assert.deepEqual(summaries("20270822"), ["⬜休市日", "🟦発注 1日分"]); // 日曜：休市日→発注の順
});

test("予定ごとの色（COLOR）", () => {
  assert.match(on("20270826")[0], /COLOR:royalblue/);
  assert.match(on("20270823")[0], /COLOR:seagreen/);
  assert.match(on("20270812")[0], /COLOR:darkorange/);
  assert.match(on("20270822")[0], /COLOR:gray/);
});

test("★：お盆の発注日は説明に通常時の日数と休市日", () => {
  const e = on("20270812")[0];
  assert.match(e, /通常の週（日・水休み）なら 1日分/);
  assert.match(e, /8\/14\(土\) 休市/);
});

test("★休市日（日・水以外）と★開市日（日・水の臨時開市）", () => {
  assert.ok(summaries("20270816").includes("⬜★休市日"));
  assert.ok(summaries("20261227").includes("⬜★開市日"));
  assert.ok(summaries("20270818").includes("⬜休市日")); // 水曜は通常
});

test("UIDは種類と日付で固定（更新しても重複しない）", () => {
  const uids = events(body).map(e => e.match(/UID:(.*)\r?\n/)[1]);
  assert.equal(new Set(uids).size, uids.length);
  assert.ok(uids.includes("order-20270812@seika-order-calendar.watanabe-masao.github.io"));
});

test("iCalendarの形式：CRLF・75オクテット以内", () => {
  assert.ok(body.startsWith("BEGIN:VCALENDAR\r\n"));
  for (const line of body.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(fold("a".repeat(80)), "a".repeat(75) + "\r\n " + "a".repeat(5));
});

test("イレギュラー判定：通常の週と結果が違う日だけ", () => {
  const cal = makeCalendar(data);
  assert.equal(cal.info("2027-08-26").irregular, false);
  assert.equal(cal.info("2027-08-12").irregular, true);
  assert.equal(cal.info("2027-08-13").irregular, true);
  assert.equal(cal.dayIrregular("2027-08-18"), "");
  assert.equal(cal.dayIrregular("2027-08-16"), "closed");
  assert.equal(cal.dayIrregular("2026-12-27"), "open");
});

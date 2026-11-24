// node --test tests/  で実行
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCalendar, DEFAULT_RULES } from "../site/order.js";

import { fixtureData as data } from "./fixture-data.mjs";

test("2027年お盆：12日に4日分、13〜15・17日は発注不可", () => {
  const cal = makeCalendar(data);
  const r12 = cal.info("2027-08-12");
  assert.equal(r12.status, "ok");
  assert.equal(r12.n, 4);
  assert.equal(r12.delivery, "2027-08-13");
  assert.equal(r12.until, "2027-08-16");
  for (const d of ["2027-08-13", "2027-08-14", "2027-08-15", "2027-08-17"]) {
    assert.equal(cal.info(d).status, "ng", d);
  }
  assert.equal(cal.info("2027-08-16").n, 2); // 17日納品で17・18日分
});

test("年末年始2026→2027：28日に7日分、26日は臨時開市の27日分", () => {
  const cal = makeCalendar(data);
  assert.equal(cal.info("2026-12-28").n, 7);
  assert.equal(cal.info("2026-12-28").until, "2027-01-04");
  assert.equal(cal.info("2026-12-26").n, 1);
  assert.equal(cal.info("2026-12-29").status, "ng");
});

test("データ末尾は日数未確定、範囲外は判定不能", () => {
  const cal = makeCalendar(data);
  assert.equal(cal.info("2027-12-28").status, "okOpenEnd");
  assert.equal(cal.info("2027-12-31").status, "unk");
});

test("12/31を仲卸営業日として開市扱いにする設定", () => {
  const cal = makeCalendar(data, { ...DEFAULT_RULES, reopenPattern: "^(セリはありません|卸のみ休業)" });
  assert.equal(cal.isOpen("2026-12-31"), true);
  assert.equal(cal.isOpen("2026-12-30"), false); // 青果卸のみ休業は休みのまま（先頭一致にしているため対象外）
});

test("休市日には発注しない設定：前の発注日がその分をまかなう", () => {
  const cal = makeCalendar(data, { ...DEFAULT_RULES, orderOnClosedDay: false });
  // 2027-08-11(水)は休市 → 発注不可。10日の発注が11・12日分をまかなう
  assert.equal(cal.info("2027-08-11").status, "ng");
  const r10 = cal.info("2027-08-10");
  assert.equal(r10.status, "ng"); // 11日は休市なので10日発注→11日納品はできない
  const r9 = cal.info("2027-08-09");
  assert.equal(r9.delivery, "2027-08-10");
  assert.equal(r9.until, "2027-08-12"); // 12日(木)納品は11日(休市)発注になるため不可 → 13日納品まで
});

// 発注日の計算ロジック（ページとテストで共用）
//
// ルール
//  - 発注した翌日に市場から納品される。
//  - 翌日が休市なら発注できない。
//  - 1回の発注で「納品日〜次の納品日の前日」までをまかなう。
//
// 設定（RULES）
//  - orderOnClosedDay: 当日が休市でも、翌日が開市なら発注できるとみなす（true）
//  - reopenPattern:   null なら休市日カレンダーの予定はすべて休み。
//                     正規表現を入れると、予定名がそれに一致する日を「開市」扱いに戻す
//                     （例: /セリはありません|卸のみ休業/ で 12/31 を仲卸営業日として扱う）

export const DEFAULT_RULES = {
  orderOnClosedDay: true,
  reopenPattern: null,
};

export function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export function parse(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function add(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function makeCalendar(data, rules = DEFAULT_RULES) {
  const first = data.first, last = data.last;
  const closed = data.closed || {};
  const opened = data.open || {};

  // true=開市, false=休市, null=データ範囲外
  function isOpen(s) {
    if (s < first || s > last) return null;
    if (!(s in closed)) return true;
    if (rules.reopenPattern && new RegExp(rules.reopenPattern).test(closed[s])) return true;
    return false;
  }

  // 通常の「休市日」以外の注記（青果のみ休市、臨時開市日など）
  function note(s) {
    const c = closed[s];
    if (c && c !== "休市日") return c;
    return opened[s] || "";
  }

  // 発注日 s の情報
  //  status: "ok"=発注可（日数確定）/ "okOpenEnd"=発注可（次の納品日がデータ範囲外）
  //          "ng"=発注不可 / "unk"=判定不能
  function info(s) {
    const r = { date: s, open: isOpen(s), note: note(s) };
    const dl = add(s, 1);
    const dlOpen = isOpen(dl);
    if (dlOpen === null || r.open === null) { r.status = "unk"; return r; }
    if (!dlOpen) { r.status = "ng"; r.reason = "nextClosed"; r.blockedBy = dl; return r; }
    if (!r.open && !rules.orderOnClosedDay) { r.status = "ng"; r.reason = "todayClosed"; return r; }
    // 次に納品される日＝開市日で、かつその前日に発注できる日
    let t = add(dl, 1), n = 1;
    for (;;) {
      const o = isOpen(t), prevOpen = isOpen(add(t, -1));
      if (o === null || prevOpen === null) { r.status = "okOpenEnd"; r.delivery = dl; r.n = n; r.until = add(t, -1); return r; }
      if (o && (prevOpen || rules.orderOnClosedDay)) break;
      t = add(t, 1); n++;
    }
    r.status = "ok"; r.delivery = dl; r.n = n; r.until = add(t, -1);
    return r;
  }

  return { isOpen, note, info, first, last };
}

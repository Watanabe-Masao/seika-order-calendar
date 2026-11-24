// 発注日の計算ロジック（ページとテストで共用）
//
// ルール
//  - 発注した翌日に市場から納品される。
//  - 翌日が休市なら発注できない。
//  - 1回の発注で「納品日〜次の納品日の前日」までをまかなう。
//
// 印（★）
//  - 日曜・水曜を通常の休市日とし、それ以外の休市日・日曜水曜の開市日を「イレギュラー」とする。
//  - 発注日は、通常の週だった場合と結果（発注可否・日数）が違えば「イレギュラー」とする。
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

// 通常の週：日曜・水曜が休市
export const REGULAR_CLOSED_WEEKDAYS = [0, 3];
const isRegularClosedWeekday = s => REGULAR_CLOSED_WEEKDAYS.includes(parse(s).getDay());

// isOpen(s) -> true/false/null から、発注日の情報を返す関数を作る
//  status: "ok"=発注可（日数確定）/ "okOpenEnd"=発注可（次の納品日がデータ範囲外）
//          "ng"=発注不可 / "unk"=判定不能
function orderInfo(isOpen, rules) {
  return function (s) {
    const r = { date: s, open: isOpen(s) };
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
  };
}

export function makeCalendar(data, rules = DEFAULT_RULES) {
  const first = data.first, last = data.last;
  const closed = data.closed || {};
  const opened = data.open || {};
  const inRange = s => s >= first && s <= last;

  // true=開市, false=休市, null=データ範囲外
  function isOpen(s) {
    if (!inRange(s)) return null;
    if (!(s in closed)) return true;
    if (rules.reopenPattern && new RegExp(rules.reopenPattern).test(closed[s])) return true;
    return false;
  }
  // 通常の週（日・水休み）だった場合の開市判定
  const isOpenRegular = s => (inRange(s) ? !isRegularClosedWeekday(s) : null);

  // 通常の「休市日」以外の注記（青果のみ休市、臨時開市日など）
  function note(s) {
    const c = closed[s];
    if (c && c !== "休市日") return c;
    return opened[s] || "";
  }

  // その日の開市・休市が通常の週と違うか
  //  "closed"=日・水以外の休市（祝日・お盆・年末年始など） / "open"=日・水の開市 / ""=通常
  function dayIrregular(s) {
    const o = isOpen(s);
    if (o === null) return "";
    if (!o && !isRegularClosedWeekday(s)) return "closed";
    if (o && isRegularClosedWeekday(s)) return "open";
    return "";
  }

  const actual = orderInfo(isOpen, rules);
  const regular = orderInfo(isOpenRegular, rules);

  // 発注日 s の情報。通常の週と結果が違えば irregular=true、usual に通常時の結果を入れる
  function info(s) {
    const r = actual(s);
    r.note = note(s);
    r.dayIrregular = dayIrregular(s);
    if (r.status !== "unk") {
      const u = regular(s);
      const same = u.status === r.status && (u.n || 0) === (r.n || 0);
      r.irregular = !same;
      if (!same) r.usual = { status: u.status, n: u.n };
    } else r.irregular = false;
    return r;
  }

  return { isOpen, note, info, dayIrregular, first, last };
}

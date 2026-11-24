#!/usr/bin/env node
// site/data/calendar.json から購読用の iCalendar を作る。
//
//   node scripts/feeds.mjs [--today YYYY-MM-DD] [--out site/cal]
//
// 出力：seika.ics（1本のカレンダー。すべて終日の予定）
//   予定名の先頭の印で種類を見分ける（購読カレンダーは多くのアプリで全体1色になるため）
//     🟦 発注 1日分 / 🟩 発注 2日分 / 🟧 発注 3日分以上 / ⬜ 休市日・開市日
//   ★：通常の週（日曜・水曜が休市）と違う日
//   予定ごとの色（RFC 7986 COLOR）も入れる。対応しているアプリでは色も付く。
//
// 期間：今日の1年前 〜 休市日データの最終日
// 発注日の計算は site/order.js をそのまま使う（ページと同じ結果になる）。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCalendar, DEFAULT_RULES, iso, parse, add } from "../site/order.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UID_DOMAIN = "seika-order-calendar.watanabe-masao.github.io";
const WD = "日月火水木金土";

export const FEED = { file: "seika.ics", name: "青果 発注カレンダー" };

// 種類ごとの印と色（COLOR は CSS3 の色名）
export const LAYERS = {
  order1: { mark: "🟦", color: "royalblue" },
  order2: { mark: "🟩", color: "seagreen" },
  order3: { mark: "🟧", color: "darkorange" },
  market: { mark: "⬜", color: "gray" },
};
const orderLayer = n => (n >= 3 ? LAYERS.order3 : n === 2 ? LAYERS.order2 : LAYERS.order1);

const md = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
const ymd = s => s.replaceAll("-", "");

// ---- iCalendar の書式 ----
export function escapeText(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
// 75オクテットで折り返す（UTF-8の文字の途中では切らない）
export function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "", size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // 継続行は先頭の空白1オクテット分を引く
    if (size + n > limit) { out.push(cur); cur = ""; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
function vcalendar(name, events, stamp) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//seika-order-calendar//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-WR-TIMEZONE:Asia/Tokyo",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@${UID_DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd(e.date)}`,
      `DTEND;VALUE=DATE:${ymd(add(e.date, 1))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      ...(e.color ? [`COLOR:${e.color}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---- 予定の中身 ----
function orderEvent(cal, r) {
  const layer = orderLayer(r.n);
  const open = r.status === "okOpenEnd";
  const summary = `${layer.mark}${r.irregular ? "★" : ""}発注 ${r.n}日分${open ? "〜（未確定）" : ""}`;
  const desc = [
    `納品：${md(r.delivery)}`,
    `対象：${md(r.delivery)}〜${md(r.until)} の${r.n}日分${open ? "以上" : ""}`,
  ];
  if (!open) desc.push(`次の納品：${md(add(r.until, 1))}`);
  if (open) desc.push("翌年の休市日が未公開のため、日数が確定していません。");
  if (r.irregular) {
    const u = r.usual;
    const usual = u.status === "ng" ? "発注不可" : `${u.n}日分`;
    const days = [];
    for (let t = r.date; t <= add(r.until, 1); t = add(t, 1)) {
      const k = cal.dayIrregular(t);
      if (k) days.push(`${md(t)} ${k === "closed" ? "休市" : "開市"}${cal.note(t) ? "（" + cal.note(t) + "）" : ""}`);
    }
    desc.push(`★通常の週（日・水休み）なら ${usual}`);
    if (days.length) desc.push("いつもと違う日：" + days.join("、"));
  }
  return { uid: `order-${ymd(r.date)}`, date: r.date, summary, description: desc.join("\n"), color: layer.color };
}

function closedEvents(cal, from, to) {
  const out = [];
  for (let s = from; s <= to; s = add(s, 1)) {
    const o = cal.isOpen(s);
    const k = cal.dayIrregular(s);
    const note = cal.note(s);
    if (o === false) {
      out.push({
        uid: `closed-${ymd(s)}`, date: s,
        summary: LAYERS.market.mark + (k ? "★" : "") + "休市日", color: LAYERS.market.color,
        description: [note, k ? "★日曜・水曜以外の休市日" : ""].filter(Boolean).join("\n"),
      });
    } else if (k === "open") {
      out.push({
        uid: `open-${ymd(s)}`, date: s,
        summary: LAYERS.market.mark + "★開市日", color: LAYERS.market.color,
        description: [note, "★日曜・水曜の開市日"].filter(Boolean).join("\n"),
      });
    }
  }
  return out;
}

export function buildFeeds(data, today, rules = DEFAULT_RULES) {
  const cal = makeCalendar(data, rules);
  const d = parse(today);
  const yearAgo = iso(new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()));
  const from = yearAgo > data.first ? yearAgo : data.first;
  const to = data.last;
  const stamp = (data.updated_at ? new Date(data.updated_at) : new Date())
    .toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const orders = [];
  for (let s = from; s <= to; s = add(s, 1)) {
    const r = cal.info(s);
    if (r.status === "ok" || r.status === "okOpenEnd") orders.push(r);
  }
  // 日付順に、同じ日は休市日 → 発注の順で並べる
  const events = [...closedEvents(cal, from, to), ...orders.map(r => orderEvent(cal, r))]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { files: { [FEED.file]: vcalendar(FEED.name, events, stamp) }, from, to, count: orders.length };
}

// ---- コマンドとして実行されたとき ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const today = opt("--today") || new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const outDir = resolve(ROOT, opt("--out") || "site/cal");
  const data = JSON.parse(readFileSync(join(ROOT, "site/data/calendar.json"), "utf-8"));
  const { files, from, to, count } = buildFeeds(data, today);
  mkdirSync(outDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(outDir, name), body);
  console.log(`購読用カレンダーを作成：${from}〜${to}、発注日 ${count}件 → ${outDir}`);
}

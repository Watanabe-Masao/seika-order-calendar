#!/usr/bin/env node
// 発注日の当日に、LINE公式アカウントから発注のお知らせを配信する。
//
//   node scripts/notify.mjs --when day         # 当日7時：今日（JST）が発注日なら送信
//   node scripts/notify.mjs --when eve         # 前日15時：明日が🟧・★の発注日なら送信
//   node scripts/notify.mjs --dry-run          # 送らずに本文だけ表示
//   node scripts/notify.mjs --date 2027-08-12  # 対象日（発注日）を指定
//
// 環境変数
//   LINE_CHANNEL_ACCESS_TOKEN  Messaging API のチャネルアクセストークン（必須）
//   LINE_GROUP_ID              設定するとそのグループにだけ送る（push）。未設定なら友だち全員（broadcast）
//
// 通知する日
//   当日7時：発注できるすべての日（🟦1日分・🟩2日分・🟧3日分以上）
//   前日15時：🟧3日分以上、または★通常の週（日・水休み）と違う発注日だけ（予告）
// 発注できない日は通知せず、前の通知に「発注ありません」「次回の発注」として書く。
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCalendar, DEFAULT_RULES, parse, add } from "../site/order.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PAGE_URL = "https://watanabe-masao.github.io/seika-order-calendar/";
const WD = "日月火水木金土";
const md = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
const mark = n => (n >= 3 ? "🟧" : n === 2 ? "🟩" : "🟦");

// when="day"（当日7時）：発注できるすべての日
// when="eve"（前日15時）：🟧3日分以上か、★通常の週と違う発注日だけ
export function shouldNotify(r, when = "day") {
  if (!(r.status === "ok" || r.status === "okOpenEnd")) return false;
  return when === "day" ? true : r.n >= 3 || r.irregular;
}

// ★の日の「※いつもは〜」の1行
function usualLine(cal, r) {
  const u = r.usual;
  const groups = { closed: [], open: [], xopen: [] };
  for (let t = add(r.date, 1); t <= add(r.until, 1); t = add(t, 1)) {
    const k = cal.dayIrregular(t);
    if (k === "closed") groups.closed.push(t);
    else if (k === "open") (/臨時開市/.test(cal.note(t)) ? groups.xopen : groups.open).push(t);
  }
  const fmt = (days, label) => {
    if (!days.length) return null;
    const list = days.length <= 2 ? days.map(md).join("・") : `${md(days[0])}など${days.length}日`;
    return `${list} ${label}`;
  };
  const why = [fmt(groups.closed, "休市"), fmt(groups.xopen, "臨時開市"), fmt(groups.open, "開市")].filter(Boolean).join("、");
  const usual = u.status === "ng" ? "いつもは発注なしの日です" : `いつもは${u.n}日分です`;
  return `※${usual}${why ? `（${why}のため）` : ""}`;
}

// 発注日 date の通知本文。通知しない日は null
//   when: "eve"=前日に送る（明日の発注） / "day"=当日に送る（本日の発注）
export function buildMessage(cal, date, when = "day") {
  const r = cal.info(date);
  if (!shouldNotify(r, when)) return null;
  const open = r.status === "okOpenEnd";
  const head = when === "day" ? "本日" : "明日";
  const lines = [
    "【青果 発注のお知らせ】",
    `${head} ${md(date)} は ${mark(r.n)}${r.irregular ? "★" : ""}${r.n}日分${open ? "以上" : ""} の発注`,
  ];
  if (r.irregular) lines.push(usualLine(cal, r));
  // 次の発注日までの「発注なし」の日
  const next = r.until; // 次の納品日の前日＝次の発注日
  if (!open) {
    const from = add(date, 1), to = add(next, -1);
    if (from <= to) {
      if (when === "day") {
        lines.push(from === to ? "明日は発注ありません" : `明日から ${md(to)} まで発注ありません`);
      } else {
        lines.push(from === to ? `${md(from)} は発注ありません` : `${md(from)}〜${md(to)} は発注ありません`);
      }
    }
    const nr = cal.info(next);
    const nn = nr.status === "ok" ? `${nr.n}日分` : nr.status === "okOpenEnd" ? `${nr.n}日分以上` : "日数未定";
    lines.push("", `次回の発注は ${md(next)}  ${nn}発注`);
  } else {
    lines.push("", "次回の発注日は、翌年の休市日の公開後に確定します");
  }
  lines.push(PAGE_URL);
  return lines.join("\n");
}

// 同じ対象日・本文なら同じ値になる UUID（再実行しても二重送信しない）
export function retryKey(date, text) {
  const h = createHash("sha256").update(`seika-order-calendar|${date}|${text}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// to があればその宛先（グループ）に push、なければ友だち全員に broadcast
async function send(token, text, key, to) {
  const url = to ? "https://api.line.me/v2/bot/message/push" : "https://api.line.me/v2/bot/message/broadcast";
  const payload = to ? { to, messages: [{ type: "text", text }] } : { messages: [{ type: "text", text }] };
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Line-Retry-Key": key },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error(`送信エラー（${attempt}回目）: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (res.ok) return "sent";
    if (res.status === 409) return "already"; // 同じリトライキーで受付済み
    const body = await res.text();
    if (res.status >= 500 || res.status === 429) {
      console.error(`LINE API ${res.status}（${attempt}回目）: ${body}`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`LINE API ${res.status}: ${body}`);
  }
  throw new Error("LINE API への送信に3回失敗しました");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const dryRun = args.includes("--dry-run");
  const todayJst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const when = opt("--when") === "eve" ? "eve" : "day";
  const date = opt("--date") || (when === "day" ? todayJst : add(todayJst, 1));

  // スケジュール実行が大きく遅れて日付をまたいだら、別の日のお知らせになるので送らない
  //   当日の通知（7時予定）：JST 0〜5時に動いたら中止
  //   前日の予告（15時予定）：JST 0〜11時に動いたら中止
  if (args.includes("--scheduled") && !opt("--date")) {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
    if ((when === "day" && hour < 6) || (when === "eve" && hour < 12)) {
      console.log(`::warning::予定より大きく遅れて実行されたため送信しませんでした（JST ${hour}時、${when === "day" ? "当日" : "前日"}の配信）`);
      process.exit(0);
    }
  }

  const data = JSON.parse(readFileSync(join(ROOT, "site/data/calendar.json"), "utf-8"));
  const cal = makeCalendar(data, DEFAULT_RULES);
  const text = buildMessage(cal, date, when);
  if (!text) {
    const r0 = cal.info(date);
    console.log(`${date}（${when === "day" ? "当日" : "前日"}の配信）：通知対象ではありません（${r0.status}${r0.n ? " " + r0.n + "日分" : ""}${r0.irregular ? " ★" : ""}）`);
    process.exit(0);
  }
  console.log(`${date}（${when === "day" ? "当日" : "前日"}の配信）：通知します\n----\n${text}\n----`);
  if (dryRun) { console.log("（--dry-run のため送信しません）"); process.exit(0); }
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.log("::warning::LINE_CHANNEL_ACCESS_TOKEN が未設定のため送信しませんでした。");
    process.exit(0);
  }
  try {
    const to = process.env.LINE_GROUP_ID || "";
    const r = await send(token, text, retryKey(date, text), to);
    console.log(`${to ? "グループ" : "友だち全員"}へ${r === "sent" ? "送信しました" : "：同じ内容は送信済みです"}`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}

#!/usr/bin/env node
// LINE公式アカウントから、まとめ発注・いつもと違う発注日の前日にお知らせを一斉配信する。
//
//   node scripts/notify.mjs                    # 今日（JST）の翌日が対象。送信する
//   node scripts/notify.mjs --dry-run          # 送らずに本文だけ表示
//   node scripts/notify.mjs --date 2027-08-12  # 対象日（発注日）を指定
//
// 環境変数 LINE_CHANNEL_ACCESS_TOKEN（Messaging API のチャネルアクセストークン）
//
// 通知する日：発注できる日のうち、次のどちらか
//   - 3日分以上（🟧）
//   - 通常の週（日・水休み）と日数が違う（★）
// 発注できない日は個別に通知せず、前の通知に「次の発注日」として書く。
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

export function shouldNotify(r) {
  return (r.status === "ok" || r.status === "okOpenEnd") && (r.n >= 3 || r.irregular);
}

// 発注日 date の通知本文。通知しない日は null
export function buildMessage(cal, date) {
  const r = cal.info(date);
  if (!shouldNotify(r)) return null;
  const open = r.status === "okOpenEnd";
  const lines = [
    "【青果 発注のお知らせ】",
    `明日 ${md(date)} は ${mark(r.n)}${r.irregular ? "★" : ""}${r.n}日分${open ? "以上" : ""} の発注です`,
    `・納品：${md(r.delivery)}`,
    `・対象：${md(r.delivery)}〜${md(r.until)}`,
  ];
  if (!open) lines.push(`・次の発注日：${md(r.until)}`);
  if (r.irregular) {
    const u = r.usual;
    const days = [];
    for (let t = add(date, 1); t <= add(r.until, 1); t = add(t, 1)) {
      const k = cal.dayIrregular(t);
      if (k) days.push(`${md(t)} ${k === "closed" ? "休市" : "開市"}`);
    }
    lines.push(`・通常の週なら ${u.status === "ng" ? "発注不可" : u.n + "日分"}${days.length ? "（" + days.join("、") + "）" : ""}`);
  }
  lines.push("", PAGE_URL);
  return lines.join("\n");
}

// 同じ対象日・本文なら同じ値になる UUID（再実行しても二重送信しない）
export function retryKey(date, text) {
  const h = createHash("sha256").update(`seika-order-calendar|${date}|${text}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function broadcast(token, text, key) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Line-Retry-Key": key },
        body: JSON.stringify({ messages: [{ type: "text", text }] }),
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
  const date = opt("--date") || add(todayJst, 1);

  const data = JSON.parse(readFileSync(join(ROOT, "site/data/calendar.json"), "utf-8"));
  const cal = makeCalendar(data, DEFAULT_RULES);
  const text = buildMessage(cal, date);
  if (!text) {
    console.log(`${date}：通知対象ではありません（${cal.info(date).status}${cal.info(date).n ? " " + cal.info(date).n + "日分" : ""}）`);
    process.exit(0);
  }
  console.log(`${date}：通知します\n----\n${text}\n----`);
  if (dryRun) { console.log("（--dry-run のため送信しません）"); process.exit(0); }
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.log("::warning::LINE_CHANNEL_ACCESS_TOKEN が未設定のため送信しませんでした。");
    process.exit(0);
  }
  try {
    const r = await broadcast(token, text, retryKey(date, text));
    console.log(r === "sent" ? "送信しました" : "同じ内容は送信済みです");
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}

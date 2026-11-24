#!/usr/bin/env python3
"""高知市中央卸売市場（青果）の休市日を取得し、発注カレンダー用データを作る。

使い方:
  python scripts/build.py              # 2本の公開icsを取得して site/data/calendar.json を更新
  python scripts/build.py --offline    # data/raw/*.ics の保存済みファイルから作り直す（取得しない）

終了コード:
  0  正常（変更の有無は GITHUB_OUTPUT の changed=true/false で返す）
  1  取得失敗・データ異常（前回より件数が大きく減った等）。既存データは上書きしない
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT = ROOT / "site" / "data" / "calendar.json"
STATUS = ROOT / "data" / "status.json"

SOURCES = {
    # 予定が入っている日＝青果の卸から仕入れられない日として扱う（予定名では判定しない）
    "closed": {
        "id": "kochi.seika@gmail.com",
        "name": "01休市日",
    },
    # 臨時開市日。判定には使わず、注記と検証にだけ使う
    "open": {
        "id": "j17fj9852o9fm1remkm4msu2p8@group.calendar.google.com",
        "name": "02臨時開市日",
    },
}
ICS_URL = "https://calendar.google.com/calendar/ical/{}/public/basic.ics"

# 前回より件数がこの割合を下回ったら異常とみなして更新しない
MIN_RATIO = 0.5
# 変更がなくても、この日数を超えたら status.json を更新してコミットさせる（60日無効化の回避）
KEEPALIVE_DAYS = 28

JST = dt.timezone(dt.timedelta(hours=9))


def ics_url(cal_id: str) -> str:
    return ICS_URL.format(urllib.request.quote(cal_id, safe=""))


def fetch(cal_id: str) -> str:
    url = ics_url(cal_id)
    req = urllib.request.Request(url, headers={"User-Agent": "seika-order-calendar/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8")
    if "BEGIN:VCALENDAR" not in body:
        raise ValueError(f"iCalendarではない応答です: {url}\n{body[:200]}")
    return body


def unfold(text: str) -> list[str]:
    """RFC 5545 の行の折り返しを戻す。"""
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        if raw.startswith((" ", "\t")) and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    return lines


def unescape(v: str) -> str:
    return v.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def parse_date(prop: str, value: str) -> dt.date:
    v = value.strip()
    if "VALUE=DATE" in prop or len(v) == 8:
        return dt.date(int(v[0:4]), int(v[4:6]), int(v[6:8]))
    # 日時の予定（想定外だが念のため）：JSTの日付に直す
    t = dt.datetime.strptime(v.rstrip("Z"), "%Y%m%dT%H%M%S")
    if v.endswith("Z"):
        t = t.replace(tzinfo=dt.timezone.utc).astimezone(JST)
    return t.date()


def parse_ics(text: str) -> dict[str, str]:
    """終日予定を {YYYY-MM-DD: 予定名} にする。複数日の予定は日ごとに展開する。"""
    days: dict[str, str] = {}
    ev: dict | None = None
    for line in unfold(text):
        if line == "BEGIN:VEVENT":
            ev = {}
            continue
        if line == "END:VEVENT":
            if ev is not None and ev.get("status") != "CANCELLED" and "start" in ev:
                if "rrule" in ev:
                    raise ValueError(f"繰り返し予定には未対応です: {ev}")
                start = ev["start"]
                end = ev.get("end", start + dt.timedelta(days=1))
                d = start
                while d < max(end, start + dt.timedelta(days=1)):
                    key = d.isoformat()
                    note = ev.get("summary", "")
                    days[key] = note if key not in days else days[key]
                    d += dt.timedelta(days=1)
            ev = None
            continue
        if ev is None or ":" not in line:
            continue
        prop, value = line.split(":", 1)
        name = prop.split(";", 1)[0].upper()
        if name == "DTSTART":
            ev["start"] = parse_date(prop, value)
        elif name == "DTEND":
            ev["end"] = parse_date(prop, value)
        elif name == "SUMMARY":
            ev["summary"] = unescape(value).strip()
        elif name == "STATUS":
            ev["status"] = value.strip().upper()
        elif name == "RRULE":
            ev["rrule"] = value
    return dict(sorted(days.items()))


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def set_output(**kw: str) -> None:
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a", encoding="utf-8") as f:
            for k, v in kw.items():
                f.write(f"{k}={v}\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="保存済みの data/raw/*.ics から作る")
    ap.add_argument("--today", help="判定に使う日付（テスト用、YYYY-MM-DD）")
    args = ap.parse_args()

    now = dt.datetime.now(JST)
    today = dt.date.fromisoformat(args.today) if args.today else now.date()

    texts: dict[str, str] = {}
    for key, src in SOURCES.items():
        raw = RAW_DIR / f"{key}.ics"
        if args.offline:
            texts[key] = raw.read_text(encoding="utf-8")
        else:
            try:
                texts[key] = fetch(src["id"])
            except Exception as e:  # noqa: BLE001
                print(f"::error::{src['name']} の取得に失敗しました: {e}", file=sys.stderr)
                return 1

    closed = parse_ics(texts["closed"])
    open_ = parse_ics(texts["open"])

    prev = load_json(OUT)
    prev_n = len(prev.get("closed", {}))
    if prev_n and len(closed) < prev_n * MIN_RATIO:
        print(f"::error::休市日の件数が {prev_n} → {len(closed)} に減りました。更新を中止します。", file=sys.stderr)
        return 1
    if not closed:
        print("::error::休市日が0件です。", file=sys.stderr)
        return 1

    overlap = sorted(set(closed) & set(open_))
    if overlap:
        print(f"::warning::休市日と臨時開市日の両方に入っている日があります（休市日として扱います）: {overlap}")

    last_day = max(closed)
    data = {
        "source": {k: {"id": v["id"], "name": v["name"], "url": ics_url(v["id"])} for k, v in SOURCES.items()},
        "first": min(closed),
        "last": last_day,
        "closed": closed,
        "open": open_,
    }

    changed = data != {k: prev.get(k) for k in data}
    if changed:
        data["updated_at"] = now.isoformat(timespec="seconds")
    else:
        data["updated_at"] = prev.get("updated_at", now.isoformat(timespec="seconds"))

    # 元データの ics は取得時刻（DTSTAMP）が毎回変わるため、中身が変わったときだけ保存する
    if not args.offline:
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        for key, text in texts.items():
            raw = RAW_DIR / f"{key}.ics"
            if changed or not raw.exists():
                raw.write_text(text, encoding="utf-8")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    # 状態ファイル：データ変更時か、前回記録から KEEPALIVE_DAYS 日以上経ったときだけ書く
    status = load_json(STATUS)
    last_rec = status.get("checked_on")
    stale = (not last_rec) or (today - dt.date.fromisoformat(last_rec)).days >= KEEPALIVE_DAYS
    if changed or stale:
        STATUS.parent.mkdir(parents=True, exist_ok=True)
        STATUS.write_text(json.dumps({
            "checked_on": today.isoformat(),
            "closed_days": len(closed),
            "open_days": len(open_),
            "last": last_day,
        }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    # 12月に入っても翌年分がなければ知らせる
    next_year = today.year + 1
    missing_next = today.month == 12 and last_day < f"{next_year}-01-01"

    print(f"休市日 {len(closed)}件（{min(closed)}〜{last_day}）、臨時開市日 {len(open_)}件、変更 {'あり' if changed else 'なし'}")
    if missing_next:
        print(f"::warning::{next_year}年の休市日がまだ登録されていません。")
    set_output(changed=str(changed).lower(), missing_next_year=str(missing_next).lower(),
               next_year=str(next_year), last=last_day)
    return 0


if __name__ == "__main__":
    sys.exit(main())

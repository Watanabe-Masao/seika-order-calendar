// テスト用：tests/fixtures の ics から calendar.json 相当のデータを作る
// （site/data/calendar.json は毎週更新されるため、テストには固定のフィクスチャを使う）
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const py = `
import json,sys
sys.path.insert(0,'scripts')
import build
c=build.parse_ics(open('tests/fixtures/closed.ics',encoding='utf-8').read())
o=build.parse_ics(open('tests/fixtures/open.ics',encoding='utf-8').read())
print(json.dumps({'first':min(c),'last':max(c),'closed':c,'open':o,'updated_at':'2026-11-24T18:04:46+09:00'},ensure_ascii=False))`;

export const fixtureData = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf-8", cwd: ROOT }));

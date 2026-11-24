"""scripts/build.py のicsパーサのテスト。  python -m unittest discover -s tests"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"


class ParseIcs(unittest.TestCase):
    def test_fixture_counts(self):
        closed = build.parse_ics((FIX / "closed.ics").read_text(encoding="utf-8"))
        opened = build.parse_ics((FIX / "open.ics").read_text(encoding="utf-8"))
        self.assertEqual(len(closed), 806)
        self.assertEqual(len(opened), 17)
        self.assertEqual(min(closed), "2021-01-01")
        self.assertEqual(max(closed), "2027-12-31")
        self.assertFalse(set(closed) & set(opened))

    def test_known_days(self):
        closed = build.parse_ics((FIX / "closed.ics").read_text(encoding="utf-8"))
        for d in ["2027-08-14", "2027-08-15", "2027-08-16", "2027-08-18", "2026-12-30", "2026-12-31"]:
            self.assertIn(d, closed)
        self.assertNotIn("2026-12-27", closed)  # 臨時開市日
        self.assertIn("青果仲卸は営業", closed["2026-12-30"])  # 折り返し・エスケープを含む予定名

    def test_folding_escape_multiday_cancel(self):
        text = "\r\n".join([
            "BEGIN:VCALENDAR",
            "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20270101", "DTEND;VALUE=DATE:20270104",
            "SUMMARY:年始休市\\, 青果", " ・水産", "END:VEVENT",
            "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20270110", "DTEND;VALUE=DATE:20270111",
            "SUMMARY:取消", "STATUS:CANCELLED", "END:VEVENT",
            "END:VCALENDAR", ""])
        days = build.parse_ics(text)
        self.assertEqual(list(days), ["2027-01-01", "2027-01-02", "2027-01-03"])
        self.assertEqual(days["2027-01-01"], "年始休市, 青果・水産")

    def test_rrule_rejected(self):
        text = "BEGIN:VEVENT\nDTSTART;VALUE=DATE:20270101\nRRULE:FREQ=WEEKLY\nEND:VEVENT\n"
        with self.assertRaises(ValueError):
            build.parse_ics(text)


if __name__ == "__main__":
    unittest.main()

import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from worker import money, parse_invoice, classify, credit_code_valid


def word(text, x, y):
    return {"text": text, "x": x, "y": y, "h": 12}


class ParserTests(unittest.TestCase):
    def test_credit_code_checks_without_guessing(self):
        self.assertTrue(credit_code_valid("000000000000000000"))
        self.assertFalse(credit_code_valid("000000000000000001"))

    def test_exact_money(self):
        self.assertEqual(money("¥12,273.10"), 1227310)
        self.assertEqual(money("0.29"), 29)
        self.assertEqual(money("-13,009.49"), -1300949)
        self.assertEqual(money("0"), 0)
        self.assertIsNone(money("***"))
        self.assertIsNone(money("12.345"))

    def test_digital_invoice(self):
        result = parse_invoice([word("电子发票（增值税专用发票）", 250, 70), word("发票号码：20000000000000000001", 740, 85), word("开票日期：2026年09月07日", 740, 100), word("名称：购买公司", 90, 210), word("销", 495, 210), word("名称：销售公司", 570, 210), word("*生产生活服务*物业管理费", 70, 400), word("合 计", 90, 740), word("¥12273.10", 680, 740), word("¥736.39", 900, 740), word("价税合计（大写）", 90, 770), word("（小写）¥13009.49", 700, 770)])
        self.assertEqual(result["invoiceNumber"], "20000000000000000001")
        self.assertEqual(result["buyerName"], "购买公司")
        self.assertEqual(result["totalCents"], 1300949)
        self.assertEqual(result["amountCents"], 1227310)
        self.assertEqual(result["taxCents"], 73639)
        self.assertEqual(result["invoiceDate"], "2026-09-07")
        self.assertEqual(result["category"], "物业费")

    def test_tax_exempt(self):
        r = parse_invoice([word("发票号码：20000000000000000101", 700, 100), word("*畜禽产品*鸡蛋", 60, 410), word("免税", 840, 410), word("合计 ￥43411.70 ***", 100, 750), word("价税合计（小写）¥43411.70", 100, 800)], "ocr")
        self.assertEqual(r["taxCents"], 0)
        self.assertEqual(r["totalCents"], 4341170)
        self.assertTrue(any("逐位核对" in w for w in r["warnings"]))

    def test_ambiguous_numbers_are_not_guessed(self):
        r = parse_invoice([word("发票号码：20000000000000000101", 600, 100), word("发票号码：20000000000000000102", 600, 600)])
        self.assertEqual(r["invoiceNumber"], "")
        self.assertTrue(any("多个发票号码" in w for w in r["warnings"]))

    def test_bank_account_is_not_invoice_number(self):
        r = parse_invoice([word("银行账号：12345678901234567890", 600, 800)])
        self.assertEqual(r["invoiceNumber"], "")

    def test_classification_does_not_invent_unknown_category(self):
        self.assertEqual(classify("奇怪的商品"), "未分类")
        self.assertEqual(classify("*畜禽产品*鸡蛋"), "食品 / 农产品")


if __name__ == "__main__":
    unittest.main()

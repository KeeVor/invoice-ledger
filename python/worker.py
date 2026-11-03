"""Line-delimited JSON worker. Stdout is reserved for protocol messages."""
from __future__ import annotations

import contextlib
import json
import os
import re
import sys
import traceback
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
MODEL_DIR = Path(os.environ.get("INVOICE_MODELS", ROOT / "models"))
ENGINE = None
ITEM_MARKER = re.compile(r"^[*＊][^*＊\n]{1,30}[*＊]")
ITEM_STOP = re.compile(
    r"^(?:合\s*计|价税合计|备\s*注|项目名称|规格型号|单位|数\s*量|单\s*价|金\s*额|税\s*率|征收率|税\s*额)"
)


def money(value):
    if value is None:
        return None
    try:
        cleaned = re.sub(r"[¥￥,，\s]", "", str(value))
        if not re.fullmatch(r"-?\d+(?:\.\d{1,2})?", cleaned):
            return None
        amount = Decimal(cleaned) * 100
        if abs(amount) > 10**14:
            return None
        return int(amount.quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except InvalidOperation:
        return None


def rows_from_words(words):
    rows = []
    for w in sorted(words, key=lambda w: (w["y"], w["x"])):
        row = next((r for r in reversed(rows[-6:]) if abs(r["y"] - w["y"]) < max(6, min(w.get("h", 12) * .55, 12))), None)
        if row is None:
            row = {"y": w["y"], "words": []}
            rows.append(row)
        row["words"].append(w)
    for row in rows:
        row["words"].sort(key=lambda w: w["x"])
        row["text"] = " ".join(w["text"] for w in row["words"])
    return rows


def classify(item):
    rules = [("物业费", ("物业",)), ("交通出行", ("运输", "客运", "通行费", "出租车", "火车", "机票")),
             ("住宿费", ("住宿", "酒店")), ("餐饮费", ("餐饮", "餐费")), ("办公用品", ("文具", "办公用品", "硒鼓", "打印纸")),
             ("食品 / 农产品", ("鸡蛋", "农产品", "畜禽", "食品", "蔬菜", "粮食")), ("水电能源", ("电费", "水费", "燃气")),
             ("技术服务", ("软件", "技术服务", "信息技术"))]
    return next((name for name, keys in rules if any(key in item for key in keys)), "未分类")


def credit_code_valid(code):
    alphabet = "0123456789ABCDEFGHJKLMNPQRTUWXY"
    weights = (1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28)
    if len(code) != 18 or any(c not in alphabet for c in code):
        return False
    total = sum(alphabet.index(c) * weight for c, weight in zip(code[:17], weights))
    return code[-1] == alphabet[(31 - total % 31) % 31]


def extract_items(words):
    heads = sorted(
        (
            word
            for word in words
            if word["x"] < 245 and ITEM_MARKER.match(word["text"].strip())
        ),
        key=lambda word: (word["y"], word["x"]),
    )
    items = []
    for index, head in enumerate(heads):
        next_y = heads[index + 1]["y"] if index + 1 < len(heads) else float("inf")
        row_height = max(6, min(head.get("h", 12) * .55, 12))
        parts = []
        for word in words:
            text = word["text"].strip()
            if not text or word["x"] >= 245:
                continue
            delta_y = word["y"] - head["y"]
            same_row = abs(delta_y) < row_height and word["x"] >= head["x"] - 2
            continuation = (
                0 < delta_y < min(45, next_y - head["y"])
                and abs(word["x"] - head["x"]) < 30
            )
            if not same_row and not continuation:
                continue
            if continuation and ITEM_STOP.match(text):
                continue
            if word is not head and ITEM_MARKER.match(text):
                continue
            parts.append(word)
        value = "".join(
            word["text"].strip()
            for word in sorted(parts, key=lambda word: (word["y"], word["x"]))
        )
        if value:
            items.append(value)
    return list(dict.fromkeys(items))


def parse_invoice(words, source="pdf-text"):
    rows = rows_from_words(words)
    text = "\n".join(r["text"] for r in rows)
    compact = re.sub(r"[ \t]", "", text)
    warnings = []
    number = ""
    candidates = []
    for row in rows:
        line = re.sub(r"\s", "", row["text"])
        if re.search(r"发票号码|发票号[:：]", line):
            m = re.search(r"(?:发票号码|发票号)[:：]?(\d{20}|\d{8})(?!\d)", line)
            if m:
                candidates.append(m[1])
    if len(set(candidates)) == 1:
        number = candidates[0]
    elif len(set(candidates)) > 1:
        warnings.append("页面包含多个发票号码，请拆分为单张发票后导入")
    else:
        # Only fall back to a unique 20-digit number in the upper invoice area.
        upper = [w["text"] for w in words if w["y"] < 420]
        numbers = set(re.findall(r"(?<!\d)\d{20}(?!\d)", " ".join(upper)))
        if len(numbers) == 1:
            number = numbers.pop()
            warnings.append("发票号码由候选数字提取，请对照原件确认")
    code_match = re.search(r"发票代码[:：]?(\d{10,12})(?!\d)", compact)
    code = code_match[1] if code_match else ""
    date_match = re.search(r"(?:开票日期[:：]?)?(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?", compact)
    date = f"{date_match[1]}-{int(date_match[2]):02d}-{int(date_match[3]):02d}" if date_match else ""
    invoice_type = "增值税专用发票" if "专用发票" in compact else "普通发票" if "普通发票" in compact else "电子发票" if "电子发票" in compact else "待确认"
    names = ["", ""]
    taxids = ["", ""]
    for row in rows:
        for side in (0, 1):
            chunk = "".join(w["text"] for w in row["words"] if (w["x"] < 505) == (side == 0) and w["text"] not in ("购", "买", "方", "信", "息", "销", "售"))
            nm = re.search(r"(?:名称|名 称)[:：](.+)", chunk)
            if nm and not names[side]:
                names[side] = re.split(r"统一社会|纳税人|销售方|购买方", nm[1])[0].strip()
            ids = re.findall(r"(?<![A-Z0-9])[A-Z0-9]{18}(?![A-Z0-9])", chunk)
            if ids and not taxids[side]:
                taxids[side] = ids[0]
    # A single OCR box can contain an entire buyer/seller row; split both labels.
    for row in rows:
        found = re.findall(r"名称[:：]\s*(.*?)(?=名称[:：]|统一社会|纳税人|$)", row["text"])
        if len(found) == 2 and not all(names):
            names = [re.sub(r"\s", "", v) for v in found]
    amounts = {"amountCents": None, "taxCents": None, "totalCents": None}
    for row in rows:
        line = re.sub(r"\s", "", row["text"])
        values = re.findall(r"[¥￥]?(-?\d[\d,，]*\.\d{2})(?!\d)", line)
        if "价税合计" in line or "小写" in line:
            if values:
                amounts["totalCents"] = money(values[-1])
        elif re.search(r"合计", line) and values:
            amounts["amountCents"] = money(values[0])
            if len(values) >= 2:
                amounts["taxCents"] = money(values[-1])
            elif "免税" in compact or "***" in line:
                amounts["taxCents"] = 0
    if amounts["totalCents"] is None:
        m = re.search(r"小写[)）:：]*[¥￥]?(-?\d[\d,，]*\.\d{2})", compact)
        if m:
            amounts["totalCents"] = money(m[1])
    if amounts["taxCents"] is None and "免税" in compact:
        amounts["taxCents"] = 0
    if amounts["amountCents"] is None and amounts["totalCents"] is not None and amounts["taxCents"] is not None:
        amounts["amountCents"] = amounts["totalCents"] - amounts["taxCents"]
        warnings.append("不含税金额由价税合计减税额计算，请核对")
    items = extract_items(words)
    if not items:
        items = re.findall(r"[*＊][^*＊\n]{1,20}[*＊][^\n]{1,30}", compact)
    item = "；".join(dict.fromkeys(items))[:500]
    if len(items) > 1:
        warnings.append("检测到多个项目：本版按整张发票归类，混合项目建议选“多类目 / 待拆分”")
    if not number:
        warnings.append("未能可靠识别发票号码，必须人工填写")
    if len(number) == 8 and not code:
        warnings.append("旧版发票需要填写发票代码")
    if not date:
        warnings.append("未能识别开票日期")
    if not names[0] or not names[1]:
        warnings.append("购销方名称识别不完整，请核对")
    for label, taxid in zip(("购买方", "销售方"), taxids):
        if taxid and not credit_code_valid(taxid):
            warnings.append(f"{label}统一社会信用代码校验未通过，请特别核对 0/O 等字符；这不是发票真伪判断")
    if any(v is None for v in amounts.values()):
        warnings.append("金额字段不完整，请对照原件填写")
    elif amounts["amountCents"] + amounts["taxCents"] != amounts["totalCents"]:
        warnings.append("不含税金额 + 税额不等于价税合计，请修正")
    if source == "ocr":
        warnings.append("图片 OCR 结果：请逐位核对发票号码，并确认金额")
    if "发票" not in compact:
        warnings.append("未检测到明确的发票标题，此文件可能不是发票")
    return {"invoiceNumber": number, "invoiceCode": code, "invoiceDate": date, "invoiceType": invoice_type,
            "buyerName": names[0], "sellerName": names[1], "buyerTaxId": taxids[0], "sellerTaxId": taxids[1],
            "itemName": item, "category": "多类目 / 待拆分" if len(items) > 1 else classify(item), **amounts,
            "notes": "", "source": source, "warnings": warnings, "rawText": text[:50000]}


def get_engine():
    global ENGINE
    if ENGINE is None:
        with contextlib.redirect_stdout(sys.stderr):
            from rapidocr import RapidOCR
            params = {"Det.limit_side_len": 1600, "Det.limit_type": "max", "Global.log_level": "error"}
            for kind, prefix in (("Det", "det"), ("Rec", "rec"), ("Cls", "cls")):
                paths = sorted(MODEL_DIR.glob(f"*{prefix}*.onnx"))
                if paths:
                    params[f"{kind}.model_path"] = str(paths[0])
            ENGINE = RapidOCR(params=params)
    return ENGINE


def ocr_words(image):
    import numpy as np
    with contextlib.redirect_stdout(sys.stderr):
        result = get_engine()(np.asarray(image.convert("RGB")))
    words = []
    if result.boxes is None:
        return words
    width, height = image.size
    for box, txt, score in zip(result.boxes, result.txts, result.scores):
        x0, y0 = float(min(p[0] for p in box)), float(min(p[1] for p in box))
        y1 = float(max(p[1] for p in box))
        words.append({"text": txt, "x": x0 / width * 1000, "y": (y0 + y1) / 2 / height * 1000, "h": (y1 - y0) / height * 1000, "score": float(score)})
    return words


def preview_region(image):
    """Trim screenshot chrome only when a wide red invoice frame is detected."""
    import cv2
    import numpy as np
    rgb = np.asarray(image)
    red = ((rgb[:, :, 0].astype(int) - rgb[:, :, 1] > 35) &
           (rgb[:, :, 0].astype(int) - rgb[:, :, 2] > 25) &
           (rgb[:, :, 0] > 90)).astype("uint8") * 255
    horizontal = cv2.morphologyEx(red, cv2.MORPH_OPEN, np.ones((1, max(30, image.width // 5)), dtype="uint8"))
    points = cv2.findNonZero(horizontal)
    if points is None:
        return image
    x, y, width, height = cv2.boundingRect(points)
    if width < image.width * .6 or height < image.height * .12 or height > image.height * .8:
        return image
    red_points = cv2.findNonZero(red)
    rx, ry, rw, rh = cv2.boundingRect(red_points)
    if rh > image.height * .8:
        return image
    margin_x, margin_y = int(image.width * .035), int(rh * .12)
    return image.crop((max(0, rx - margin_x), max(0, ry - margin_y), min(image.width, rx + rw + margin_x), min(image.height, ry + rh + margin_y)))


def process(path, output_dir):
    from PIL import Image, ImageOps
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    results = []
    if Path(path).suffix.lower() == ".pdf":
        import pdfplumber
        import pypdfium2 as pdfium
        with pdfplumber.open(path) as pdf, pdfium.PdfDocument(path) as rendered:
            if len(pdf.pages) > 100:
                raise ValueError("单个 PDF 超过 100 页，请拆分后导入")
            for index, page in enumerate(pdf.pages):
                words = [{"text": w["text"], "x": w["x0"] / page.width * 1000, "y": (w["top"] + w["bottom"]) / 2 / page.height * 1000, "h": (w["bottom"] - w["top"]) / page.height * 1000} for w in page.extract_words(x_tolerance=2, y_tolerance=3)]
                rp = rendered[index]
                bitmap = rp.render(scale=min(3, 2200 / max(rp.get_size())))
                image = bitmap.to_pil().convert("RGB")
                image.thumbnail((1800, 2200))
                preview = output / f"page-{index + 1}.png"
                image.save(preview)
                bitmap.close()
                rp.close()
                native = parse_invoice(words)
                if not native["invoiceNumber"] or native["totalCents"] is None:
                    recognized = parse_invoice(ocr_words(image), "ocr")
                    if recognized["invoiceNumber"] and recognized["totalCents"] is not None:
                        native = recognized
                    else:
                        native["warnings"].append("文字解析或 OCR 未能完整识别，请人工核对")
                results.append({**native, "page": index + 1, "previewPath": str(preview)})
                image.close()
    else:
        with Image.open(path) as original:
            if getattr(original, "n_frames", 1) > 1:
                raise ValueError("多帧图片暂不支持，请拆分为单张图片或转换为 PDF")
            if original.width * original.height > 45_000_000:
                raise ValueError("图片超过 4500 万像素，请缩小后导入")
            image = ImageOps.exif_transpose(original).convert("RGB")
            words = ocr_words(image)
            cropped = preview_region(image)
            if cropped is not image:
                image.close()
                image = cropped
            image.thumbnail((1800, 2400))
            preview = output / "page-1.png"
            image.save(preview)
            image.close()
        results.append({**parse_invoice(words, "ocr"), "page": 1, "previewPath": str(preview)})
    return results


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            result = process(request["path"], request["outputDir"])
            response = {"id": request["id"], "results": result}
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            response = {"id": request.get("id"), "error": str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

import test from "node:test";
import assert from "node:assert/strict";
import { recognitionNotice, userError } from "../src/messages";

test("IPC errors retain useful guidance without internal prefixes", () => {
  assert.equal(
    userError(
      new Error(
        "Error invoking remote method 'save-draft': Error: 输入格式不正确，请检查后重试",
      ),
    ),
    "输入格式不正确，请检查后重试",
  );
  assert.match(
    userError(new Error("SQLITE_CONSTRAINT_UNIQUE: invoices.identity_key")),
    /已在台账/,
  );
  assert.match(
    userError(new Error("ENOENT: open D:\\private\\invoice.pdf")),
    /找不到文件/,
  );
  assert.match(
    userError(new Error("SQLITE_FULL: database or disk is full")),
    /磁盘空间不足/,
  );
});

test("unexpected diagnostics do not expose implementation details", () => {
  for (const error of [
    undefined,
    new Error("TypeError: cannot read field"),
    "OCR 失败 Traceback",
    "读取失败 D:\\private\\invoices.db",
  ]) {
    assert.equal(userError(error, "请重新选择文件。"), "请重新选择文件。");
  }
  assert.match(userError("数据库来自更新版本，请升级软件后打开"), /请更新票迹/);
  assert.equal(userError("请等待导入或备份完成"), "请等待导入或备份完成");
});

test("historical recognition notes are translated without dropping verification advice", () => {
  assert.match(
    recognitionNotice("图片 OCR 结果：请逐位核对发票号码，并确认金额"),
    /逐位核对发票号码/,
  );
  assert.match(
    recognitionNotice(
      "销售方统一社会信用代码校验未通过，请特别核对 0/O 等字符；这不是发票真伪判断",
    ),
    /销售方税号可能有误/,
  );
  assert.equal(
    recognitionNotice("OCR 内部错误 Traceback"),
    "部分内容未识别清楚，请对照原件核对。",
  );
  assert.equal(recognitionNotice("请核对开票日期"), "请核对开票日期");
});

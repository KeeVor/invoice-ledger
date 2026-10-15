// Stored recognition notes can outlive the software version that created them.
const recognitionCopy: Record<string, string> = {
  "发票号码由候选数字提取，请对照原件确认":
    "发票号码可能有误，请对照原件逐位核对。",
  "不含税金额由价税合计减税额计算，请核对":
    "不含税金额未能直接识别，已根据合计和税额补全，请核对。",
  "检测到多个项目：本版按整张发票归类，混合项目建议选“多类目 / 待拆分”":
    "这张发票包含多个项目，请核对分类；无法归为一类时可选择“多类目 / 待拆分”。",
  "未能可靠识别发票号码，必须人工填写": "发票号码未识别清楚，请对照原件填写。",
  "金额字段不完整，请对照原件填写": "金额未识别完整，请对照原件补充。",
  "图片 OCR 结果：请逐位核对发票号码，并确认金额":
    "请对照图片逐位核对发票号码，并确认金额。",
  "文字解析或 OCR 未能完整识别，请人工核对":
    "部分内容未识别清楚，请对照原件补充并核对。",
};

export function recognitionNotice(message: string): string {
  if (recognitionCopy[message]) return recognitionCopy[message];
  return userError(
    message.replace(
      "统一社会信用代码校验未通过，请特别核对 0/O 等字符；这不是发票真伪判断",
      "税号可能有误，请对照原件核对，注意区分 0 和 O；此提示不判断发票真伪。",
    ),
    "部分内容未识别清楚，请对照原件核对。",
  );
}

const errorCopy: Record<string, string> = {
  "数据库来自更新版本，请升级软件后打开":
    "这份账本由新版票迹创建，请更新票迹后再打开。",
  "本地识别引擎未安装。开发环境请运行 npm run python:setup；安装版请重新安装完整软件。":
    "发票识别暂不可用，请重新安装票迹后重试。",
  识别返回内容过大: "这份文件内容过多，请拆分为单张发票后重试。",
  "识别进程已退出，请重试": "识别意外中断，请重新导入；若仍失败，请重启票迹。",
  非法的数据文件路径: "文件位置异常，无法继续。请重新选择文件或备份。",
  数据目录不能包含符号链接:
    "保存位置包含不支持的链接文件，无法备份。请使用原始文件后重试。",
  备份不能包含符号链接: "这份备份包含不支持的链接文件，请选择其他备份。",
  备份超过安全解压限制:
    "这份备份过大或文件过多，暂时无法恢复。请选择其他备份。",
  备份数据库校验失败: "这份备份已损坏或与当前版本不兼容，请选择其他备份。",
  备份数据库关联记录不完整: "这份备份的记录不完整，请选择其他备份。",
  不允许的调用来源: "本次操作未完成，请重新打开票迹后重试。",
};

export function userError(
  error: unknown,
  fallback = "操作未完成，请重试；若仍失败，请重新打开票迹。",
): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim();
  if (errorCopy[message]) return errorCopy[message];
  if (/\b(ENOENT|ENOTDIR)\b/.test(message))
    return "找不到文件，请确认文件未被移动或删除，再重新选择。";
  if (/\b(EACCES|EPERM)\b/.test(message))
    return "无法访问文件，请确认有访问权限，或选择其他保存位置。";
  if (/\b(ENOSPC|SQLITE_FULL)\b/.test(message))
    return "磁盘空间不足，请腾出空间后重试。";
  if (/\b(EBUSY|SQLITE_BUSY|SQLITE_LOCKED)\b/.test(message))
    return "文件正在使用中，请关闭占用它的程序后重试。";
  if (/\bSQLITE_CONSTRAINT_UNIQUE\b/.test(message))
    return "这张发票已在台账中，请查看已有记录。";
  if (/\b(ENAMETOOLONG)\b/.test(message))
    return "文件名或保存位置过长，请缩短后重试。";
  if (/\bEEXIST\b/.test(message))
    return "此位置已有同名文件，请更换名称或保存位置。";
  if (
    !/[\u3400-\u9fff]/.test(message) ||
    /SQLite|SQLITE_|数据库|CPU|OCR|Electron|npm\s|node_modules|Traceback|Error:|\bat\s+\S+\s*\(|[A-Za-z]:[\\/]/i.test(
      message,
    )
  )
    return fallback;
  return message;
}

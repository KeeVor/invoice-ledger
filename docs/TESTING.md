# 测试说明

## 自动化测试

```powershell
npm run build
npm test
npm run test:python
npm run test:updates:ui
```

- TypeScript 单元测试覆盖号码身份、归档查重、金额精度、字段与日期校验、搜索与筛选、跨页合计、首次录入时间、两种统计口径、备份路径与完整性、提示文案、更新状态及安装前置条件。
- Python 测试覆盖金额、日期、号码歧义、银行账号误判防护、购销方、免税、分类和税号校验。它们不加载真实 OCR 模型，不是识别准确率基准。
- 更新桌面测试使用独立 `.test-data/` 账本，验证真实 preload IPC 和界面；下载与安装使用测试适配器。覆盖开发环境禁用、手动下载、版本说明不执行 HTML、取消安装、备份失败阻止安装、确认安装及 1000×740 布局。不会访问正式账本或启动安装程序。
- CI 在 Windows 上运行这些检查；Release 工作流额外构建识别程序和安装包，校验 `latest.yml`、文件大小与 SHA512，并生成 SHA256 校验文件。

## 业务集成测试

`scripts/smoke.mjs`、`scripts/ui-smoke.mjs` 和 `scripts/check-package.mjs` 保留完整导入、核对、导出、备份恢复及打包测试。公开版本使用虚构发票号码，不包含真实票据文件。

运行以下命令生成虚构 PDF 和图片（依赖开发环境中的 Pillow 和 Windows 微软雅黑字体）：

```powershell
.venv\Scripts\python.exe scripts/generate-samples.py
```

输出位于 `.test-data/synthetic-samples/`，内容如下：

| 样例 | 号码 | 不含税金额 | 税额 | 价税合计 |
| --- | --- | --- | --- | --- |
| PDF | `20000000000000000001` | 12273.10 | 736.39 | 13009.49 |
| 图片 | `20000000000000000101` | 43411.70 | 0.00 | 43411.70 |

样例日期为 2026 年 9 月，PDF 分类为物业费，图片分类为食品 / 农产品。该组脚本含固定字段和金额断言，不是接收任意票据的通用测试。若修改样例内容，应同步修改断言。

```powershell
$env:SAMPLE_PDF = (Resolve-Path .test-data/synthetic-samples/invoice.pdf).Path
$env:SAMPLE_IMAGE = (Resolve-Path .test-data/synthetic-samples/invoice.png).Path
npm run test:smoke
npm run test:ui
npm run test:package
```

`test:ui` 复制已通过 smoke 的隔离账本，不操作正式数据。现有 `test:package` 的实际 EXE 启动检查会只读访问正式账本，因此应先退出正在运行的票迹；使用 `--worker-only` 可以跳过启动，但不能视为完整 EXE 验证。不要把私有票据或测试输出提交到公开仓库。

## 验证边界

- v0.2.x 在开发电脑上有真实 PDF / 图片及桌面流程通过记录；含真实票据的截图和本地验证历史不公开。
- 没有承诺覆盖所有发票版式、低清拍照、手写、同页多票或跨页附表。
- 尚未在另一台完全干净的 Windows 电脑上完成安装与覆盖升级验证。
- 更新的状态机和模拟交互通过，不等于真实的旧版本下载、安装和重启升级全部通过。完整链路需使用隔离 Windows 用户或虚拟机验证，不能牺牲正式账本做试验。
- 尚无长时间大批量压力、断电故障注入、所有恢复失败点和防病毒兼容性测试。
- 安装包未签名。校验和可发现下载损坏，不能替代发布者身份验证。

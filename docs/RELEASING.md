# 发布与应用内更新

## 发布流程

1. 修改代码，补充测试和 `CHANGELOG.md`。
2. 运行 `npm version 版本号 --no-git-tag-version`，同步提交 `package.json` 与 `package-lock.json`。
3. 运行 `npm run build`、`npm test`、`npm run test:python` 和 `npm run test:updates:ui`。
4. 提交代码后创建与版本一致的标签，例如 `git tag v0.3.1`，再推送提交和标签。
5. `release.yml` 在 Windows 上构建，先上传到草稿 Release，全部资产到位后才公开发布。

每个正式 Release 必须包含：

- `Piaoji-Setup-版本号.exe`
- `Piaoji-Setup-版本号.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`

不要手工修改 `latest.yml` 中的版本、路径、大小或 SHA512。元数据与安装包必须来自同一次构建。不要只上传安装包，否则旧版客户端无法发现更新。

本地构建输出固定为 `release/current`。`npm run dist` 在构建前清理旧版本目录、`python-build` 和 `python-dist`，发布包生成后再清理 `win-unpacked` 与 Python 中间产物，只保留安装包、blockmap、`latest.yml`、`SHA256SUMS.txt` 和少量构建元数据。需要 `win-unpacked` 做打包检查时，运行 `npm run dist:dir`。

工作流使用仓库自带的 `GITHUB_TOKEN`，权限仅为发布需要的 `contents: write`；应用内没有 GitHub 令牌，也不需要用户登录 GitHub。可通过 Actions 页面重跑失败的标签构建。公开后的同版本资产不得覆盖；修复应发布更高版本。

## 客户端行为

- 更新源固定为 `https://github.com/KeeVor/invoice-ledger` 的正式 Releases，不接受界面指定 URL。
- 仅 Windows NSIS 安装版启用更新；开发环境和 `win-unpacked` 目录只提供发布页面入口。
- 启动约 12 秒后检查一次，也可手动检查。不会自动下载、退出或安装。
- 更新下载后，普通退出不会触发安装，必须点击安装按钮并确认。
- 安装前等待导入和备份任务完成，经确认后退出并打开安装程序，不额外创建更新前备份。
- 退出准备期间阻止写入。数据保存在 `%APPDATA%\Piaoji`，升级不清空它。
- 不接收预发布版本，不允许自动降级。v0.2.2 及更早版本需手动安装一次新版。

## 备份策略

- 仅在本次运行有数据变更、正常退出时自动备份，保留最新 1 份完整备份。
- 新备份先写入临时文件，试解包并校验数据库、引用的原件与预览，再确认为正式备份；成功后才清理旧的自动备份，以及旧版遗留的 `before-update-*`、`before-restore-*` 备份。
- 新备份创建或校验失败时，不删除旧备份。清理被文件占用等原因中断时，可能暂时保留多份，下次成功自动备份会再次清理。
- 更新前、恢复前不额外备份；恢复仍先校验待恢复文件，并保留恢复过程中的临时回滚保护。手动导出的备份不自动删除。

## 安全与验证边界

目前没有 Windows 代码签名证书。HTTPS 与更新元数据中的 SHA512 校验可以检测下载损坏，但不能替代发布者代码签名，也不能抵御仓库或发布账号被攻陷。没有关闭 electron-updater 的签名验证；将来配置证书与发布者身份后须测试旧客户端到签名版本的迁移。

请为 GitHub 账号开启双因素认证，限制仓库写权限。公开发布前检查提交：不得包含账本、备份、真实票据、截图、凭据或签名私钥。默认忽略的本地设计历史也不能通过 `git add -f` 发布。

首次发布可验证元数据、打包配置和检查链路，但没有更早的带更新功能版本。完整覆盖升级应在隔离 Windows 用户或虚拟机内，以实际安装的旧版本升级到更高测试版本验证；单元测试和模拟界面不等于真实安装验证。

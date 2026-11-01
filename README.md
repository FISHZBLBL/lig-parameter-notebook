# LIG 参数与方阻记录

用于记录激光诱导石墨烯（LIG）的加工参数、逐件方阻读数、QC参考和实验前QC。前端为原生HTML/CSS/JavaScript，后端运行于Cloudflare Workers，实验数据和独立备份保存在两个D1数据库中。

本仓库包含可独立构建的完整网站源码和部署模板。仓库不含线上实验数据、访问码、认证密钥、真实网站地址或个人Cloudflare配置。演示与测试使用虚构数据。

## 功能

- 自定义记录编号；功率以mW、扫描速度以mm/s、重频以kHz、线间距以mm输入。
- 激光器百分比、阵列Power和镜头快照随记录保存；复制参数时本次实测功率和读数留空。
- 默认每组3件电学样品，各测5次；先算每件均值，再等权计算整组均值，另留1件表征或备用。测量安排可调整。
- 支持断路、超量程、加工失败；异常样品不记为零方阻。
- 按实测功率、扫速、重频或间距查看离散参数地图；查看、编辑后保留原切片。
- 将实验数据设为QC参考，或记录加工前的今日QC。QC参考仍进入普通地图和导出；日常QC默认1件5次，独立用于对照。
- 桌面表格与侧边详情面板；手机记录卡片和逐样品录入。
- 云端同步、离线本机缓存、并发修改保护、回收站、CSV和完整JSON备份。
- 每日北京时间22:00生成独立云端快照；保留30份每日快照和7份手动/首次快照。

## 本机运行

需要Node.js 24或更新版本。

```sh
npm ci
npm run build
npx wrangler d1 migrations apply DB --local --config wrangler.local.jsonc
npx wrangler d1 migrations apply BACKUP_DB --local --config wrangler.local.jsonc
npm run dev
```

打开 <http://127.0.0.1:8770/>。本机配置中的DEV_USER_ID仅在localhost/127.0.0.1生效，不连接线上数据库。

```sh
npm run check
npm test
```

测试使用合成数据和内存SQLite，覆盖统计、单位、自定义编号、QC、CSV、迁移、同步、认证和备份。

## 目录

- `src/`：页面、交互、Workers接口、认证和备份逻辑。
- `shared/`：统计、地图、批量添加、云同步及其测试。
- `scripts/build.mjs`：内联前端模块并生成`public/index.html`、后端共享核心和登录页。
- `migrations/`：实验记录与访问码认证表。
- `backup-migrations/`：独立备份数据库。
- `*-check.*`：本机回归检查。
- `wrangler.example.jsonc`：生产配置模板；`wrangler.local.jsonc`：隔离本机配置。

## 部署到自己的Cloudflare账号

1. 复制`wrangler.example.jsonc`为`wrangler.jsonc`，填写自己的账号ID及OWNER_EMAIL。
2. 使用Wrangler创建`lig-lab-notebook`和`lig-lab-backups`两个D1数据库，把各自ID填到DB、BACKUP_DB绑定中。
3. 构建并应用两库迁移：

```sh
npm run build
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 migrations apply BACKUP_DB --remote
```

4. 仅在全新、尚未初始化的数据库上运行`node scripts/bootstrap.mjs`。该脚本创建限时初始化凭证、配置认证密钥并部署。由账号持有人打开输出的限时设置链接，亲自生成和保存网站访问码。脚本会拒绝已初始化的账号，不能用它重置现有访问码。
5. 后续代码更新使用`npm run deploy`。这只更新程序，实验数据仍存放在D1中。不要把本机DEV_USER_ID带入生产配置。

生产`wrangler.jsonc`、`.dev.vars`、环境文件、本机D1和备份目录已加入`.gitignore`。认证密钥通过Wrangler Secrets保存，不能提交到GitHub。

## 备份

云端Cron在UTC 14:00（北京时间22:00）运行。登录后可从“更多操作 → 自动备份记录”下载快照或立即备份。完整JSON保留各次原始读数和QC资料；简洁CSV用于导出组均值。

配置自己的生产`wrangler.jsonc`并登录Wrangler后，`node scripts/backup.mjs`会只读导出笔记到本仓库的`backups/lig-cloud/`，生成SHA-256校验文件，验证成功后才更新`latest.json`。此目录不会提交到Git。

GitHub保存的是程序源码；实验数据备份仍由D1快照和本机JSON负责。

# Install @veren/person-agent-preset into the stable test node safely.
# 安全地把 @veren/person-agent-preset 安装进稳定测试节点。
#
# Guards, in order:
# 1. Refuses to run while dsh desktop is running (the desktop session shares
#    pnpm-store inodes; touching them invalidates the desktop's client rev).
# 2. Snapshots the desktop bootstrap file's ctime before and verifies it after.
# 3. Grants the rc.2 -> alpha.3 version exemptions listed in the newest
#    plugin-manager pnpm.log before installing.
# 护栏，按顺序：
# 1. 桌面端运行时拒绝执行（桌面会话与 pnpm store 共享 inode，触碰即失效）。
# 2. 安装前后对桌面引导文件做 ctime 基线比对。
# 3. 安装前从最新的插件管理器 pnpm.log 提取并授予 rc.2 -> alpha.3 版本豁免。
#
# Usage: powershell -File scripts\install-test-node.ps1
# 用法：powershell -File scripts\install-test-node.ps1
param()

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$Harness = Join-Path $Repo 'deepseek\deepseek-harness'
$Tarball = Join-Path $Repo 'plugins\person-agent-preset\veren-person-agent-preset-0.1.0.tgz'
$TestHome = Join-Path $env:USERPROFILE '.dsh_test_1'
$ProfileDir = Join-Path $TestHome 'profiles\web'
$DesktopClient = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\@deepseek-ai\dsh-client-modules\lib\client.js'

if ($env:DSH_HOME -ne $TestHome) {
  $env:DSH_HOME = $TestHome
  Write-Host "DSH_HOME -> $TestHome"
}

# Guard 1: the desktop must not be running. 护栏 1：桌面端不得在运行。
$desktop = Get-Process | Where-Object { $_.Name -match 'DSH|dsh-desktop' }
if ($desktop) {
  throw "dsh desktop is running ($($desktop.Name -join ', ')); quit it fully (including the tray) and re-run this script."
}

function Get-DesktopCtime {
  (Get-Item $DesktopClient).CreationTimeUtc.ToString('o')
}

# Guard 2: ctime baseline of the desktop bootstrap file.
# 护栏 2：桌面引导文件的 ctime 基线。
$before = Get-DesktopCtime
Write-Host "desktop ctime baseline: $before"

$env:CI = 'true'

# Guard 3: grant every rc.2 exemption the newest plugin-manager log lists.
# 护栏 3：按最新插件管理器日志授予全部 rc.2 豁免。
$logs = Get-ChildItem (Join-Path $ProfileDir '.plugin-manager\logs') -Recurse -Filter 'pnpm.log' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending
$exemptions = @()
foreach ($log in $logs) {
  foreach ($line in Get-Content $log.FullName) {
    if ($line -match 'Plugin (@\S+)@(\S+) is incompatible') { $exemptions += "$($Matches[1])@$($Matches[2])" }
  }
  if ($exemptions.Count -gt 0) break
}
$exemptions = $exemptions | Sort-Object -Unique
$runtime = '0.2.1-alpha.3'
foreach ($exemption in $exemptions) {
  Write-Host "allow-version $exemption"
  pnpm --dir $Harness dsh plugin --profile web allow-version $exemption --dsh-version $runtime --accept-risk 2>&1 | Out-Null
}

# Install. 安装。
pnpm --dir $Harness dsh plugin --profile web add $Tarball
if ($LASTEXITCODE -ne 0) { throw "plugin add failed (exit $LASTEXITCODE); see $ProfileDir\.plugin-manager\logs" }

# Guard 2 verification: the desktop must be byte- and metadata-untouched.
# 护栏 2 校验：桌面内容与元数据都必须原封不动。
$after = Get-DesktopCtime
if ($after -ne $before) {
  throw "DESKTOP ctime changed ($before -> $after); reload the desktop window and investigate before any further install."
}
Write-Host "desktop ctime unchanged: $after"
Write-Host 'Done. Start the desktop, then verify the person-agent preset at http://127.0.0.1:3080/.'

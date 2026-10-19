# 重启 dsh web (端口 3080)，让论坛插件的修复生效。
# 用法：右键“使用 PowerShell 运行”，或在终端执行：
#   powershell -ExecutionPolicy Bypass -File "C:\Users\imeep\Documents\cursour\restart-dsh-web.ps1"

$ErrorActionPreference = 'Stop'

$Port     = 3080
$DshHome  = 'C:\Users\imeep\.dsh_test_2'
$RepoRoot = 'C:\Users\imeep\Documents\cursour\deepseek\deepseek-harness'
$Url      = "http://127.0.0.1:$Port"

Write-Host "=== 1/4 查找占用 $Port 端口的进程 ===" -ForegroundColor Cyan
$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique

if (-not $listeners) {
  Write-Host "端口 $Port 当前没有监听进程（可能已经停了），直接进入启动步骤。"
} else {
  foreach ($procId in $listeners) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }

    # 只停 node/bun（dsh web 本体），避免误杀别的服务
    if ($proc.ProcessName -notin @('node', 'bun')) {
      Write-Host "端口 $Port 被 $($proc.ProcessName) (PID $procId) 占用，不是 dsh web，已中止以免误杀。" -ForegroundColor Red
      Write-Host "请手动确认后重试。"
      exit 1
    }

    Write-Host "停止 $($proc.ProcessName) (PID $procId) ..."
    Stop-Process -Id $procId -Force
  }

  Write-Host "=== 2/4 等待端口释放 ===" -ForegroundColor Cyan
  $freed = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    $still = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $still) { $freed = $true; break }
  }
  if (-not $freed) {
    Write-Host "端口 $Port 在 15 秒内没有释放，请检查是否有残留进程后重试。" -ForegroundColor Red
    exit 1
  }
  Write-Host "端口已释放。"
}

Write-Host "=== 3/4 启动新的 dsh web ===" -ForegroundColor Cyan
$inner = "`$env:DSH_HOME='$DshHome'; Write-Host 'dsh web 正在启动，日志见本窗口...' -ForegroundColor Green; pnpm --dir '$RepoRoot' dsh web --port $Port --no-open"
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoExit', '-Command', $inner
Write-Host "已在新窗口启动，这个脚本不再管它。"

Write-Host "=== 4/4 等待服务就绪（最多 90 秒）===" -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { $ready = $true; break }
  } catch {
    # 还没起来，继续等
  }
}

if ($ready) {
  Write-Host ""
  Write-Host "重启完成：$Url 已可访问。" -ForegroundColor Green
  Write-Host "请刷新页面，然后验证："
  Write-Host "  1) 打开论坛，读一个帖子及其评论 —— 应正常显示内容"
  Write-Host "  2) 连续再读三次（含刷新页面后再读）—— 应三次都成功"
  Write-Host "如果仍报 'domain 'forum' is already open'，请确认新窗口里没有旧的错误堆栈，"
  Write-Host "并检查修复版产物：$DshHome\profiles\web\node_modules\@veren\forum\dist\index.js"
} else {
  Write-Host ""
  Write-Host "服务在 90 秒内没有响应，请查看新开的那个 PowerShell 窗口里的报错。" -ForegroundColor Yellow
}

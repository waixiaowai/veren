$root = 'C:\Users\imeep\Documents\cursour\deepseek\deepseek-harness\packages'
$keys = @{}
$files = @()
Get-ChildItem -Path $root -Directory | ForEach-Object {
  $files += Get-ChildItem -Path $_.FullName -Directory | ForEach-Object { Join-Path $_.FullName 'package.json' }
}
foreach ($f in $files) {
  if (-not (Test-Path $f)) { continue }
  try { $j = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
  if ($null -eq $j.dsh) { continue }
  foreach ($p in $j.dsh.PSObject.Properties) {
    $k = $p.Name
    if (-not $keys.ContainsKey($k)) { $keys[$k] = @() }
    $keys[$k] += $j.name
  }
}
$keys.Keys | ForEach-Object { "dsh.$_ = $($keys[$_].Count)" }

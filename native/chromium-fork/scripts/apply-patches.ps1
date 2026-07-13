. (Join-Path $PSScriptRoot 'common.ps1')
Set-ChromiumBuildEnvironment
Assert-LockedCheckout

if (& git.exe -C $script:SourceRoot status --porcelain --untracked-files=no) {
  throw 'Chromium tracked files must be clean before applying patches'
}
$series = Get-Content (Join-Path $script:ForkRoot 'patches\series') | Where-Object { $_ -and -not $_.StartsWith('#') }
foreach ($patchName in $series) {
  $patchPath = Join-Path $script:ForkRoot "patches\$patchName"
  if (-not (Test-Path $patchPath)) { throw "Patch missing: $patchPath" }
  # A blob-less Chromium partial clone cannot create a commit tree without
  # fetching every missing promisor blob. Apply to worktree + index instead;
  # the patch queue remains deterministic and the locked base HEAD is retained.
  & git.exe -C $script:SourceRoot apply --index $patchPath
  if ($LASTEXITCODE -ne 0) { throw "Patch failed: $patchName" }
}

Write-Host "Applied $($series.Count) AI-FREE Chromium patches"

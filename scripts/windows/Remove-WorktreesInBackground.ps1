[CmdletBinding()]
param(
  [ValidateSet('Start', 'Worker', 'Status', 'Cancel')]
  [string]$Action = 'Status',
  [string[]]$TargetPath,
  [string]$AllowedRoot = 'D:\source',
  [ValidateRange(10, 5000)]
  [int]$BatchSize = 250,
  [ValidateRange(0, 10000)]
  [int]$DelayMilliseconds = 250,
  [string]$JobName = 'fuze-worktree-cleanup',
  [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FuzeFront\cleanup-jobs'
$statePath = Join-Path $stateRoot "$JobName.json"
$logPath = Join-Path $stateRoot "$JobName.log"
$cancelPath = Join-Path $stateRoot "$JobName.cancel"

function Resolve-SafeTarget([string]$Value) {
  $root = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\')
  $target = [IO.Path]::GetFullPath($Value).TrimEnd('\')
  if ($target -eq $root -or -not $target.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Target must be a child of the allowed root: $root"
  }
  if ([IO.Path]::GetPathRoot($target).TrimEnd('\') -eq $target) {
    throw 'A filesystem root cannot be removed.'
  }
  return $target
}

function Write-State([hashtable]$Value) {
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  $Value.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  $Value | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statePath -Encoding utf8
}

if ($Action -eq 'Status') {
  if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath }
  else { Write-Output '{"status":"not-found"}' }
  exit 0
}

if ($Action -eq 'Cancel') {
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  New-Item -ItemType File -Path $cancelPath -Force | Out-Null
  Write-Output "Cancellation requested for $JobName."
  exit 0
}

if (-not $TargetPath -or $TargetPath.Count -eq 0) { throw 'At least one explicit -TargetPath is required.' }
$targets = @($TargetPath | ForEach-Object { Resolve-SafeTarget $_ } | Select-Object -Unique)

if ($Action -eq 'Start') {
  if (-not $Confirmed) {
    Write-Output 'Dry run only. Validated targets:'
    $targets | ForEach-Object { Write-Output "  $_" }
    Write-Output 'Re-run with -Confirmed after verifying every branch is pushed or otherwise recoverable.'
    exit 0
  }
  if (Test-Path -LiteralPath $statePath) {
    $prior = Get-Content -LiteralPath $statePath | ConvertFrom-Json
    if ($prior.status -eq 'running') { throw "Cleanup job '$JobName' is already running." }
  }
  Remove-Item -LiteralPath $cancelPath -Force -ErrorAction SilentlyContinue
  Write-State @{ status = 'starting'; targets = $targets; batchSize = $BatchSize; delayMilliseconds = $DelayMilliseconds; deletedFiles = 0 }
  $arguments = @(
    '-NoProfile', '-File', $PSCommandPath, '-Action', 'Worker',
    '-AllowedRoot', $AllowedRoot, '-BatchSize', "$BatchSize",
    '-DelayMilliseconds', "$DelayMilliseconds", '-JobName', $JobName,
    '-TargetPath'
  ) + $targets
  $process = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $arguments -WindowStyle Hidden -PassThru
  Write-State @{ status = 'running'; pid = $process.Id; targets = $targets; batchSize = $BatchSize; delayMilliseconds = $DelayMilliseconds; deletedFiles = 0 }
  Write-Output "Started cleanup job '$JobName' as PID $($process.Id). Log: $logPath"
  exit 0
}

$state = @{ status = 'running'; pid = $PID; targets = $targets; batchSize = $BatchSize; delayMilliseconds = $DelayMilliseconds; deletedFiles = 0 }
Write-State $state
try {
  foreach ($target in $targets) {
    while (Test-Path -LiteralPath $target) {
      if (Test-Path -LiteralPath $cancelPath) {
        $state.status = 'cancelled'
        Write-State $state
        exit 0
      }
      $files = @(Get-ChildItem -LiteralPath $target -Recurse -Force -File -ErrorAction SilentlyContinue | Select-Object -First $BatchSize)
      if ($files.Count -eq 0) { break }
      foreach ($file in $files) {
        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
        $state.deletedFiles++
      }
      $state.currentTarget = $target
      Write-State $state
      Add-Content -LiteralPath $logPath -Value "$([DateTimeOffset]::Now.ToString('o')) deleted $($files.Count) files from $target"
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
    if (Test-Path -LiteralPath $target) {
      Get-ChildItem -LiteralPath $target -Recurse -Force -Directory -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
      Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
    }
  }
  $repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  git -C $repositoryRoot worktree prune 2>> $logPath
  $state.status = 'completed'
  $state.currentTarget = $null
  Write-State $state
} catch {
  $state.status = 'failed'
  $state.error = $_.Exception.Message
  Write-State $state
  Add-Content -LiteralPath $logPath -Value "$([DateTimeOffset]::Now.ToString('o')) FAILED: $($_.Exception.Message)"
  throw
}

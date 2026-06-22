# Thin shim -> fuzeone/sync.mjs. Usage: fuzeone\bin\fuzeone.ps1 [sync|check] [--target DIR] [...]
param([Parameter(ValueFromRemainingArguments=$true)] [string[]] $Args)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$sync = Join-Path $here '..\sync.mjs'
if ($Args.Count -gt 0 -and $Args[0] -eq 'check') {
  node $sync --check @($Args[1..($Args.Count-1)])
} elseif ($Args.Count -gt 0 -and $Args[0] -eq 'sync') {
  node $sync @($Args[1..($Args.Count-1)])
} else {
  node $sync @Args
}

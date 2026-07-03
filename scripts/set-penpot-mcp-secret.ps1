# set-penpot-mcp-secret.ps1
#
# Sets the PENPOT_MCP_URL GitHub Secret in every FuzeOne family repo under
# the izzywdev org (any repo that has a .fuze/manifest.json).
#
# USAGE
#   $env:PENPOT_MCP_URL = "https://design.penpot.app/mcp/stream?userToken=<token>"
#   .\scripts\set-penpot-mcp-secret.ps1
#
# REQUIRES
#   gh CLI installed and authenticated (gh auth login)
#
# OPTIONAL OVERRIDES
#   $env:ORG   = "izzywdev"         # default: izzywdev
#   $env:REPOS = "RepoA RepoB"      # space-separated list; skips auto-discovery if set

$ErrorActionPreference = "Stop"

$Org        = if ($env:ORG)   { $env:ORG }   else { "izzywdev" }
$SecretName = "PENPOT_MCP_URL"

# ── Validate environment ──────────────────────────────────────────────────────
if (-not $env:PENPOT_MCP_URL) {
    Write-Host "ERROR: PENPOT_MCP_URL env var is not set." -ForegroundColor Red
    Write-Host '  $env:PENPOT_MCP_URL = "https://design.penpot.app/mcp/stream?userToken=<token>"'
    exit 1
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: gh CLI not found. Install from https://cli.github.com" -ForegroundColor Red
    exit 1
}

$authCheck = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: gh CLI not authenticated. Run: gh auth login" -ForegroundColor Red
    exit 1
}

# ── Discover family repos (or use override) ───────────────────────────────────
if ($env:REPOS) {
    $RepoList = $env:REPOS -split '\s+'
} else {
    Write-Host "Discovering FuzeOne family repos in $Org..." -ForegroundColor Cyan
    $AllRepos = (gh repo list $Org --limit 100 --json name | ConvertFrom-Json).name
    $RepoList = @()
    foreach ($repo in $AllRepos) {
        $apiResult = gh api "repos/$Org/$repo/contents/.fuze/manifest.json" 2>&1
        if ($LASTEXITCODE -eq 0) {
            $RepoList += $repo
            Write-Host "  found: $Org/$repo" -ForegroundColor Gray
        }
    }
}

if ($RepoList.Count -eq 0) {
    Write-Host "No FuzeOne family repos found." -ForegroundColor Yellow
    Write-Host '  Override: $env:REPOS = "RepoA RepoB"; .\scripts\set-penpot-mcp-secret.ps1'
    exit 1
}

Write-Host ""
Write-Host "Setting $SecretName in $($RepoList.Count) repo(s)..." -ForegroundColor Cyan
Write-Host ""

$Failed = @()
foreach ($repo in $RepoList) {
    $Target = "$Org/$repo"
    Write-Host -NoNewline "  $Target ... "
    $env:PENPOT_MCP_URL | gh secret set $SecretName --repo $Target --body -
    if ($LASTEXITCODE -eq 0) {
        Write-Host "OK" -ForegroundColor Green
    } else {
        Write-Host "FAILED" -ForegroundColor Red
        $Failed += $Target
    }
}

Write-Host ""
if ($Failed.Count -eq 0) {
    Write-Host "Done. $SecretName set in all $($RepoList.Count) repo(s)." -ForegroundColor Green
} else {
    Write-Host "Done with errors. Failed repos:" -ForegroundColor Yellow
    $Failed | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    exit 1
}

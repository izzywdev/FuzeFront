# Export Chat History Script
# Usage: .\scripts\export-chat.ps1 "Chat topic or summary"

param(
    [Parameter(Mandatory=$true)]
    [string]$Topic
)

# Get current date and time in the required format
$DateTime = Get-Date -Format "yyyy-MM-dd_HH-mm"

# Create the filename
$FileName = "${DateTime}_chat.md"
$FilePath = "docs/chats/$FileName"

# Ensure the docs/chats directory exists
if (!(Test-Path "docs/chats")) {
    New-Item -ItemType Directory -Path "docs/chats" -Force
    Write-Host "Created docs/chats directory" -ForegroundColor Green
}

# Create the chat history template
$Template = @"
# Chat History: $Topic

**Date:** $(Get-Date -Format "MMMM dd, yyyy")  
**Time:** $(Get-Date -Format "HH:mm")  
**Topic:** $Topic

## Summary

[Add conversation summary here]

## Key Achievements

[List main accomplishments from the conversation]

## Technical Details

[Document any technical implementations, code changes, or architectural decisions]

## Conversation Flow

[Outline the main phases or steps of the conversation]

## Code Examples

[Include relevant code snippets or examples discussed]

## Outcomes

[Document the final results and next steps]

## Repository Changes

[List any files created, modified, or deleted]

---

**Note:** This chat history serves as development documentation and decision record.
"@

# Write the template to the file
$Template | Out-File -FilePath $FilePath -Encoding UTF8

Write-Host "Chat history template created: $FilePath" -ForegroundColor Green
Write-Host "Please edit the file to add the actual conversation details." -ForegroundColor Yellow
Write-Host ""
Write-Host "To commit after editing:" -ForegroundColor Cyan
Write-Host "  git add $FilePath" -ForegroundColor Cyan
Write-Host "  git commit -m `"docs: Add chat history for $Topic`"" -ForegroundColor Cyan
Write-Host "  git push origin master" -ForegroundColor Cyan 
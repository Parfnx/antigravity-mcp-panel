# Antigravity MCP Panel

Standalone `MCP` button in the Antigravity left sidebar (above `Fast switch` / `Settings`) with a theme-adaptive popover to monitor and toggle connected MCP servers.

## Features
- Lists connected, pending, disabled, and errored MCP servers via `LanguageServerService/GetMcpServerStates` (plus entries from `~/.gemini/config/mcp_config.json`).
- Shows a live `ready/total` badge on the sidebar button, transport type (`stdio` / `http`), tool lists, and error messages.
- Supports toggling servers (`ToggleMcpServer`), reconnecting all servers (`RefreshMcpServers`), and opening `mcp_config.json`.
- Theme-adaptive UI; compatible with `antigravity-fast-switch`, `antigravity-context-panel`, and `antigravity-ascii-wallpapers`.

## Requirements
- Windows 10/11
- Python 3
- Node.js (`node --check` during `app.asar` verification)

## Install
```powershell
git clone https://github.com/Parfnx/antigravity-mcp-panel.git
cd antigravity-mcp-panel
powershell -ExecutionPolicy Bypass -File .\apply.ps1
```

## Rollback
```powershell
powershell -ExecutionPolicy Bypass -File .\unpatch.ps1
```

## Note
Re-apply with `.\apply.ps1` after Antigravity auto-updates.

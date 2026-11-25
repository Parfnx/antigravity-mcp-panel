// BEGIN LOCAL MCP PANEL
;
/* Main-process IPC helpers for the sidebar MCP panel (config read + open). */
;(() => {
  'use strict';
  if (global.__agyMcpPanelMainInstalled) return;
  global.__agyMcpPanelMainInstalled = true;

  const { ipcMain, shell } = require('electron');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  function assertOrigin(event) {
    const sf = event?.senderFrame;
    const sender = event?.sender;
    if (
      !sf ||
      sf.parent ||
      (sender?.mainFrame && sf !== sender.mainFrame) ||
      sender?.getType?.() === 'webview' ||
      !/^https:\/\/127\.0\.0\.1:\d+\//.test(sf.url || '')
    ) {
      throw new Error('Unsupported mcp-panel origin');
    }
  }

  function resolveConfigPath() {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.gemini', 'config', 'mcp_config.json'),
      path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return candidates[0];
  }

  ipcMain.removeHandler('mcp-panel:get-config');
  ipcMain.handle('mcp-panel:get-config', async (event) => {
    assertOrigin(event);
    const cfgPath = resolveConfigPath();
    try {
      if (!fs.existsSync(cfgPath)) {
        return { path: cfgPath, exists: false, servers: {} };
      }
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const parsed = JSON.parse(raw);
      const servers =
        parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers !== null
          ? parsed.mcpServers
          : {};
      return { path: cfgPath, exists: true, servers };
    } catch (err) {
      return { path: cfgPath, exists: true, servers: {}, error: String(err?.message || err) };
    }
  });

  ipcMain.removeHandler('mcp-panel:open-config');
  ipcMain.handle('mcp-panel:open-config', async (event) => {
    assertOrigin(event);
    const cfgPath = resolveConfigPath();
    if (!fs.existsSync(cfgPath)) {
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(cfgPath, '{\n  "mcpServers": {}\n}\n', 'utf8');
    }
    const errMsg = await shell.openPath(cfgPath);
    if (errMsg) {
      return { ok: false, path: cfgPath, error: errMsg };
    }
    return { ok: true, path: cfgPath };
  });
})();
// END LOCAL MCP PANEL

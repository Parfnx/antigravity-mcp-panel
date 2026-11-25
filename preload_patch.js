// BEGIN LOCAL MCP PANEL
;
/* Sidebar MCP status button + theme-adaptive popover above Fast switch / Settings. */
;(() => {
  'use strict';
  if (window.self !== window.top) return;
  if (window.__agyMcpPanelInstalled) return;
  window.__agyMcpPanelInstalled = true;

  const ipc = typeof electron_1 !== 'undefined' ? electron_1.ipcRenderer : null;

  let alive = true;
  let open = false;
  let busy = false;
  let togglingName = '';
  let errorText = '';
  let isLoading = false;
  let servers = [];
  let configInfo = { path: '', servers: {} };
  let expanded = new Set();
  let csrf = '';
  let host = null;
  let shadow = null;
  let btnHost = null;
  let btnShadow = null;
  let observer = null;
  let mountTimer = 0;
  let syncTimer = 0;

  const clean = (v) => {
    const s = String(v || '').trim();
    return s && s !== '[REDACTED]' ? s : '';
  };

  async function getCsrf(force = false) {
    const find = (s) => clean(String(s || '').match(/"?csrfToken"?\s*:\s*"([^"]+)"/)?.[1]);
    const fromStore = (skip = '') => {
      const out = [];
      try { out.push(clean(localStorage.getItem('agy_session_csrf_token'))); } catch {}
      if (typeof document.cookie === 'string') {
        try {
          const hit = document.cookie.split('; ').find((x) => x.startsWith('csrfToken='));
          if (hit) out.push(clean(hit.slice(10)));
        } catch {}
      }
      return out.find((v) => v && v !== skip) || '';
    };
    const prev = force ? csrf : '';
    if (force) csrf = '';
    if (!csrf && !force) {
      csrf = fromStore() || [...document.scripts].map((s) => find(s.textContent)).find(Boolean) || '';
    }
    if (!csrf) {
      try {
        const r = await fetch('/', { cache: 'no-store' });
        if (r.ok) csrf = find(await r.text());
      } catch {}
    }
    if (!csrf && force) csrf = fromStore(prev);
    return csrf;
  }

  async function lsRpc(method, body = '{}') {
    if (!/^https:\/\/127\.0\.0\.1:\d+$/.test(location.origin)) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getCsrf(attempt > 0);
      if (!token) return null;
      const r = await fetch('/exa.language_server_pb.LanguageServerService/' + method, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': token,
        },
        body,
      }).catch(() => null);
      if (!r) return null;
      if (r.status === 401 || r.status === 403) {
        csrf = '';
        continue;
      }
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(txt || `RPC ${method} failed (${r.status})`);
      }
      return r.json().catch(() => ({}));
    }
    return null;
  }

  function normalizeStatus(st) {
    if (st?.spec?.disabled) return 'disabled';
    const raw = st?.status;
    if (raw === 'MCP_SERVER_STATUS_READY' || raw === 2) return 'ready';
    if (raw === 'MCP_SERVER_STATUS_PENDING' || raw === 1) return 'pending';
    if (raw === 'MCP_SERVER_STATUS_ERROR' || raw === 3) return 'error';
    if (raw === 'MCP_SERVER_STATUS_DISABLED_BY_ADMIN' || raw === 4) return 'admin_disabled';
    return 'unknown';
  }

  function statusRank(kind) {
    if (kind === 'ready') return 0;
    if (kind === 'pending') return 1;
    if (kind === 'error') return 2;
    if (kind === 'disabled' || kind === 'admin_disabled') return 3;
    return 4;
  }

  function statusLabel(kind, st) {
    if (st?.needsPluginSignIn) return 'Sign-in required';
    switch (kind) {
      case 'ready': return 'Connected';
      case 'pending': return 'Connecting...';
      case 'error': return 'Error';
      case 'disabled': return 'Disabled';
      case 'admin_disabled': return 'Disabled by admin';
      default: return 'Unknown';
    }
  }

  function normalizeState(st) {
    const spec = st?.spec || {};
    const name = String(spec.serverName || st?.serverInfo?.name || 'unnamed').trim();
    const kind = normalizeStatus(st);
    const tools = Array.isArray(st?.tools) ? st.tools : [];
    const transport = spec.serverUrl ? 'http' : spec.command ? 'stdio' : 'mcp';
    const target = spec.serverUrl
      ? String(spec.serverUrl)
      : spec.command
        ? [spec.command, ...(Array.isArray(spec.args) ? spec.args : [])].join(' ')
        : '';
    return {
      name,
      kind,
      disabled: Boolean(spec.disabled),
      adminDisabled: kind === 'admin_disabled',
      label: statusLabel(kind, st),
      error: String(st?.error || '').trim(),
      tools,
      version: String(st?.serverInfo?.version || '').trim(),
      transport,
      target,
      needsSignIn: Boolean(st?.needsPluginSignIn),
      raw: st,
    };
  }

  async function refreshState(showSpinner = false) {
    if (!alive) return;
    if (showSpinner) {
      isLoading = true;
      render();
    }
    try {
      const [rpcRes, cfgRes] = await Promise.all([
        lsRpc('GetMcpServerStates', '{}').catch((err) => {
          errorText = String(err?.message || err);
          return null;
        }),
        ipc && typeof ipc.invoke === 'function'
          ? ipc.invoke('mcp-panel:get-config').catch(() => null)
          : Promise.resolve(null),
      ]);

      if (cfgRes && typeof cfgRes === 'object') {
        configInfo = cfgRes;
      }

      if (rpcRes) {
        errorText = '';
        isLoading = Boolean(rpcRes.isLoading);
        const rawList = Array.isArray(rpcRes.states) ? rpcRes.states : [];
        const mapped = rawList.map(normalizeState);

        const seen = new Set(mapped.map((s) => s.name));
        const cfgServers = configInfo?.servers && typeof configInfo.servers === 'object' ? configInfo.servers : {};
        for (const [k, v] of Object.entries(cfgServers)) {
          if (!seen.has(k)) {
            mapped.push(normalizeState({
              spec: {
                serverName: k,
                command: v?.command,
                args: v?.args,
                serverUrl: v?.serverUrl || v?.url,
                disabled: Boolean(v?.disabled),
              },
              status: v?.disabled ? 'MCP_SERVER_STATUS_UNSPECIFIED' : 'MCP_SERVER_STATUS_PENDING',
            }));
          }
        }

        mapped.sort((a, b) => {
          const r = statusRank(a.kind) - statusRank(b.kind);
          return r !== 0 ? r : a.name.localeCompare(b.name);
        });
        servers = mapped;
      }
    } finally {
      isLoading = false;
      render();
    }
  }

  async function doRefreshAll() {
    if (busy) return;
    busy = true;
    errorText = '';
    render();
    try {
      await lsRpc('RefreshMcpServers', '{}');
      await refreshState(false);
    } catch (err) {
      errorText = String(err?.message || err || 'Refresh failed');
    } finally {
      busy = false;
      render();
    }
  }

  async function doToggle(srv) {
    if (busy || togglingName || srv.adminDisabled) return;
    togglingName = srv.name;
    errorText = '';
    render();
    try {
      await lsRpc('ToggleMcpServer', JSON.stringify({
        serverName: srv.name,
        enabled: srv.disabled,
      }));
      await refreshState(false);
    } catch (err) {
      errorText = String(err?.message || err || 'Toggle failed');
    } finally {
      togglingName = '';
      render();
    }
  }

  async function doOpenConfig() {
    if (!ipc || typeof ipc.invoke !== 'function') return;
    try {
      const res = await ipc.invoke('mcp-panel:open-config');
      if (res && !res.ok && res.error) {
        errorText = res.error;
        render();
      }
    } catch (err) {
      errorText = String(err?.message || err);
      render();
    }
  }

  function readThemePalette() {
    const shell = document.querySelector('.agy-shell') || document.body;
    const cs = getComputedStyle(shell);
    const bodyCs = getComputedStyle(document.body);
    const pick = (name, fallback) => {
      const v = cs.getPropertyValue(name).trim() || bodyCs.getPropertyValue(name).trim();
      return v || fallback;
    };
    const isLight = document.body.dataset.awMode === 'light';
    return {
      isLight,
      panel: pick('--popover', isLight ? '#f6f7fb' : '#0a081e'),
      card: pick('--card', isLight ? '#ffffff' : '#181436'),
      border: pick('--border', isLight ? '#d0d5e2' : '#3c3570'),
      fg: pick('--foreground', isLight ? '#171923' : '#eeeaff'),
      muted: pick('--muted-foreground', isLight ? '#5a6275' : '#b8b0d8'),
      accent: pick('--primary', isLight ? '#5b46c4' : '#b9a3ff'),
      font: bodyCs.fontFamily || 'system-ui, -apple-system, sans-serif',
    };
  }

  function findSettingsButton() {
    const sidebar =
      document.querySelector('[aria-label="Sidebar"]') ||
      document.querySelector('nav.bg-sidebar') ||
      document.querySelector('.agy-inset-shell > div:first-child');
    const root = sidebar || document;
    const candidates = root.querySelectorAll('button, a, [role="button"]');
    let best = null;
    for (const el of candidates) {
      if (
        el.id === 'agy-mcp-panel-btn-host' ||
        el.closest('#agy-mcp-panel-btn-host') ||
        el.id === 'agy-fast-switch-btn-host' ||
        el.closest('#agy-fast-switch-btn-host')
      ) {
        continue;
      }
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^Settings$/i.test(txt)) {
        const r = el.getBoundingClientRect();
        if (r.width > 16 && r.height > 16 && r.left < 380 && r.top > window.innerHeight * 0.45) {
          best = el;
        }
      }
    }
    return best;
  }

  function svgEl(paths, size = 15, strokeWidth = 1.65) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('width', String(size));
    s.setAttribute('height', String(size));
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', String(strokeWidth));
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const p = document.createElementNS(ns, d.tag || 'path');
      for (const [k, v] of Object.entries(d)) {
        if (k !== 'tag') p.setAttribute(k, String(v));
      }
      s.appendChild(p);
    }
    return s;
  }

  function iconPlug(size = 15) {
    return svgEl([
      { d: 'M12 22v-5' },
      { d: 'M9 8V2' },
      { d: 'M15 8V2' },
      { d: 'M18 8v5a6 6 0 0 1-12 0V8Z' },
    ], size);
  }

  function iconRefresh(size = 13) {
    return svgEl([
      { d: 'M21 12a9 9 0 1 1-2.64-6.36' },
      { d: 'M21 3v6h-6' },
    ], size);
  }

  function iconChevron(down = true, size = 13) {
    return svgEl([
      { d: down ? 'M6 9l6 6 6-6' : 'M18 15l-6-6-6 6' },
    ], size, 1.8);
  }

  function iconFile(size = 13) {
    return svgEl([
      { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' },
      { d: 'M14 2v6h6' },
    ], size);
  }

  function ensurePopoverHost() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'agy-mcp-panel-host';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483001;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        *, *::before, *::after { box-sizing: border-box; }
        .mp-panel {
          position: fixed;
          pointer-events: auto;
          width: 344px;
          max-width: calc(100vw - 20px);
          max-height: min(490px, calc(100vh - 88px));
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 10px;
          border-radius: 10px;
          font-family: var(--mp-font);
          color: var(--mp-fg);
          background: color-mix(in srgb, var(--mp-panel) 92%, transparent);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid color-mix(in srgb, var(--mp-border) 55%, transparent);
          box-shadow: 0 14px 40px rgba(0,0,0,0.48), 0 0 0 1px color-mix(in srgb, var(--mp-accent) 14%, transparent);
          transform-origin: bottom left;
        }
        .mp-panel[hidden] { display: none; }
        .mp-panel:not([hidden]) { animation: mp-pop .14s cubic-bezier(.16,1,.3,1); }
        @keyframes mp-pop {
          from { opacity: 0; transform: translateY(6px) scale(.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .mp-head {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 2px 4px 6px;
          border-bottom: 1px solid color-mix(in srgb, var(--mp-border) 35%, transparent);
        }
        .mp-head-title {
          font-size: 12.5px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .mp-count {
          font-size: 10.5px;
          color: var(--mp-muted);
          padding: 1px 6px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--mp-fg) 8%, transparent);
          font-variant-numeric: tabular-nums;
        }
        .mp-spacer { flex: 1; }
        .mp-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--mp-muted);
          cursor: pointer;
          transition: background .12s ease, color .12s ease;
        }
        .mp-icon-btn:hover {
          background: color-mix(in srgb, var(--mp-fg) 10%, transparent);
          color: var(--mp-fg);
        }
        .mp-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow-y: auto;
          max-height: 320px;
          padding-right: 2px;
          scrollbar-width: thin;
        }
        .mp-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 8px 9px;
          border-radius: 8px;
          border: 1px solid color-mix(in srgb, var(--mp-border) 35%, transparent);
          background: color-mix(in srgb, var(--mp-card) 62%, transparent);
          transition: border-color .12s ease, background .12s ease;
        }
        .mp-card[data-status="ready"] {
          border-color: color-mix(in srgb, #5eead4 30%, var(--mp-border));
        }
        .mp-card[data-status="error"] {
          border-color: color-mix(in srgb, #ff7b8d 42%, var(--mp-border));
        }
        .mp-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .mp-dot {
          flex-shrink: 0;
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--mp-muted);
        }
        .mp-dot[data-status="ready"] {
          background: #5eead4;
          box-shadow: 0 0 8px rgba(94, 234, 212, 0.6);
        }
        .mp-dot[data-status="pending"] {
          background: #fbbf24;
          box-shadow: 0 0 8px rgba(251, 191, 36, 0.5);
        }
        .mp-dot[data-status="error"] {
          background: #ff7b8d;
          box-shadow: 0 0 8px rgba(255, 123, 141, 0.55);
        }
        .mp-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .mp-top {
          display: flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
        }
        .mp-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--mp-fg);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mp-badge {
          flex-shrink: 0;
          font-size: 9.5px;
          font-weight: 500;
          padding: 1px 5px;
          border-radius: 4px;
          color: var(--mp-muted);
          background: color-mix(in srgb, var(--mp-fg) 7%, transparent);
          border: 1px solid color-mix(in srgb, var(--mp-border) 35%, transparent);
        }
        .mp-badge.accent {
          color: var(--mp-accent);
          background: color-mix(in srgb, var(--mp-accent) 14%, transparent);
          border-color: color-mix(in srgb, var(--mp-accent) 28%, transparent);
        }
        .mp-sub {
          font-size: 10.5px;
          color: var(--mp-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mp-sub.err { color: #ff8596; }
        .mp-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        .mp-switch {
          position: relative;
          width: 30px;
          height: 17px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--mp-border) 60%, transparent);
          background: color-mix(in srgb, var(--mp-fg) 10%, transparent);
          cursor: pointer;
          padding: 0;
          transition: background .14s ease, border-color .14s ease;
        }
        .mp-switch[data-on="true"] {
          background: color-mix(in srgb, var(--mp-accent) 68%, transparent);
          border-color: var(--mp-accent);
        }
        .mp-switch:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .mp-knob {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 11px;
          height: 11px;
          border-radius: 999px;
          background: #ffffff;
          transition: transform .14s ease;
        }
        .mp-switch[data-on="true"] .mp-knob {
          transform: translateX(13px);
        }
        .mp-details {
          display: flex;
          flex-direction: column;
          gap: 5px;
          padding-top: 5px;
          border-top: 1px solid color-mix(in srgb, var(--mp-border) 28%, transparent);
        }
        .mp-cmd {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 10px;
          color: var(--mp-muted);
          word-break: break-all;
          background: color-mix(in srgb, var(--mp-fg) 5%, transparent);
          padding: 4px 6px;
          border-radius: 5px;
        }
        .mp-errbox {
          font-size: 10.5px;
          color: #ff8596;
          line-height: 1.35;
          word-break: break-word;
          background: color-mix(in srgb, #ff5d73 10%, transparent);
          padding: 5px 7px;
          border-radius: 5px;
        }
        .mp-tools {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .mp-tool-chip {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          color: var(--mp-fg);
          background: color-mix(in srgb, var(--mp-fg) 7%, transparent);
          border: 1px solid color-mix(in srgb, var(--mp-border) 30%, transparent);
        }
        .mp-empty {
          padding: 16px 10px;
          text-align: center;
          font-size: 11.5px;
          color: var(--mp-muted);
          line-height: 1.45;
        }
        .mp-foot {
          display: flex;
          align-items: center;
          gap: 6px;
          padding-top: 4px;
          border-top: 1px solid color-mix(in srgb, var(--mp-border) 35%, transparent);
        }
        .mp-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 29px;
          padding: 0 10px;
          border-radius: 7px;
          font: inherit;
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background .12s ease, border-color .12s ease, opacity .12s ease;
        }
        .mp-btn-primary {
          flex: 1;
          color: var(--mp-fg);
          background: color-mix(in srgb, var(--mp-accent) 16%, var(--mp-card));
          border: 1px solid color-mix(in srgb, var(--mp-accent) 42%, transparent);
        }
        .mp-btn-primary:hover:not(:disabled) {
          background: color-mix(in srgb, var(--mp-accent) 24%, var(--mp-card));
          border-color: var(--mp-accent);
        }
        .mp-btn-ghost {
          color: var(--mp-muted);
          background: transparent;
          border: 1px solid color-mix(in srgb, var(--mp-border) 40%, transparent);
        }
        .mp-btn-ghost:hover:not(:disabled) {
          color: var(--mp-fg);
          background: color-mix(in srgb, var(--mp-fg) 8%, transparent);
        }
        .mp-btn:disabled { opacity: 0.5; cursor: wait; }
        .mp-status {
          font-size: 10.5px;
          color: #ff8596;
          padding: 2px 4px 0;
          word-break: break-word;
        }
      </style>
      <div class="mp-panel" hidden role="dialog" aria-label="MCP servers"></div>
    `;
    document.body.appendChild(host);
  }

  function applyPaletteVars() {
    const p = readThemePalette();
    const apply = (el) => {
      if (!el) return;
      el.style.setProperty('--mp-panel', p.panel);
      el.style.setProperty('--mp-card', p.card);
      el.style.setProperty('--mp-border', p.border);
      el.style.setProperty('--mp-fg', p.fg);
      el.style.setProperty('--mp-muted', p.muted);
      el.style.setProperty('--mp-accent', p.accent);
      el.style.setProperty('--mp-font', p.font);
    };
    apply(host);
    apply(btnHost);
  }

  function positionPanel() {
    if (!shadow || !open) return;
    const panel = shadow.querySelector('.mp-panel');
    if (!panel || !btnHost) return;
    const r = btnHost.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 354));
    const bottom = Math.max(12, window.innerHeight - r.top + 8);
    panel.style.left = Math.round(left) + 'px';
    panel.style.bottom = Math.round(bottom) + 'px';
  }

  function togglePanel(next) {
    open = typeof next === 'boolean' ? next : !open;
    errorText = '';
    if (open) {
      ensurePopoverHost();
      applyPaletteVars();
      render();
      positionPanel();
      void refreshState(true);
    } else {
      render();
    }
  }

  function renderButton() {
    if (!btnShadow) return;
    const btn = btnShadow.querySelector('.mp-nav-btn');
    if (!btn) return;
    btn.setAttribute('aria-expanded', String(open));
    btn.toggleAttribute('data-open', open);
    const narrow = btnHost && btnHost.getBoundingClientRect().width < 96;
    const label = btnShadow.querySelector('.mp-nav-label');
    const pill = btnShadow.querySelector('.mp-nav-pill');
    const dot = btnShadow.querySelector('.mp-nav-dot');
    const readyCount = servers.filter((s) => s.kind === 'ready').length;
    const errCount = servers.filter((s) => s.kind === 'error').length;
    if (label) label.hidden = Boolean(narrow);
    if (dot) {
      dot.dataset.state = errCount > 0 ? 'error' : readyCount > 0 ? 'ready' : 'idle';
    }
    if (pill) {
      pill.textContent = servers.length ? `${readyCount}/${servers.length}` : '0';
      pill.hidden = Boolean(narrow);
      pill.title = `${readyCount} connected of ${servers.length} configured`;
    }
  }

  function render() {
    applyPaletteVars();
    renderButton();
    if (!shadow) return;
    const panel = shadow.querySelector('.mp-panel');
    if (!panel) return;
    panel.hidden = !open;
    if (!open) return;

    const readyCount = servers.filter((s) => s.kind === 'ready').length;

    const head = document.createElement('div');
    head.className = 'mp-head';
    const title = document.createElement('span');
    title.className = 'mp-head-title';
    title.textContent = 'MCP Servers';
    const count = document.createElement('span');
    count.className = 'mp-count';
    count.textContent = `${readyCount}/${servers.length}`;
    const spacer = document.createElement('span');
    spacer.className = 'mp-spacer';
    const refBtn = document.createElement('button');
    refBtn.type = 'button';
    refBtn.className = 'mp-icon-btn';
    refBtn.title = 'Refresh MCP servers';
    refBtn.setAttribute('aria-label', 'Refresh MCP servers');
    refBtn.appendChild(iconRefresh(13));
    refBtn.onclick = () => void refreshState(true);
    head.append(iconPlug(14), title, count, spacer, refBtn);

    const list = document.createElement('div');
    list.className = 'mp-list';

    if (!servers.length) {
      const empty = document.createElement('div');
      empty.className = 'mp-empty';
      empty.textContent = isLoading
        ? 'Loading MCP server states...'
        : 'No MCP servers configured. Click Config below to edit mcp_config.json.';
      list.appendChild(empty);
    } else {
      for (const srv of servers) {
        const card = document.createElement('div');
        card.className = 'mp-card';
        card.dataset.status = srv.kind;

        const row = document.createElement('div');
        row.className = 'mp-row';

        const dot = document.createElement('span');
        dot.className = 'mp-dot';
        dot.dataset.status = srv.kind;

        const info = document.createElement('div');
        info.className = 'mp-info';

        const top = document.createElement('div');
        top.className = 'mp-top';
        const nameEl = document.createElement('span');
        nameEl.className = 'mp-name';
        nameEl.textContent = srv.name;
        top.appendChild(nameEl);

        const trBadge = document.createElement('span');
        trBadge.className = 'mp-badge';
        trBadge.textContent = srv.transport;
        top.appendChild(trBadge);

        if (srv.tools.length > 0) {
          const toolBadge = document.createElement('span');
          toolBadge.className = 'mp-badge accent';
          toolBadge.textContent = `${srv.tools.length} tools`;
          top.appendChild(toolBadge);
        }

        const sub = document.createElement('div');
        sub.className = 'mp-sub' + (srv.kind === 'error' ? ' err' : '');
        const parts = [srv.label];
        if (srv.version) parts.push(`v${srv.version}`);
        if (srv.error) parts.push(srv.error);
        sub.textContent = parts.join(' · ');

        info.append(top, sub);

        const actions = document.createElement('div');
        actions.className = 'mp-actions';

        const hasDetails = Boolean(srv.tools.length || srv.error || srv.target);
        if (hasDetails) {
          const isExp = expanded.has(srv.name);
          const expBtn = document.createElement('button');
          expBtn.type = 'button';
          expBtn.className = 'mp-icon-btn';
          expBtn.title = isExp ? 'Hide details' : 'Show tools & details';
          expBtn.appendChild(iconChevron(!isExp, 13));
          expBtn.onclick = (e) => {
            e.stopPropagation();
            if (expanded.has(srv.name)) expanded.delete(srv.name);
            else expanded.add(srv.name);
            render();
          };
          actions.appendChild(expBtn);
        }

        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'mp-switch';
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(!srv.disabled));
        sw.dataset.on = String(!srv.disabled);
        sw.disabled = Boolean(busy || togglingName === srv.name || srv.adminDisabled);
        sw.title = srv.adminDisabled
          ? 'Disabled by admin'
          : srv.disabled
            ? `Enable ${srv.name}`
            : `Disable ${srv.name}`;
        const knob = document.createElement('span');
        knob.className = 'mp-knob';
        sw.appendChild(knob);
        sw.onclick = (e) => {
          e.stopPropagation();
          void doToggle(srv);
        };
        actions.appendChild(sw);

        row.append(dot, info, actions);
        card.appendChild(row);

        if (hasDetails && expanded.has(srv.name)) {
          const det = document.createElement('div');
          det.className = 'mp-details';
          if (srv.target) {
            const cmd = document.createElement('div');
            cmd.className = 'mp-cmd';
            cmd.textContent = srv.target;
            det.appendChild(cmd);
          }
          if (srv.error) {
            const errBox = document.createElement('div');
            errBox.className = 'mp-errbox';
            errBox.textContent = srv.error;
            det.appendChild(errBox);
          }
          if (srv.tools.length) {
            const toolsWrap = document.createElement('div');
            toolsWrap.className = 'mp-tools';
            for (const t of srv.tools) {
              const chip = document.createElement('span');
              chip.className = 'mp-tool-chip';
              chip.textContent = t.originalName || t.name || 'tool';
              if (t.description) chip.title = String(t.description);
              toolsWrap.appendChild(chip);
            }
            det.appendChild(toolsWrap);
          }
          card.appendChild(det);
        }

        list.appendChild(card);
      }
    }

    const foot = document.createElement('div');
    foot.className = 'mp-foot';

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'mp-btn mp-btn-primary';
    reloadBtn.disabled = busy;
    reloadBtn.append(iconRefresh(13), document.createTextNode(busy ? 'Refreshing...' : 'Reconnect all'));
    reloadBtn.onclick = () => void doRefreshAll();
    foot.appendChild(reloadBtn);

    if (ipc && typeof ipc.invoke === 'function') {
      const cfgBtn = document.createElement('button');
      cfgBtn.type = 'button';
      cfgBtn.className = 'mp-btn mp-btn-ghost';
      cfgBtn.title = configInfo?.path || 'Open mcp_config.json';
      cfgBtn.append(iconFile(13), document.createTextNode('Config'));
      cfgBtn.onclick = () => void doOpenConfig();
      foot.appendChild(cfgBtn);
    }

    const children = [head, list, foot];
    if (errorText) {
      const stEl = document.createElement('div');
      stEl.className = 'mp-status';
      stEl.textContent = errorText;
      children.push(stEl);
    }

    panel.replaceChildren(...children);
    positionPanel();
  }

  function mountButton() {
    if (!alive) return;
    const settingsEl = findSettingsButton();
    if (!settingsEl) return;

    const scs = getComputedStyle(settingsEl);
    if (!btnHost) {
      btnHost = document.createElement('div');
      btnHost.id = 'agy-mcp-panel-btn-host';
      btnHost.style.cssText = 'display:block;width:100%;margin-bottom:2px;';
      btnShadow = btnHost.attachShadow({ mode: 'open' });
      btnShadow.innerHTML = `
        <style>
          :host { all: initial; display: block; width: 100%; }
          *, *::before, *::after { box-sizing: border-box; }
          .mp-nav-btn {
            display: flex;
            align-items: center;
            width: 100%;
            border: 0;
            background: transparent;
            color: var(--mp-muted);
            font-family: var(--mp-font);
            font-size: var(--mp-btn-size, 13px);
            font-weight: var(--mp-btn-weight, 500);
            line-height: 1.3;
            padding: var(--mp-btn-pad, 6px 10px);
            min-height: var(--mp-btn-h, 30px);
            border-radius: var(--mp-btn-rad, 6px);
            gap: 8px;
            cursor: pointer;
            text-align: left;
            transition: background .12s ease, color .12s ease;
            overflow: hidden;
          }
          .mp-nav-btn:hover, .mp-nav-btn[data-open="true"] {
            background: color-mix(in srgb, var(--mp-fg) 8%, transparent);
            color: var(--mp-fg);
          }
          .mp-nav-ico {
            position: relative;
            display: inline-flex;
            align-items: center;
            flex-shrink: 0;
          }
          .mp-nav-ico svg { opacity: 0.9; }
          .mp-nav-dot {
            position: absolute;
            right: -2px;
            bottom: -1px;
            width: 6px;
            height: 6px;
            border-radius: 999px;
            display: none;
          }
          .mp-nav-dot[data-state="ready"] {
            display: block;
            background: #5eead4;
            box-shadow: 0 0 6px rgba(94, 234, 212, 0.7);
          }
          .mp-nav-dot[data-state="error"] {
            display: block;
            background: #ff7b8d;
          }
          .mp-nav-label {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .mp-nav-pill {
            margin-left: auto;
            font-size: 10.5px;
            color: var(--mp-muted);
            opacity: 0.8;
            font-variant-numeric: tabular-nums;
          }
        </style>
        <button class="mp-nav-btn" type="button" aria-expanded="false">
          <span class="mp-nav-ico"><span class="mp-nav-dot" data-state="idle"></span></span>
          <span class="mp-nav-label">MCP</span>
          <span class="mp-nav-pill">0</span>
        </button>
      `;
      btnShadow.querySelector('.mp-nav-ico').prepend(iconPlug(15));
      btnShadow.querySelector('.mp-nav-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        togglePanel();
      });
    }

    btnHost.style.setProperty('--mp-btn-size', scs.fontSize || '13px');
    btnHost.style.setProperty('--mp-btn-weight', scs.fontWeight || '500');
    btnHost.style.setProperty('--mp-btn-pad', scs.padding || '6px 10px');
    btnHost.style.setProperty('--mp-btn-h', scs.height && parseFloat(scs.height) >= 24 ? scs.height : '30px');
    btnHost.style.setProperty('--mp-btn-rad', scs.borderRadius || '6px');

    const parent = settingsEl.parentElement;
    if (!parent) return;
    let anchor = settingsEl;
    const pcs = getComputedStyle(parent);
    if (pcs.display.includes('flex') && pcs.flexDirection === 'row' && parent.parentElement) {
      anchor = parent;
    }
    const container = anchor.parentElement;
    if (!container) return;

    // Place MCP button directly above Fast switch (or directly above Settings if Fast switch is absent)
    // so Fast switch keeps Settings as its nextSibling and never fights DOM order.
    const fsHost = document.getElementById('agy-fast-switch-btn-host');
    const targetBefore = fsHost && fsHost.parentElement === container ? fsHost : anchor;
    if (btnHost.parentElement !== container || btnHost.nextSibling !== targetBefore) {
      container.insertBefore(btnHost, targetBefore);
    }

    applyPaletteVars();
    renderButton();
  }

  function start() {
    ensurePopoverHost();
    mountButton();
    void refreshState(false);
    observer = new MutationObserver(() => {
      if (!mountTimer) {
        mountTimer = setTimeout(() => {
          mountTimer = 0;
          mountButton();
          applyPaletteVars();
        }, 140);
      }
    });
    observer.observe(document.getElementById('root') || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-aw-theme', 'data-aw-mode'],
    });
    syncTimer = setInterval(() => void refreshState(false), open ? 5000 : 15000);
    window.addEventListener('resize', () => {
      positionPanel();
      renderButton();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!open) return;
      const path = e.composedPath();
      if (path.includes(host) || path.includes(btnHost)) return;
      togglePanel(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        togglePanel(false);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
// END LOCAL MCP PANEL

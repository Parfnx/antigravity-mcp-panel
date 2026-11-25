# Antigravity MCP Panel

Отдельная кнопка `MCP` в левом сайдбаре Antigravity (над `Fast switch` / `Settings`) с поповером для мониторинга и управления подключёнными MCP-серверами.

## Возможности
- Показывает все активные, подключающиеся, отключённые и упавшие MCP-серверы через `LanguageServerService/GetMcpServerStates` (и подтягивает записи из `~/.gemini/config/mcp_config.json`).
- Отображает счётчик `ready/total` в сайдбаре, статус-индикатор, транспорт (`stdio` / `http`), список инструментов сервера (`tools`) и текст ошибки.
- Переключает серверы (`ToggleMcpServer`), переподключает все серверы (`RefreshMcpServers`) и открывает `mcp_config.json`.
- Адаптивная палитра под текущую тему Antigravity; совместим с `antigravity-fast-switch` и `antigravity-ascii-wallpapers`.

## Зависимости
- Windows 10/11
- Python 3
- Node.js (`node --check` при сборке `app.asar`)

## Установка
```powershell
git clone https://github.com/Parfnx/antigravity-mcp-panel.git
cd antigravity-mcp-panel
powershell -ExecutionPolicy Bypass -File .\apply.ps1
```

## Откат
```powershell
powershell -ExecutionPolicy Bypass -File .\unpatch.ps1
```

# mimocode-herdr

Herdr integration plugin for [MiMo Code](https://mimo.xiaomi.com/mimocode).

Reports agent state (idle / working / blocked) to [herdr](https://herdr.dev) terminal workspace manager via its socket API.

## Install

```json
{
  "plugin": ["mimocode-herdr"]
}
```

Add this to your `~/.config/mimocode/mimocode.json` (or project-level `.mimocode/mimocode.json`), then restart MiMo Code.

## How it works

When MiMo Code runs inside a herdr pane (detected via `HERDR_ENV=1`), this plugin:

1. Reports the agent as `opencode` to herdr (reuses opencode's full lifecycle hook authority)
2. Overrides the display name to `mimocode` via `pane.report_metadata`
3. Tracks session events and reports state transitions:
   - `session.status` (busy/idle) → working / idle
   - `permission.asked` / `question.asked` → blocked
   - `session.idle` → idle
   - `server.instance.disposed` → releases agent on exit

Outside a herdr environment, the plugin does nothing.

## Exit handling

mimo exits via `server.instance.disposed` (a bus event), not process signals. The plugin registers `process.on("exit")` as a safety net, using a Worker thread with `Atomics.wait` for synchronous socket I/O — no external binaries or `process.execPath` dependency.

## License

MIT

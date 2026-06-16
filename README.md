# mimocode-herdr

Herdr integration plugin for [MiMo Code](https://mimo.xiaomi.com/mimocode).

Reports agent state (idle / working / blocked) to [herdr](https://herdr.dev) terminal workspace manager via its socket API.

## Install

```bash
# In your mimocode.json:
{
  "plugin": ["mimocode-herdr"]
}
```

Or with inline options (no options needed for this plugin):

```json
{
  "plugin": ["mimocode-herdr"]
}
```

Then restart MiMo Code.

## How it works

When MiMo Code runs inside a herdr pane (detected via `HERDR_ENV=1`), this plugin:

1. Reports the agent as `opencode` to herdr (reuses opencode's full lifecycle authority)
2. Overrides the display name to `mimocode` via `pane.report_metadata`
3. Tracks session events and reports state transitions:
   - `session.status` (busy/idle) → working/idle
   - `permission.asked` / `question.asked` → blocked
   - `session.idle` → idle
   - `session.deleted` → releases agent

Outside a herdr environment, the plugin does nothing.

## License

MIT

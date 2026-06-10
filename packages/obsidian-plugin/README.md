# todomd Calendar Sync (Obsidian plugin)

Registers **dated tasks** written in your Obsidian notes to the todomd
sync-engine, which then syncs them to CalDAV (e.g. Samsung Calendar via DAVx5).

Any task line carrying an Obsidian-Tasks date signifier is picked up:

```md
- [ ] 치과 예약 📅 2026-06-20 14:00
- [ ] 보고서 초안 ⏳ 2026-06-18 🔼
- [x] 워크숍 🛫 2026-06-15 📅 2026-06-15
```

📅 due · ⏳ scheduled · 🛫 start. Tasks **without** a date are ignored.

## How it works

1. The plugin scans every note for dated tasks and stamps each one with a stable
   block id (`^a1b2c3`) — written back into the note so the link survives edits.
2. It POSTs the tasks to the engine's `/vault/sync` (idempotent upsert by id),
   then triggers `/sync` to push them to CalDAV.
3. Run it from the **ribbon calendar icon**, the command palette
   (`todomd: 일정 동기화`), or enable **auto-sync on save** in settings.

This is **one-way for now** (Obsidian → calendar): editing an event on your phone
updates the engine's `todo.md` and the web dashboard, but is not yet written back
to the originating note. Removing a task line does not delete its calendar event.

## Build

From the repo root (Docker toolchain):

```bash
make plugin          # bundles src/main.ts → packages/obsidian-plugin/main.js
```

## Install into a vault

Copy the three files into your vault, then enable the plugin in
*Settings → Community plugins*:

```
<your-vault>/.obsidian/plugins/todomd-calendar/
  ├── main.js
  ├── manifest.json
  └── styles.css
```

`make plugin-install VAULT=/path/to/your/vault` does this copy for you.

## Settings

- **Engine URL** — the sync-engine REST API. Same PC: `http://localhost:8787`.
  Phone: your PC's LAN IP (e.g. `http://192.168.20.177:8787`).
- **Token** — only if the engine runs with `TODOMD_TOKEN`.
- **Auto-sync on save** — debounced sync a few seconds after you edit a note.

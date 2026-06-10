import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl } from 'obsidian';

interface TodomdSettings {
  engineUrl: string;
  token: string;
  syncOnSave: boolean;
}

const DEFAULT_SETTINGS: TodomdSettings = {
  engineUrl: 'http://localhost:8787',
  token: '',
  syncOnSave: false,
};

// Obsidian-Tasks date signifiers: 📅 due, ⏳ scheduled, 🛫 start. A task line is
// treated as a calendar entry when it carries at least one of these. Built from
// code points so the source stays pure ASCII (no invisible variation selectors).
const DATE_EMOJI = /[\u{1F4C5}\u{23F3}\u{1F6EB}]/u;
const TASK_LINE = /^\s*[-*]\s+\[[ xX]\]\s+/;
const TRAILING_ID = /\^([0-9a-z]{6})\s*$/;

interface VaultTask {
  id: string;
  raw: string;
  note: string;
}

/** A 6-char base36 block id, unique against everything already seen. */
function genId(used: Set<string>): string {
  for (let i = 0; i < 1000; i++) {
    const id = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    if (id.length === 6 && !used.has(id)) {
      used.add(id);
      return id;
    }
  }
  const id = (Date.now().toString(36) + '000000').slice(-6);
  used.add(id);
  return id;
}

export default class TodomdPlugin extends Plugin {
  settings: TodomdSettings = DEFAULT_SETTINGS;
  private statusBar!: HTMLElement;
  private autoSyncTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon('calendar-check', 'todomd: 일정 동기화', () => void this.syncVault());
    this.addCommand({
      id: 'sync-calendar-tasks',
      name: '일정 동기화 (Sync dated tasks to calendar)',
      callback: () => void this.syncVault(),
    });

    this.statusBar = this.addStatusBarItem();
    this.statusBar.setText('todomd: 대기');

    this.addSettingTab(new TodomdSettingTab(this.app, this));

    if (this.settings.syncOnSave) {
      this.registerEvent(this.app.vault.on('modify', () => this.scheduleAutoSync()));
    }
  }

  private scheduleAutoSync(): void {
    if (this.autoSyncTimer !== null) window.clearTimeout(this.autoSyncTimer);
    this.autoSyncTimer = window.setTimeout(() => void this.syncVault(true), 4000);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Scan every note for dated tasks. Tasks missing a `^id` get one stamped back
   * into the note (so the id is stable across syncs and ready for future
   * write-back). Returns the dated tasks as raw lines for the engine to parse.
   */
  private async scanVault(): Promise<VaultTask[]> {
    const files = this.app.vault.getMarkdownFiles();
    const used = new Set<string>();
    const fileLines = new Map<TFile, string[]>();

    // Pass 1: read all notes, collecting existing ids so new ones never collide.
    for (const file of files) {
      const lines = (await this.app.vault.read(file)).split('\n');
      fileLines.set(file, lines);
      for (const line of lines) {
        if (!TASK_LINE.test(line)) continue;
        const m = TRAILING_ID.exec(line);
        if (m && m[1]) used.add(m[1]);
      }
    }

    // Pass 2: stamp missing ids and collect dated tasks.
    const tasks: VaultTask[] = [];
    for (const [file, lines] of fileLines) {
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (!TASK_LINE.test(line) || !DATE_EMOJI.test(line)) continue;
        const m = TRAILING_ID.exec(line);
        let id: string;
        if (m && m[1]) {
          id = m[1];
        } else {
          id = genId(used);
          lines[i] = line.replace(/\s+$/, '') + ' ^' + id;
          changed = true;
        }
        tasks.push({ id, raw: (lines[i] ?? '').trim(), note: file.path });
      }
      if (changed) await this.app.vault.modify(file, lines.join('\n'));
    }
    return tasks;
  }

  async syncVault(silent = false): Promise<void> {
    try {
      this.statusBar.setText('todomd: 스캔 중…');
      const tasks = await this.scanVault();
      if (tasks.length === 0) {
        this.statusBar.setText('todomd: 일정 없음');
        if (!silent) new Notice('todomd: 날짜가 있는 태스크(📅/⏳/🛫)를 찾지 못했습니다.');
        return;
      }
      this.statusBar.setText(`todomd: 동기화 중… (${tasks.length})`);
      const up = await this.post<{ added: number; updated: number; skipped: number }>(
        '/vault/sync',
        { tasks },
      );
      const sync = await this.post<{ pushed: number; pulled: number }>('/sync', {});
      const msg =
        `todomd: 등록 ${up.added} · 갱신 ${up.updated}` +
        ` · CalDAV ↑${sync.pushed ?? 0} ↓${sync.pulled ?? 0}`;
      this.statusBar.setText(msg);
      if (!silent) new Notice(msg);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.statusBar.setText('todomd: 오류');
      new Notice(`todomd 동기화 실패: ${m}\n설정에서 엔진 주소를 확인하세요.`);
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const base = this.settings.engineUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    if (this.settings.token) headers.Authorization = `Bearer ${this.settings.token}`;
    const res = await requestUrl({
      url: base + path,
      method: 'POST',
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`${path} → HTTP ${res.status}`);
    return res.json as T;
  }
}

class TodomdSettingTab extends PluginSettingTab {
  private plugin: TodomdPlugin;

  constructor(app: App, plugin: TodomdPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'todomd Calendar Sync' });

    new Setting(containerEl)
      .setName('엔진 주소 (Engine URL)')
      .setDesc('sync-engine REST API. 같은 PC면 http://localhost:8787, 폰이면 PC의 LAN IP.')
      .addText((t) =>
        t
          .setPlaceholder('http://localhost:8787')
          .setValue(this.plugin.settings.engineUrl)
          .onChange(async (v) => {
            this.plugin.settings.engineUrl = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('토큰 (Bearer token)')
      .setDesc('엔진에 TODOMD_TOKEN을 설정한 경우에만 입력. 비우면 인증 없음.')
      .addText((t) =>
        t.setValue(this.plugin.settings.token).onChange(async (v) => {
          this.plugin.settings.token = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('저장 시 자동 동기화')
      .setDesc('노트를 수정하면 몇 초 뒤 자동 동기화. (Obsidian 재시작 후 적용)')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.syncOnSave).onChange(async (v) => {
          this.plugin.settings.syncOnSave = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName('지금 동기화').addButton((b) =>
      b
        .setButtonText('일정 동기화')
        .setCta()
        .onClick(() => void this.plugin.syncVault()),
    );
  }
}

import { useCallback, useEffect, useState } from 'preact/hooks';
import { api } from './api';
import type { ConflictDTO, NewTask, ParsePreview, StatusDTO, TaskDTO } from './api';

export function App() {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [status, setStatus] = useState<StatusDTO | null>(null);
  const [conflicts, setConflicts] = useState<ConflictDTO[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [t, s, c] = await Promise.all([api.tasks(), api.status(), api.conflicts()]);
      setTasks(t.tasks);
      setStatus(s);
      setConflicts(c.conflicts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const doSync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await api.sync();
      const up = r.pushed.created.length + r.pushed.updated.length + r.pushed.deleted.length;
      setLastSync(`↑${up} ↓${r.pulled.changed}${r.conflicts.length ? ` · 충돌 ${r.conflicts.length}` : ''}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [reload]);

  const onToggle = useCallback(
    async (task: TaskDTO) => {
      if (!task.id) return;
      await api.updateTask(task.id, { done: !task.done });
      await reload();
    },
    [reload],
  );

  const onAdd = useCallback(
    async (input: NewTask) => {
      await api.addTask(input);
      await reload();
    },
    [reload],
  );

  const onResolve = useCallback(
    async (key: string, choice: 'local' | 'remote') => {
      await api.resolve(key, choice);
      await reload();
    },
    [reload],
  );

  const onDelete = useCallback(
    async (task: TaskDTO) => {
      if (!task.id) return;
      await api.deleteTask(task.id);
      await reload();
    },
    [reload],
  );

  const onEditTitle = useCallback(
    async (task: TaskDTO, title: string) => {
      if (!task.id) return;
      await api.updateTask(task.id, { title });
      await reload();
    },
    [reload],
  );

  return (
    <div class="app">
      <header class="topbar">
        <h1>todomd</h1>
        <SyncBar status={status} syncing={syncing} lastSync={lastSync} onSync={doSync} />
      </header>
      {error && (
        <div class="error" role="alert">
          ⚠ {error}
        </div>
      )}
      {conflicts.length > 0 && <ConflictPanel conflicts={conflicts} onResolve={onResolve} />}
      <QuickAdd onAdd={onAdd} />
      <AddTaskForm onAdd={onAdd} />
      <TaskList
        sections={groupBySection(tasks)}
        onToggle={onToggle}
        onDelete={onDelete}
        onEditTitle={onEditTitle}
      />
    </div>
  );
}

function SyncBar(props: {
  status: StatusDTO | null;
  syncing: boolean;
  lastSync: string | null;
  onSync: () => void;
}) {
  const { status, syncing, lastSync, onSync } = props;
  const label = !status ? '…' : status.conflicts > 0 ? '충돌' : '동기화됨';
  const tone = !status ? '' : status.conflicts > 0 ? 'badge-warn' : 'badge-ok';
  return (
    <div class="syncbar">
      <span class={`badge ${tone}`}>{label}</span>
      {status && (
        <span class="muted">
          {status.done}/{status.tasks} 완료
        </span>
      )}
      {lastSync && <span class="muted">{lastSync}</span>}
      <button onClick={onSync} disabled={syncing}>
        {syncing ? '동기화 중…' : '동기화'}
      </button>
    </div>
  );
}

function ConflictPanel(props: {
  conflicts: ConflictDTO[];
  onResolve: (key: string, choice: 'local' | 'remote') => void;
}) {
  return (
    <div class="conflicts">
      <h2>충돌 {props.conflicts.length}건 — 어느 쪽을 둘까요?</h2>
      {props.conflicts.map((c) => (
        <div class="conflict" key={c.key}>
          <div class="conflict-cols">
            <ConflictSide label="이 기기" task={c.local} onPick={() => props.onResolve(c.key, 'local')} />
            <ConflictSide label="캘린더" task={c.remote} onPick={() => props.onResolve(c.key, 'remote')} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConflictSide(props: { label: string; task: TaskDTO | null; onPick: () => void }) {
  const { label, task, onPick } = props;
  return (
    <div class="conflict-side">
      <div class="conflict-label">{label}</div>
      <div class="conflict-title">{task ? task.title : '(삭제됨)'}</div>
      {task?.due && <div class="muted">{formatDue(task.due)}</div>}
      <button onClick={onPick}>이쪽 선택</button>
    </div>
  );
}

function QuickAdd(props: { onAdd: (input: NewTask) => Promise<void> }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [busy, setBusy] = useState(false);

  const doParse = async (e: Event) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      setPreview((await api.parse(text.trim())).preview);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await props.onAdd(previewToInput(preview));
      setText('');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="quickadd">
      <form class="addform" onSubmit={doParse}>
        <input
          class="grow"
          placeholder="빠른 추가 — 예) 내일 오후 3시 회의 #업무"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
        <button type="submit" disabled={busy}>
          해석
        </button>
      </form>
      {preview && (
        <div class={`preview ${preview.confident ? '' : 'preview-warn'}`}>
          <div class="preview-row">
            <strong>{preview.title || '(제목 없음)'}</strong>
            <span class={`pill ${preview.component === 'VEVENT' ? 'pill-event' : 'pill-todo'}`}>
              {preview.component === 'VEVENT' ? '일정' : '할일'}
            </span>
          </div>
          <div class="preview-meta">
            {preview.due && <span class="badge badge-date">{formatDue(preview.due)}</span>}
            {preview.recurrence && <span class="badge badge-rec">반복 {preview.recurrence}</span>}
            {preview.tags.map((t) => (
              <span class="badge" key={t}>
                {t}
              </span>
            ))}
          </div>
          {!preview.confident && (
            <div class="preview-hint">⚠ 해석이 불확실합니다 — 확인 후 추가하세요. {preview.warnings.join(', ')}</div>
          )}
          <div class="preview-actions">
            <button onClick={confirm} disabled={busy}>
              이대로 추가
            </button>
            <button onClick={() => setPreview(null)}>취소</button>
          </div>
        </div>
      )}
    </div>
  );
}

function previewToInput(p: ParsePreview): NewTask {
  const input: NewTask = {
    title: p.title,
    section: p.due ? p.due.slice(0, 10) : '기타',
    tags: p.tags,
    component: p.component,
  };
  if (p.due) input.due = p.due;
  if (p.dueHasTime) input.dueHasTime = true;
  if (p.recurrence) input.recurrence = p.recurrence;
  return input;
}

function AddTaskForm(props: { onAdd: (input: NewTask) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'todo' | 'event-allday' | 'event-timed'>('todo');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await props.onAdd(buildInput(title.trim(), type, date, time));
      setTitle('');
      setDate('');
      setTime('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="addform structured" onSubmit={submit}>
      <input
        class="grow"
        placeholder="새 할 일 / 일정"
        value={title}
        onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
      />
      <select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as typeof type)}>
        <option value="todo">할 일</option>
        <option value="event-allday">종일 일정</option>
        <option value="event-timed">시간 약속</option>
      </select>
      <input type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
      {type === 'event-timed' && (
        <input type="time" value={time} onInput={(e) => setTime((e.target as HTMLInputElement).value)} />
      )}
      <button type="submit" disabled={busy}>
        추가
      </button>
    </form>
  );
}

interface RowHandlers {
  onToggle: (task: TaskDTO) => void;
  onDelete: (task: TaskDTO) => void;
  onEditTitle: (task: TaskDTO, title: string) => void;
}

function TaskList(props: { sections: Array<[string | null, TaskDTO[]]> } & RowHandlers) {
  if (props.sections.length === 0) {
    return <p class="empty">할 일이 없습니다. 위에서 추가해 보세요.</p>;
  }
  return (
    <div class="tasklist">
      {props.sections.map(([title, items]) => (
        <section key={title ?? '__none'}>
          <h2>{title ?? '기타'}</h2>
          <ul>
            {items.map((t) => (
              <TaskRow
                key={t.id ?? t.title}
                task={t}
                onToggle={props.onToggle}
                onDelete={props.onDelete}
                onEditTitle={props.onEditTitle}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TaskRow(props: { task: TaskDTO } & RowHandlers) {
  const { task } = props;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);

  useEffect(() => {
    if (!editing) setTitle(task.title);
  }, [task.title, editing]);

  const save = () => {
    setEditing(false);
    const next = title.trim();
    if (next && next !== task.title) props.onEditTitle(task, next);
    else setTitle(task.title);
  };

  return (
    <li class={`task ${task.done ? 'is-done' : ''}`}>
      <input type="checkbox" checked={task.done} onChange={() => props.onToggle(task)} />
      {editing ? (
        <input
          class="title-edit"
          value={title}
          autoFocus
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              setTitle(task.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span class="title" title="클릭하여 편집" onClick={() => setEditing(true)}>
          {task.title}
        </span>
      )}
      {task.due && <span class="badge badge-date">{formatDue(task.due)}</span>}
      {task.priority && <span class="badge badge-prio">{priorityLabel(task.priority)}</span>}
      {task.recurrence && <span class="badge badge-rec">반복 {task.recurrence}</span>}
      <span class={`pill ${task.component === 'VEVENT' ? 'pill-event' : 'pill-todo'}`}>
        {task.component === 'VEVENT' ? '일정' : '할일'}
      </span>
      <button class="del" title="삭제" onClick={() => props.onDelete(task)}>
        ✕
      </button>
    </li>
  );
}

// --- helpers ---------------------------------------------------------------

function buildInput(
  title: string,
  type: 'todo' | 'event-allday' | 'event-timed',
  date: string,
  time: string,
): NewTask {
  const section = date || '기타';
  if (type === 'todo') {
    return date ? { title, due: date, section } : { title, section };
  }
  if (type === 'event-timed' && date && time) {
    return { title, due: `${date}T${time}`, dueHasTime: true, section, tags: ['#event'], component: 'VEVENT' };
  }
  return { title, ...(date ? { due: date } : {}), section, tags: ['#event'], component: 'VEVENT' };
}

function groupBySection(tasks: TaskDTO[]): Array<[string | null, TaskDTO[]]> {
  const map = new Map<string | null, TaskDTO[]>();
  for (const t of tasks) {
    const list = map.get(t.section) ?? [];
    list.push(t);
    map.set(t.section, list);
  }
  return [...map.entries()].sort((a, b) => String(a[0] ?? '~').localeCompare(String(b[0] ?? '~')));
}

function formatDue(due: string): string {
  return due.includes('T') ? due.replace('T', ' ') : due;
}

function priorityLabel(p: string): string {
  const labels: Record<string, string> = {
    highest: '최우선',
    high: '높음',
    medium: '보통',
    low: '낮음',
    lowest: '최저',
  };
  return labels[p] ?? p;
}

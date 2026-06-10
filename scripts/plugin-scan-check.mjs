// Faithful check of the Obsidian plugin's scan logic (same regexes as
// packages/obsidian-plugin/src/main.ts) without needing a running Obsidian.
const DATE_EMOJI = /[\u{1F4C5}\u{23F3}\u{1F6EB}]/u; // 📅 ⏳ 🛫
const TASK_LINE = /^\s*[-*]\s+\[[ xX]\]\s+/;
const TRAILING_ID = /\^([0-9a-z]{6})\s*$/;

let counter = 0;
function genId(used) {
  for (let i = 0; i < 1000; i++) {
    const id = ('z' + (counter++).toString(36)).padEnd(6, '0').slice(0, 6);
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  return 'zzzzzz';
}

const note = [
  '# Daily 2026-06-10',
  '',
  '- [ ] 치과 예약 📅 2026-06-20 14:00',
  '- [x] 회의록 정리 ⏳ 2026-06-18 ^abc123',
  '- [ ] 그냥 할일 #메모',
  '- [ ] 워크숍 🛫 2026-06-15 📅 2026-06-15 🔁 every year',
  '일반 문장에 📅 2026-06-20 이 들어가도 무시',
  '  - [ ] 들여쓴 하위 일정 📅 2026-06-21',
  '* [ ] 별표 불릿 일정 📅 2026-06-22',
].join('\n');

const used = new Set();
for (const line of note.split('\n')) {
  if (TASK_LINE.test(line)) {
    const m = TRAILING_ID.exec(line);
    if (m) used.add(m[1]);
  }
}

const lines = note.split('\n');
const tasks = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!TASK_LINE.test(line) || !DATE_EMOJI.test(line)) continue;
  const m = TRAILING_ID.exec(line);
  let id;
  if (m) {
    id = m[1];
  } else {
    id = genId(used);
    lines[i] = line.replace(/\s+$/, '') + ' ^' + id;
  }
  tasks.push({ id, raw: lines[i].trim() });
}

console.log('=== detected dated tasks ===');
for (const t of tasks) console.log(`  ^${t.id}  ${t.raw}`);
console.log(`\n총 ${tasks.length}개 감지 (기대: 5 — 그냥할일/일반문장 제외)`);
console.log('\n=== stamped note (ids written back) ===');
console.log(lines.join('\n'));

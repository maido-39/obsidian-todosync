// Raw quality/latency probe for a local LLM (Ollama) on Korean quick-add text.
// Usage: OLLAMA=http://ollama:11434 node scripts/llm-test.mjs <model>
const OLLAMA = process.env.OLLAMA ?? 'http://ollama:11434';
const model = process.argv[2] ?? 'exaone3.5:2.4b';
const today = '2026-06-09'; // Tuesday

// Production design: the LLM extracts language only; OUR code computes dates.
const system =
  `너는 한국어 할 일/일정 문장에서 정보를 뽑아 JSON으로만 출력하는 추출기다. 설명/여는말 금지.\n` +
  `출력 형식: {"title": string, "datePhrase": string|null, "time": "HH:MM"|null, "recurrence": string|null, "tags": string[]}\n` +
  `규칙:\n` +
  `- title: 입력의 핵심만. 단어를 추가/부풀리지 마라. ("회사 동료와의 저녁 약속" X → "약속" O)\n` +
  `- datePhrase: 날짜를 가리키는 표현을 입력에 나온 그대로 넣어라. 절대 날짜를 직접 계산하지 마라. ` +
  `(예: "이번 주 주말", "다음 달 초", "금요일까지", "내일", "3일 뒤", "월말") 없으면 null.\n` +
  `- time: 시계 시각이 있으면 24시간제 HH:MM. "저녁 7시"→"19:00". 없으면 null.\n` +
  `- recurrence: 반복이면 영어. "매주 수요일"→"every wednesday", "평일"→"every weekday". 없으면 null.\n` +
  `- tags: 입력에 #…또는 @…로 적힌 것만 그대로. 없으면 []. 새 태그를 지어내지 마라.`;

const samples = [
  '이번 주 주말 HP 프로젝트',
  '다음 달 초 세금 신고',
  '내일 저녁 7시 약속 #회사',
  '3일 뒤 점심 약속',
  '매주 수요일 오전 10시 팀 회의',
  '금요일까지 보고서 초안 @지민',
  '담주 화욜 저녁에 영화 보기',
  '월말까지 정산 마무리',
];

async function run(text) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
    }),
  });
  const data = await res.json();
  const ms = Date.now() - t0;
  let out = data?.message?.content;
  try {
    out = JSON.stringify(JSON.parse(out));
  } catch {
    /* keep raw */
  }
  console.log(`[${String(ms).padStart(6)}ms] ${text}`);
  console.log(`           → ${out}`);
}

console.log(`model: ${model}\n`);
for (const s of samples) await run(s);

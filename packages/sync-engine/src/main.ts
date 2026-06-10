import { createApp, type EngineConfig } from './server.js';

/** Container entry point — configured entirely from the environment. */
const config: EngineConfig = {
  markdownPath: process.env.TODOMD_MD ?? '/work/.data/todo.md',
  statePath: process.env.TODOMD_STATE ?? '/work/.data/.todomd/state.json',
  calendarPath: process.env.CALENDAR_PATH ?? '/user/calendars/personal/',
  caldav: {
    baseUrl: process.env.CALDAV_URL ?? 'http://xandikos:8000',
    ...(process.env.CALDAV_USER ? { username: process.env.CALDAV_USER } : {}),
    ...(process.env.CALDAV_PASS ? { password: process.env.CALDAV_PASS } : {}),
  },
  ical: { timezone: process.env.TODOMD_TZ ?? 'UTC' },
  ...(process.env.TODOMD_TOKEN ? { token: process.env.TODOMD_TOKEN } : {}),
  ...(process.env.TODOMD_GIT === '1' ? { git: true } : {}),
  ...(process.env.TODOMD_LLM === '1'
    ? {
        llm: {
          url: process.env.OLLAMA_URL ?? 'http://ollama:11434',
          model: process.env.OLLAMA_MODEL ?? 'exaone3.5:2.4b',
        },
      }
    : {}),
};

const port = Number(process.env.PORT ?? 8787);
createApp(config).listen(port, () => {
  console.log(`todomd sync-engine listening on :${port}`);
});

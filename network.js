const undici = require('undici');
const { Agent } = undici;

// 1. Создаем базовый "диспетчер" с ограничением соединений
const baseAgent = new Agent({
  connections: 8, // Качаем по 2 файла одновременно
  pipelining: 1,
  headersTimeout: 60_000,
  bodyTimeout: 120_000,
});

let finalDispatcher = baseAgent;

// 2. Пытаемся добавить повторные попытки, если версия undici это позволяет
try {
  // Способ 1: используем RetryAgent, если он есть (undici >= 6.7.0)
  if (typeof undici.RetryAgent === 'function') {
    finalDispatcher = new undici.RetryAgent(baseAgent, { maxRetries: 5 });
    console.log('[Network] Используется RetryAgent');
  } 
  // Способ 2: используем interceptors.retry, если он есть
  else if (undici.interceptors && typeof undici.interceptors.retry === 'function') {
    finalDispatcher = baseAgent.compose(
      undici.interceptors.retry({ maxRetries: 5 })
    );
    console.log('[Network] Используется interceptors.retry');
  } 
  // Способ 3: если ничего нет, остаемся на базовом агенте
  else {
    console.warn('[Network] Внимание: ваша версия undici не поддерживает авто-ретраи. Рекомендуется обновить undici (npm i undici@latest).');
  }
} catch (e) {
  console.warn('[Network] Не удалось включить авто-ретраи:', e.message);
}

// 3. Экспортируем в формате, который ожидает @xmcl/installer
const farcipalAgent = {
  dispatcher: finalDispatcher,
};

module.exports = { farcipalAgent };
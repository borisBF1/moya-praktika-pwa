// db.js — единственное место, где приложение разговаривает с IndexedDB.
// Хранилища: clients, events, tasks. Всё лежит на устройстве, сеть не нужна.
// Любая запись оповещает подписчиков — экраны перерисовываются сами.

const DB_NAME = 'practice_db';
const DB_VERSION = 1;

export const CLIENTS = 'clients';
export const EVENTS = 'events';
export const TASKS = 'tasks';

let dbInstance = null;
let openPromise = null;

/* ===================== Подключение ===================== */

export function openDb() {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (openPromise) return openPromise;

  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(CLIENTS)) {
        const clients = db.createObjectStore(CLIENTS, { keyPath: 'id', autoIncrement: true });
        clients.createIndex('name', 'name', { unique: false });
      }

      if (!db.objectStoreNames.contains(EVENTS)) {
        const events = db.createObjectStore(EVENTS, { keyPath: 'id', autoIncrement: true });
        events.createIndex('date', 'date', { unique: false });
        events.createIndex('clientId', 'clientId', { unique: false });
        events.createIndex('seriesId', 'seriesId', { unique: false });
        events.createIndex('status', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains(TASKS)) {
        const tasks = db.createObjectStore(TASKS, { keyPath: 'id', autoIncrement: true });
        tasks.createIndex('status', 'status', { unique: false });
        tasks.createIndex('dueDate', 'dueDate', { unique: false });
        tasks.createIndex('clientId', 'clientId', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };
    request.onerror = () => reject(request.error);
  });

  return openPromise;
}

/* ===================== Низкий уровень ===================== */

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Выполнить работу в одной транзакции: fn(store) -> Promise. */
async function tx(storeNames, mode, fn) {
  const db = await openDb();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const transaction = db.transaction(names, mode);
  const stores = names.map((n) => transaction.objectStore(n));
  const result = await fn(...stores);

  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

  return result;
}

/* ===================== Подписка на изменения ===================== */

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(storeName) {
  listeners.forEach((fn) => {
    try {
      fn(storeName);
    } catch (err) {
      console.error('Ошибка в подписчике на изменения данных', err);
    }
  });
}

/* ===================== Общий CRUD ===================== */

export function getAll(storeName) {
  return tx(storeName, 'readonly', (store) => done(store.getAll()));
}

export function getById(storeName, id) {
  return tx(storeName, 'readonly', (store) => done(store.get(Number(id))));
}

export async function add(storeName, data) {
  const id = await tx(storeName, 'readwrite', (store) =>
    done(store.add({ createdAt: new Date().toISOString(), ...data })));
  notify(storeName);
  return id;
}

/** Добавить пачку записей одной транзакцией (используется повторами занятий). */
export async function addMany(storeName, items) {
  const ids = await tx(storeName, 'readwrite', async (store) => {
    const created = new Date().toISOString();
    const result = [];
    for (const item of items) {
      result.push(await done(store.add({ createdAt: created, ...item })));
    }
    return result;
  });
  notify(storeName);
  return ids;
}

/** Частичное обновление: читаем запись, накладываем patch, сохраняем. */
export async function update(storeName, id, patch) {
  const key = Number(id);
  await tx(storeName, 'readwrite', async (store) => {
    const existing = await done(store.get(key));
    if (!existing) return;
    await done(store.put({ ...existing, ...patch, id: key }));
  });
  notify(storeName);
}

/** Тот же patch сразу для нескольких записей — одна транзакция. */
export async function updateMany(storeName, ids, patch) {
  if (!ids.length) return;
  await tx(storeName, 'readwrite', async (store) => {
    for (const id of ids) {
      const existing = await done(store.get(Number(id)));
      if (!existing) continue;
      await done(store.put({ ...existing, ...patch, id: Number(id) }));
    }
  });
  notify(storeName);
}

export async function remove(storeName, id) {
  await tx(storeName, 'readwrite', (store) => done(store.delete(Number(id))));
  notify(storeName);
}

export async function removeMany(storeName, ids) {
  if (!ids.length) return;
  await tx(storeName, 'readwrite', async (store) => {
    for (const id of ids) await done(store.delete(Number(id)));
  });
  notify(storeName);
}

/* ===================== Запросы по индексам ===================== */

/** Занятия за период включительно: '2026-08-01' … '2026-08-31'. */
export function eventsInRange(fromIso, toIso) {
  return tx(EVENTS, 'readonly', (store) =>
    done(store.index('date').getAll(IDBKeyRange.bound(fromIso, toIso))));
}

export function eventsOnDate(iso) {
  return tx(EVENTS, 'readonly', (store) => done(store.index('date').getAll(iso)));
}

export function eventsByClient(clientId) {
  return tx(EVENTS, 'readonly', (store) =>
    done(store.index('clientId').getAll(Number(clientId))));
}

export function eventsBySeries(seriesId) {
  return tx(EVENTS, 'readonly', (store) => done(store.index('seriesId').getAll(seriesId)));
}

export function tasksByClient(clientId) {
  return tx(TASKS, 'readonly', (store) =>
    done(store.index('clientId').getAll(Number(clientId))));
}

/* ===================== Клиенты: удобные обёртки ===================== */

/** Map id -> клиент, чтобы подставлять имена в списки занятий и задач. */
export async function clientsMap() {
  const clients = await getAll(CLIENTS);
  return new Map(clients.map((c) => [c.id, c]));
}

/* ===================== Резервная копия ===================== */

/**
 * Версия формата копии. Растёт, когда меняется состав полей.
 * 1 — первый релиз.
 * 2 — у клиента появился цвет метки (color).
 */
export const SCHEMA_VERSION = 2;

export async function exportAll() {
  const [clients, events, tasks] = await Promise.all([
    getAll(CLIENTS), getAll(EVENTS), getAll(TASKS),
  ]);
  return {
    app: 'moya-praktika',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    clients, events, tasks,
  };
}

/** Что лежит в файле — чтобы спросить пользователя до восстановления. */
export function inspectBackup(data) {
  const version = Number(data && data.version) || 1;
  return {
    version,
    newer: version > SCHEMA_VERSION,
    clients: Array.isArray(data.clients) ? data.clients.length : 0,
    events: Array.isArray(data.events) ? data.events.length : 0,
    tasks: Array.isArray(data.tasks) ? data.tasks.length : 0,
  };
}

/**
 * Копия старой версии приводится к текущей схеме — шаг за шагом.
 * Копия из будущей версии заливается как есть: незнакомые поля просто
 * лежат в записи и никому не мешают.
 */
function migrateBackup(data) {
  const version = Number(data.version) || 1;
  let clients = Array.isArray(data.clients) ? data.clients : [];
  const events = Array.isArray(data.events) ? data.events : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];

  // 1 -> 2: цвет метки клиента
  if (version < 2) {
    clients = clients.map((client) => ({ color: null, ...client }));
  }

  return { clients, events, tasks };
}

/**
 * Восстановление из копии: текущее содержимое заменяется целиком,
 * id сохраняются — значит связи занятий и задач с клиентами не рвутся.
 */
export async function importAll(data) {
  const { clients, events, tasks } = migrateBackup(data);

  await tx([CLIENTS, EVENTS, TASKS], 'readwrite', async (clientStore, eventStore, taskStore) => {
    await done(clientStore.clear());
    await done(eventStore.clear());
    await done(taskStore.clear());
    for (const client of clients) await done(clientStore.put(client));
    for (const event of events) await done(eventStore.put(event));
    for (const task of tasks) await done(taskStore.put(task));
  });

  notify(CLIENTS);
  notify(EVENTS);
  notify(TASKS);
}

export async function countAll() {
  const [clients, events, tasks] = await Promise.all([
    tx(CLIENTS, 'readonly', (s) => done(s.count())),
    tx(EVENTS, 'readonly', (s) => done(s.count())),
    tx(TASKS, 'readonly', (s) => done(s.count())),
  ]);
  return { clients, events, tasks };
}

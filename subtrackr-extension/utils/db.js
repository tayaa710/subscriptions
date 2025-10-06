// utils/db.js
// Lightweight IndexedDB helper tailored for SubTrackr's simple subscription records.

const DB_NAME = 'subtrackrDB';
const STORE_NAME = 'subscriptions';
const DB_VERSION = 1;

/**
 * Opens an IndexedDB connection, creating the subscriptions store if required.
 * @returns {Promise<IDBDatabase>} Resolves with an open database instance.
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Create the object store on initial setup or schema upgrades.
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves a subscription record, overwriting the same id if it already exists.
 * @param {{ id: string, serviceName: string, detectedText: string, timestamp: string }} record
 */
export async function saveSubscription(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(record);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Retrieves every stored subscription record in insertion order.
 * @returns {Promise<Array>}
 */
export async function getSubscriptions() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Removes all saved subscription records, giving users full control.
 */
export async function clearAll() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

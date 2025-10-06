// popup.js
// Handles UI interactions for reviewing detections and managing saved subscriptions.

import { getSubscriptions, clearAll } from './utils/db.js';

const detectionPanel = document.getElementById('detection-panel');
const detectionMessage = document.getElementById('detection-message');
const saveDetectionButton = document.getElementById('save-detection');
const ignoreDetectionButton = document.getElementById('ignore-detection');
const statusBanner = document.getElementById('status');
const viewSavedButton = document.getElementById('view-saved');
const savedListSection = document.getElementById('saved-list');
const recordsList = document.getElementById('records');
const clearAllButton = document.getElementById('clear-all');

let latestDetection = null;
let latestTabId = null;
let savedListVisible = false;

/**
 * Updates the status banner with a short-lived message.
 * @param {string} text
 */
function setStatus(text) {
  statusBanner.textContent = text;
  if (text) {
    window.setTimeout(() => {
      statusBanner.textContent = '';
    }, 2200);
  }
}

/**
 * Requests the most recent detection for the active tab from the background worker.
 */
async function refreshDetection() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-latest-detection' });
    latestDetection = response?.detection ?? null;
    latestTabId = response?.tabId ?? null;

    if (latestDetection) {
      detectionMessage.textContent = `Detected possible subscription on ${latestDetection.serviceName}. Save this subscription?`;
      detectionPanel.hidden = false;
    } else {
      detectionPanel.hidden = true;
      detectionMessage.textContent = '';
    }
  } catch (error) {
    console.error('SubTrackr popup detection error:', error);
    setStatus('Unable to load detection.');
  }
}

/**
 * Fetches stored subscriptions and renders them in the list.
 */
async function renderSavedSubscriptions() {
  try {
    const subscriptions = await getSubscriptions();
    recordsList.innerHTML = '';

    if (!subscriptions.length) {
      const emptyItem = document.createElement('li');
      emptyItem.textContent = 'No subscriptions saved yet.';
      recordsList.appendChild(emptyItem);
      return;
    }

    subscriptions
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .forEach((record) => {
        const item = document.createElement('li');
        const title = document.createElement('span');
        title.textContent = `${record.serviceName} — ${record.detectedText}`;

        const time = document.createElement('span');
        time.className = 'timestamp';
        time.textContent = new Date(record.timestamp).toLocaleString();

        item.appendChild(title);
        item.appendChild(time);
        recordsList.appendChild(item);
      });
  } catch (error) {
    console.error('SubTrackr popup render error:', error);
    setStatus('Unable to load saved subscriptions.');
  }
}

saveDetectionButton.addEventListener('click', async () => {
  if (!latestDetection || latestTabId === null) return;
  try {
    await chrome.runtime.sendMessage({
      type: 'save-subscription',
      record: latestDetection,
      tabId: latestTabId,
    });
    setStatus('Subscription saved.');
    latestDetection = null;
    detectionPanel.hidden = true;
    if (savedListVisible) {
      await renderSavedSubscriptions();
    }
  } catch (error) {
    console.error('SubTrackr save error:', error);
    setStatus('Save failed.');
  }
});

ignoreDetectionButton.addEventListener('click', async () => {
  if (!latestDetection || latestTabId === null) return;
  try {
    await chrome.runtime.sendMessage({ type: 'clear-pending', tabId: latestTabId });
    latestDetection = null;
    detectionPanel.hidden = true;
    setStatus('Detection ignored.');
  } catch (error) {
    console.error('SubTrackr ignore error:', error);
    setStatus('Unable to ignore detection.');
  }
});

viewSavedButton.addEventListener('click', async () => {
  savedListVisible = !savedListVisible;
  savedListSection.hidden = !savedListVisible;
  viewSavedButton.textContent = savedListVisible ? 'Hide Saved' : 'View Saved';

  if (savedListVisible) {
    await renderSavedSubscriptions();
  }
});

clearAllButton.addEventListener('click', async () => {
  try {
    await clearAll();
    await renderSavedSubscriptions();
    setStatus('All subscriptions deleted.');
  } catch (error) {
    console.error('SubTrackr clear error:', error);
    setStatus('Unable to delete records.');
  }
});

// Prime the popup with any pending detection as soon as it opens.
refreshDetection();

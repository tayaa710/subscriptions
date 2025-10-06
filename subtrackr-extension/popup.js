// popup.js
// Redesigned popup controller powering the SubTrackr UI components.

import { getSubscriptions, clearAll } from './utils/db.js';

const htmlElement = document.documentElement;
const tabDomainElement = document.getElementById('tab-domain');
const tabPathElement = document.getElementById('tab-path');
const tabFaviconElement = document.getElementById('tab-favicon');

const detectionCard = document.getElementById('detection-card');
const detectionKeywordBadge = document.getElementById('detection-keyword');
const detectionServiceLabel = document.getElementById('detection-service');
const saveDetectionButton = document.getElementById('save-detection');
const ignoreDetectionButton = document.getElementById('ignore-detection');

const savedContainer = document.getElementById('saved-scroll');
const savedCountLabel = document.getElementById('saved-count');
const savedEmptyMessage = document.getElementById('saved-empty');

const clearAllButton = document.getElementById('clear-all');
const openSettingsButton = document.getElementById('open-settings');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsButton = document.getElementById('close-settings');
const themeToggle = document.getElementById('theme-toggle');
const notificationsToggle = document.getElementById('notifications-toggle');
const sensitivitySlider = document.getElementById('keyword-sensitivity');

const DEFAULT_PREFERENCES = {
  notificationsEnabled: true,
  theme: 'light',
  keywordSensitivity: 3,
};

let latestDetection = null;
let latestTabId = null;
let cachedPreferences = { ...DEFAULT_PREFERENCES };

/* -------------------------------------------- */
/* Helpers                                      */
/* -------------------------------------------- */
function getOriginFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    return {
      domain: url.hostname,
      path: url.pathname === '/' ? url.pathname : `${url.pathname}`,
    };
  } catch (error) {
    return { domain: 'Unknown site', path: '' };
  }
}

function updateDetectionCard(detection) {
  if (detection) {
    detectionServiceLabel.textContent = detection.serviceName ?? 'Unknown service';
    detectionKeywordBadge.textContent = `keyword: "${detection.detectedText ?? 'subscription'}"`;
    detectionCard.hidden = false;
    detectionCard.dataset.visible = 'true';
  } else {
    detectionCard.hidden = true;
    detectionCard.dataset.visible = 'false';
  }
}

function toggleSampleEntries(show) {
  savedContainer.querySelectorAll('[data-sample="true"]').forEach((sample) => {
    sample.hidden = !show;
  });
}

function clearSampleEntries() {
  const samples = savedContainer.querySelectorAll('[data-sample="true"]');
  samples.forEach((sample) => sample.remove());
}

function applyPreferences(preferences) {
  cachedPreferences = { ...cachedPreferences, ...preferences };

  notificationsToggle.checked = cachedPreferences.notificationsEnabled;
  themeToggle.checked = cachedPreferences.theme === 'dark';
  sensitivitySlider.value = `${cachedPreferences.keywordSensitivity}`;

  htmlElement.dataset.theme = cachedPreferences.theme;
}

async function persistPreferences() {
  try {
    await chrome.storage?.local.set({ preferences: cachedPreferences });
  } catch (error) {
    console.warn('SubTrackr preferences could not be saved:', error);
  }
}

function openModal() {
  settingsModal.hidden = false;
  settingsModal.setAttribute('data-open', 'true');
}

function closeModal() {
  settingsModal.hidden = true;
  settingsModal.removeAttribute('data-open');
}

function renderSavedCount(total) {
  savedCountLabel.textContent = total === 1 ? '1 tracked' : `${total} tracked`;
}

function renderEmptyState(show) {
  savedEmptyMessage.hidden = !show;
}

function createSavedArticle(record) {
  const item = document.createElement('article');
  item.className = 'saved-item';

  const header = document.createElement('div');
  header.className = 'saved-item__header';

  const title = document.createElement('h3');
  title.className = 'saved-item__title';
  title.textContent = record.serviceName ?? 'Unknown service';

  const time = document.createElement('time');
  time.className = 'saved-item__time';
  if (record.timestamp) {
    const timestamp = new Date(record.timestamp);
    time.textContent = timestamp.toLocaleString();
    time.dateTime = timestamp.toISOString();
  }

  header.appendChild(title);
  header.appendChild(time);

  const detail = document.createElement('p');
  detail.className = 'saved-item__detail';
  detail.textContent = `Keyword match: "${record.detectedText ?? 'subscription'}"`;

  item.appendChild(header);
  item.appendChild(detail);

  return item;
}

async function loadPreferences() {
  try {
    const stored = await chrome.storage?.local.get('preferences');
    const preferences = stored?.preferences
      ? { ...DEFAULT_PREFERENCES, ...stored.preferences }
      : { ...DEFAULT_PREFERENCES };
    applyPreferences(preferences);
  } catch (error) {
    console.warn('SubTrackr preferences could not be loaded:', error);
    applyPreferences(DEFAULT_PREFERENCES);
  }
}

async function renderSavedSubscriptions() {
  try {
    const subscriptions = await getSubscriptions();

    // Remove existing dynamic entries.
    savedContainer.querySelectorAll('.saved-item:not([data-sample="true"])').forEach((item) => {
      item.remove();
    });

    toggleSampleEntries(false);

    if (subscriptions.length) {
      clearSampleEntries();
      renderEmptyState(false);

      const fragment = document.createDocumentFragment();
      subscriptions
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .forEach((record) => {
          fragment.appendChild(createSavedArticle(record));
        });

      savedContainer.appendChild(fragment);
      renderSavedCount(subscriptions.length);
    } else {
      renderSavedCount(0);
      renderEmptyState(true);
    }
  } catch (error) {
    console.error('SubTrackr popup render error:', error);
    renderEmptyState(true);
  }
}

/* -------------------------------------------- */
/* Chrome messaging                             */
/* -------------------------------------------- */
async function refreshDetection() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-latest-detection' });
    latestDetection = response?.detection ?? null;
    latestTabId = response?.tabId ?? null;
    updateDetectionCard(latestDetection);
  } catch (error) {
    console.error('SubTrackr popup detection error:', error);
    updateDetectionCard(null);
  }
}

async function renderCurrentTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const { domain, path } = getOriginFromUrl(tab.url ?? '');
    tabDomainElement.textContent = domain;
    tabPathElement.textContent = path;

    if (tab.favIconUrl) {
      tabFaviconElement.src = tab.favIconUrl;
    }
  } catch (error) {
    console.warn('SubTrackr could not determine current tab:', error);
  }
}

/* -------------------------------------------- */
/* Event bindings                               */
/* -------------------------------------------- */
saveDetectionButton.addEventListener('click', async () => {
  if (!latestDetection || latestTabId === null) return;
  try {
    await chrome.runtime.sendMessage({
      type: 'save-subscription',
      record: latestDetection,
      tabId: latestTabId,
    });
    latestDetection = null;
    updateDetectionCard(null);
    await renderSavedSubscriptions();
  } catch (error) {
    console.error('SubTrackr save error:', error);
  }
});

ignoreDetectionButton.addEventListener('click', async () => {
  if (!latestDetection || latestTabId === null) return;
  try {
    await chrome.runtime.sendMessage({ type: 'clear-pending', tabId: latestTabId });
    latestDetection = null;
    updateDetectionCard(null);
  } catch (error) {
    console.error('SubTrackr ignore error:', error);
  }
});

clearAllButton.addEventListener('click', async () => {
  try {
    await clearAll();
    await renderSavedSubscriptions();
  } catch (error) {
    console.error('SubTrackr clear error:', error);
  }
});

openSettingsButton.addEventListener('click', () => {
  openModal();
});

closeSettingsButton.addEventListener('click', () => {
  closeModal();
});

settingsModal.addEventListener('click', (event) => {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset.closeModal !== undefined) {
    closeModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsModal.getAttribute('data-open') === 'true') {
    closeModal();
  }
});

notificationsToggle.addEventListener('change', () => {
  cachedPreferences.notificationsEnabled = notificationsToggle.checked;
  persistPreferences();
});

themeToggle.addEventListener('change', () => {
  cachedPreferences.theme = themeToggle.checked ? 'dark' : 'light';
  applyPreferences(cachedPreferences);
  persistPreferences();
});

sensitivitySlider.addEventListener('change', () => {
  cachedPreferences.keywordSensitivity = Number.parseInt(sensitivitySlider.value, 10);
  persistPreferences();
});

/* -------------------------------------------- */
/* Initialize                                   */
/* -------------------------------------------- */
loadPreferences();
refreshDetection();
renderSavedSubscriptions();
renderCurrentTabInfo();

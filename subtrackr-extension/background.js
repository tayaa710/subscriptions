// background.js (service worker)
// Coordinates messages between content scripts and the popup while persisting data locally.

import { saveSubscription } from './utils/db.js';

// Maintain per-tab detections so we can surface the latest prompt in the popup.
const pendingDetections = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Wrap logic in an async IIFE so we can await Chrome APIs cleanly.
  (async () => {
    switch (message.type) {
      case 'subscription-detected': {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ acknowledged: false });
          return;
        }

        const detection = {
          id: `${tabId}-${Date.now()}`,
          serviceName: message.payload.serviceName,
          detectedText: message.payload.detectedText,
          timestamp: message.payload.timestamp,
        };

        pendingDetections.set(tabId, detection);
        await chrome.storage.session.set({ [`tab-${tabId}`]: detection });

        // Ask the content script to show the banner prompt immediately.
        await chrome.tabs.sendMessage(tabId, {
          type: 'show-detection',
          detection,
        });

        sendResponse({ acknowledged: true });
        break;
      }
      case 'save-subscription': {
        const record = message.record;
        const tabId = sender.tab?.id ?? message.tabId ?? null;
        await saveSubscription(record);
        if (tabId !== null) {
          pendingDetections.delete(tabId);
          await chrome.storage.session.remove(`tab-${tabId}`);
        }

        // Notify the sender tab that the save completed so the UI can update.
        if (tabId !== null) {
          await chrome.tabs.sendMessage(tabId, {
            type: 'subscription-saved',
            id: record.id,
          });
        }

        sendResponse({ saved: true });
        break;
      }
      case 'clear-pending': {
        const tabId = sender.tab?.id ?? message.tabId ?? null;
        if (tabId !== null) {
          pendingDetections.delete(tabId);
          await chrome.storage.session.remove(`tab-${tabId}`);
        }
        sendResponse({ cleared: true });
        break;
      }
      case 'get-latest-detection': {
        // Identify the active tab to surface any pending detection information.
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const tabId = activeTab?.id;
        let detection = tabId ? pendingDetections.get(tabId) : null;

        if (!detection && tabId) {
          const stored = await chrome.storage.session.get(`tab-${tabId}`);
          detection = stored[`tab-${tabId}`] || null;
        }

        sendResponse({ detection, tabId: tabId ?? null });
        break;
      }
      default: {
        sendResponse({ handled: false });
      }
    }
  })().catch((error) => {
    console.error('SubTrackr background error:', error);
    sendResponse({ error: error.message });
  });

  // Indicate that we will respond asynchronously once the async IIFE completes.
  return true;
});

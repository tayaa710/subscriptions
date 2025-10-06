// content.js
// Detects subscription-related interactions and surfaces an inline banner for user consent.

const KEYWORDS = [
  'subscribe',
  'subscription',
  'plan',
  'billing',
  'free trial',
  'manage subscription',
  'upgrade',
].map((keyword) => keyword.toLowerCase());

let bannerElement = null;
let currentDetection = null;
let successTimeoutId = null;

/**
 * Quickly checks whether the provided text contains any subscription keyword.
 * @param {string} text
 * @returns {boolean}
 */
function matchesKeywords(text) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * Safely extracts the visible text content from an element without touching inputs.
 * @param {Element} element
 */
function extractText(element) {
  if (!element) return '';
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || '';
  }
  return (element.textContent || '').trim();
}

/**
 * Sends a detection message to the background service worker.
 * @param {string} detectedText
 */
function reportDetection(detectedText) {
  const payload = {
    serviceName: window.location.hostname,
    detectedText,
    timestamp: new Date().toISOString(),
  };

  chrome.runtime.sendMessage({ type: 'subscription-detected', payload });
}

/**
 * Removes the banner and clears any timers.
 */
function dismissBanner() {
  if (bannerElement?.parentNode) {
    bannerElement.parentNode.removeChild(bannerElement);
  }
  bannerElement = null;
  currentDetection = null;
  if (successTimeoutId) {
    clearTimeout(successTimeoutId);
    successTimeoutId = null;
  }
}

/**
 * Builds (if necessary) and displays the floating consent banner.
 * @param {object} detection
 */
function showBanner(detection) {
  currentDetection = detection;

  if (!bannerElement) {
    bannerElement = document.createElement('div');
    bannerElement.id = 'subtrackr-banner';
    bannerElement.style.position = 'fixed';
    bannerElement.style.bottom = '20px';
    bannerElement.style.right = '20px';
    bannerElement.style.zIndex = '2147483647';
    bannerElement.style.background = '#1f2937';
    bannerElement.style.color = '#f9fafb';
    bannerElement.style.padding = '16px';
    bannerElement.style.borderRadius = '8px';
    bannerElement.style.boxShadow = '0 10px 30px rgba(15, 23, 42, 0.2)';
    bannerElement.style.maxWidth = '320px';
    bannerElement.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

    const message = document.createElement('div');
    message.id = 'subtrackr-message';
    message.style.marginBottom = '12px';
    bannerElement.appendChild(message);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.style.background = '#10b981';
    saveButton.style.color = '#f9fafb';
    saveButton.style.border = 'none';
    saveButton.style.padding = '8px 14px';
    saveButton.style.borderRadius = '6px';
    saveButton.style.cursor = 'pointer';
    saveButton.addEventListener('click', () => {
      if (!currentDetection) return;
      chrome.runtime.sendMessage({
        type: 'save-subscription',
        record: currentDetection,
      });
    });

    const ignoreButton = document.createElement('button');
    ignoreButton.textContent = 'Ignore';
    ignoreButton.style.background = 'transparent';
    ignoreButton.style.color = '#cbd5f5';
    ignoreButton.style.border = '1px solid #4b5563';
    ignoreButton.style.padding = '8px 14px';
    ignoreButton.style.borderRadius = '6px';
    ignoreButton.style.cursor = 'pointer';
    ignoreButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'clear-pending' });
      dismissBanner();
    });

    actions.appendChild(saveButton);
    actions.appendChild(ignoreButton);
    bannerElement.appendChild(actions);
  }

  const messageElement = bannerElement.querySelector('#subtrackr-message');
  if (messageElement) {
    messageElement.textContent = `Detected possible subscription on ${detection.serviceName}. Save this subscription?`;
  }

  if (!bannerElement.parentNode) {
    document.body.appendChild(bannerElement);
  }
}

/**
 * Evaluates clicks and submissions for subscription intent.
 * @param {Event} event
 */
function handleInteraction(event) {
  const target = event.target;
  const submitter = event.submitter;

  const candidateText = [extractText(submitter), extractText(target)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];

  if (matchesKeywords(candidateText)) {
    reportDetection(candidateText);
  }
}

document.addEventListener('click', handleInteraction, true);
document.addEventListener('submit', handleInteraction, true);

// Listen for instructions from the background worker to display or hide UI feedback.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'show-detection') {
    showBanner(message.detection);
  }

  if (message.type === 'subscription-saved') {
    if (bannerElement) {
      const messageElement = bannerElement.querySelector('#subtrackr-message');
      if (messageElement) {
        messageElement.textContent = 'Subscription saved locally.';
      }
      successTimeoutId = window.setTimeout(() => {
        dismissBanner();
      }, 1800);
    }
  }
});

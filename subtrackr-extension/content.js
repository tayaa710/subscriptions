// content.js
// Detects subscription-related interactions and renders a branded toast overlay.

const KEYWORDS = [
  'subscribe',
  'subscription',
  'plan',
  'billing',
  'free trial',
  'manage subscription',
  'upgrade',
].map((keyword) => keyword.toLowerCase());

const TOAST_STYLE_ID = 'subtrackr-toast-styles';
const AUTO_HIDE_MS = 10000;

let bannerElement = null;
let currentDetection = null;
let autoHideTimeoutId = null;
let successTimeoutId = null;

/* -------------------------------------------- */
/* Utility helpers                              */
/* -------------------------------------------- */
function matchesKeywords(text) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function extractText(element) {
  if (!element) return '';
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || '';
  }
  return (element.textContent || '').trim();
}

function reportDetection(detectedText) {
  const payload = {
    serviceName: window.location.hostname,
    detectedText,
    timestamp: new Date().toISOString(),
  };

  chrome.runtime.sendMessage({ type: 'subscription-detected', payload });
}

function insertToastStyles() {
  if (document.getElementById(TOAST_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TOAST_STYLE_ID;
  style.textContent = `
    @keyframes subtrackr-toast-in {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes subtrackr-toast-out {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(12px); }
    }
    #subtrackr-toast-banner {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483647;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 320px;
      width: 100%;
      background: #111827;
      color: #f9fafb;
      border-radius: 0.75rem;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.35);
      border: 1px solid rgba(148, 163, 184, 0.4);
      padding: 1rem 1.125rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      animation: subtrackr-toast-in 200ms ease forwards;
    }
    #subtrackr-toast-banner.subtrackr-toast-exit {
      animation: subtrackr-toast-out 200ms ease forwards;
    }
    #subtrackr-toast-banner .subtrackr-toast__header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: 600;
      font-size: 0.95rem;
    }
    #subtrackr-toast-banner .subtrackr-toast__icon {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.25);
    }
    #subtrackr-toast-banner .subtrackr-toast__message {
      font-size: 0.9rem;
      line-height: 1.4;
      margin: 0;
    }
    #subtrackr-toast-banner .subtrackr-toast__actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }
    #subtrackr-toast-banner button {
      border: none;
      border-radius: 0.5rem;
      padding: 0.45rem 0.95rem;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 150ms ease, color 150ms ease;
    }
    #subtrackr-toast-banner button.subtrackr-save {
      background: #2563eb;
      color: #f9fafb;
    }
    #subtrackr-toast-banner button.subtrackr-save:hover {
      background: #1d4ed8;
    }
    #subtrackr-toast-banner button.subtrackr-dismiss {
      background: rgba(255, 255, 255, 0.08);
      color: #f9fafb;
      border: 1px solid rgba(148, 163, 184, 0.35);
    }
    #subtrackr-toast-banner button.subtrackr-dismiss:hover {
      background: rgba(148, 163, 184, 0.2);
    }
    @media (prefers-reduced-motion: reduce) {
      #subtrackr-toast-banner {
        animation: none;
      }
      #subtrackr-toast-banner.subtrackr-toast-exit {
        animation: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function clearTimers() {
  if (autoHideTimeoutId) {
    window.clearTimeout(autoHideTimeoutId);
    autoHideTimeoutId = null;
  }
  if (successTimeoutId) {
    window.clearTimeout(successTimeoutId);
    successTimeoutId = null;
  }
}

function dismissBanner({ immediate = false } = {}) {
  if (!bannerElement) return;
  clearTimers();

  const remove = () => {
    if (bannerElement?.parentNode) {
      bannerElement.parentNode.removeChild(bannerElement);
    }
    bannerElement = null;
    currentDetection = null;
  };

  if (immediate) {
    remove();
    return;
  }

  bannerElement.classList.add('subtrackr-toast-exit');
  bannerElement.addEventListener(
    'animationend',
    () => {
      remove();
    },
    { once: true }
  );
}

function scheduleAutoHide() {
  clearTimers();
  autoHideTimeoutId = window.setTimeout(() => {
    dismissBanner();
  }, AUTO_HIDE_MS);
}

function showBanner(detection) {
  currentDetection = detection;
  insertToastStyles();

  if (!bannerElement) {
    bannerElement = document.createElement('div');
    bannerElement.id = 'subtrackr-toast-banner';

    const header = document.createElement('div');
    header.className = 'subtrackr-toast__header';

    const icon = document.createElement('span');
    icon.className = 'subtrackr-toast__icon';

    const title = document.createElement('span');
    title.textContent = 'SubTrackr';

    header.appendChild(icon);
    header.appendChild(title);

    const message = document.createElement('p');
    message.className = 'subtrackr-toast__message';
    message.id = 'subtrackr-toast-message';

    const actions = document.createElement('div');
    actions.className = 'subtrackr-toast__actions';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'subtrackr-save';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () => {
      if (!currentDetection) return;
      chrome.runtime.sendMessage({
        type: 'save-subscription',
        record: currentDetection,
      });
    });

    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'subtrackr-dismiss';
    dismissButton.textContent = 'Dismiss';
    dismissButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'clear-pending' });
      dismissBanner();
    });

    actions.appendChild(saveButton);
    actions.appendChild(dismissButton);

    bannerElement.appendChild(header);
    bannerElement.appendChild(message);
    bannerElement.appendChild(actions);
  }

  const messageElement = bannerElement.querySelector('#subtrackr-toast-message');
  if (messageElement) {
    messageElement.textContent = 'SubTrackr detected subscription on this page';
  }

  bannerElement.classList.remove('subtrackr-toast-exit');

  if (!bannerElement.parentNode) {
    (document.body || document.documentElement).appendChild(bannerElement);
  }

  scheduleAutoHide();
}

/* -------------------------------------------- */
/* Interaction listeners                        */
/* -------------------------------------------- */
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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'show-detection') {
    showBanner(message.detection);
  }

  if (message.type === 'subscription-saved') {
    if (bannerElement) {
      const messageElement = bannerElement.querySelector('#subtrackr-toast-message');
      if (messageElement) {
        messageElement.textContent = 'Subscription saved locally.';
      }
      clearTimers();
      successTimeoutId = window.setTimeout(() => {
        dismissBanner();
      }, 1800);
    }
  }
});

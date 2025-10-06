const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const template = document.getElementById('subscription-template');
const refreshBtn = document.getElementById('refresh');
const pendingSection = document.getElementById('pending');
const pendingTitle = document.getElementById('pending-title');
const pendingContext = document.getElementById('pending-context');
const pendingTrial = document.getElementById('pending-trial');
const pendingBilling = document.getElementById('pending-billing');
const pendingUrl = document.getElementById('pending-url');
const pendingSave = document.getElementById('pending-save');
const pendingDismiss = document.getElementById('pending-dismiss');

let currentPending = null;
let pendingInFlight = false;

async function fetchSubscriptions() {
  const data = await chrome.storage.local.get({ subscriptions: [] });
  return data.subscriptions.sort((a, b) => (b.detectedAt || '').localeCompare(a.detectedAt || ''));
}

async function fetchPendingDetection() {
  const data = await chrome.storage.local.get({ pendingDetection: null });
  return data.pendingDetection;
}

function formatTrial(trial) {
  if (!trial) {
    return '<span class="empty-value">Not detected</span>';
  }
  if (trial.durationText) {
    return trial.durationText;
  }
  if (trial.durationDays) {
    return `${trial.durationDays} day trial`;
  }
  return '<span class="empty-value">Not detected</span>';
}

function formatBilling(billing) {
  if (!billing) {
    return '<span class="empty-value">Not detected</span>';
  }
  if (billing.amount && billing.period) {
    return `${billing.amount} billed ${billing.period}`;
  }
  if (billing.amount) {
    return billing.amount;
  }
  if (billing.period) {
    return `Billed ${billing.period}`;
  }
  return '<span class="empty-value">Not detected</span>';
}

function formatReminder(timestamp) {
  if (!timestamp) {
    return '<span class="empty-value">Not scheduled</span>';
  }
  return new Date(timestamp).toLocaleString();
}

function formatUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return url;
  }
}

function renderPending(pending) {
  currentPending = pending;
  pendingInFlight = false;
  pendingSave.disabled = false;
  pendingDismiss.disabled = false;

  if (!pending) {
    pendingSection.hidden = true;
    return;
  }

  pendingSection.hidden = false;
  const host = formatUrl(pending.url);
  pendingTitle.textContent = pending.existingId
    ? 'Update saved subscription?'
    : 'Save this subscription?';
  pendingContext.textContent = pending.existingId
    ? `We spotted updated terms for ${host}.`
    : `We found a subscription on ${host}.`;
  pendingTrial.innerHTML = formatTrial(pending.trial);
  pendingBilling.innerHTML = formatBilling(pending.billing);
  pendingUrl.href = pending.url;
  pendingUrl.textContent = host || 'Open page';
}

async function resolvePending(decision) {
  if (!currentPending || pendingInFlight) {
    return;
  }

  pendingInFlight = true;
  pendingSave.disabled = true;
  pendingDismiss.disabled = true;

  try {
    await chrome.runtime.sendMessage({
      type: 'resolvePendingDetection',
      decision,
      token: currentPending.token
    });
  } catch (error) {
    console.debug('Subscription Sentinel: failed to resolve pending detection', error);
  }

  await load();
}

function renderSubscription(subscription) {
  const fragment = template.content.cloneNode(true);
  const root = fragment.querySelector('.subscription');
  root.dataset.id = subscription.id;
  fragment.querySelector('.name').textContent = subscription.name;
  fragment.querySelector('.trial-value').innerHTML = formatTrial(subscription.trial);
  fragment.querySelector('.billing-value').innerHTML = formatBilling(subscription.billing);
  fragment.querySelector('.reminder-value').innerHTML = formatReminder(subscription.nextReminderTime);
  const link = fragment.querySelector('.url');
  link.href = subscription.url;
  link.textContent = new URL(subscription.url).hostname;

  const removeBtn = fragment.querySelector('.remove');
  removeBtn.addEventListener('click', async () => {
    removeBtn.disabled = true;
    await chrome.runtime.sendMessage({ type: 'removeSubscription', id: subscription.id });
    await load();
  });

  listEl.appendChild(fragment);
}

async function load() {
  const [pending, subscriptions] = await Promise.all([
    fetchPendingDetection(),
    fetchSubscriptions()
  ]);

  renderPending(pending);
  listEl.innerHTML = '';
  if (!subscriptions.length) {
    emptyEl.style.display = pending ? 'none' : 'block';
    return;
  }
  emptyEl.style.display = 'none';
  subscriptions.forEach(renderSubscription);
}

refreshBtn.addEventListener('click', load);
pendingSave.addEventListener('click', () => resolvePending('save'));
pendingDismiss.addEventListener('click', () => resolvePending('dismiss'));

document.addEventListener('DOMContentLoaded', load);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.subscriptions || changes.pendingDetection)) {
    load();
  }
});

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const template = document.getElementById('subscription-template');
const refreshBtn = document.getElementById('refresh');

async function fetchSubscriptions() {
  const data = await chrome.storage.local.get({ subscriptions: [] });
  return data.subscriptions.sort((a, b) => (b.detectedAt || '').localeCompare(a.detectedAt || ''));
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
  const subscriptions = await fetchSubscriptions();
  listEl.innerHTML = '';
  if (!subscriptions.length) {
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  subscriptions.forEach(renderSubscription);
}

refreshBtn.addEventListener('click', load);

document.addEventListener('DOMContentLoaded', load);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.subscriptions) {
    load();
  }
});

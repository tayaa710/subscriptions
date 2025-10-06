const STORAGE_KEY = 'subscriptions';
const PENDING_KEY = 'pendingDetection';
const REMINDER_LEAD_DAYS = 1; // remind 1 day before rollover

function getSubscriptions() {
  return new Promise(resolve => {
    chrome.storage.local.get({ [STORAGE_KEY]: [] }, data => {
      resolve(data[STORAGE_KEY]);
    });
  });
}

function setSubscriptions(subscriptions) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: subscriptions }, () => resolve());
  });
}

function getPendingDetection() {
  return new Promise(resolve => {
    chrome.storage.local.get({ [PENDING_KEY]: null }, data => {
      resolve(data[PENDING_KEY] || null);
    });
  });
}

function setPendingDetection(detection) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [PENDING_KEY]: detection }, () => resolve());
  });
}

function clearPendingDetection() {
  return new Promise(resolve => {
    chrome.storage.local.remove(PENDING_KEY, () => resolve());
  });
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function computeReminderTimestamps(payload) {
  const now = Date.now();
  const lead = REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000;
  let rollover = null;
  let recurrence = null;

  if (payload.trial && payload.trial.durationDays) {
    rollover = now + payload.trial.durationDays * 24 * 60 * 60 * 1000;
    if (payload.billing && payload.billing.period) {
      recurrence = periodToMillis(payload.billing.period);
    }
  } else if (payload.billing && payload.billing.period) {
    rollover = now + periodToMillis(payload.billing.period);
    recurrence = periodToMillis(payload.billing.period);
  }

  if (!rollover) {
    return { reminderTime: null, recurrence: null };
  }

  let reminderTime = rollover - lead;
  if (reminderTime <= now) {
    reminderTime = now + 5 * 60 * 1000; // fallback to 5 minutes later
  }

  return { reminderTime, recurrence, rollover };
}

function periodToMillis(period) {
  switch (period) {
    case 'daily':
      return 24 * 60 * 60 * 1000;
    case 'weekly':
      return 7 * 24 * 60 * 60 * 1000;
    case 'monthly':
      return 30 * 24 * 60 * 60 * 1000;
    case 'yearly':
      return 365 * 24 * 60 * 60 * 1000;
    default:
      return 30 * 24 * 60 * 60 * 1000;
  }
}

async function scheduleAlarm(subscription) {
  if (!subscription.nextReminderTime) {
    return;
  }
  const alarmInfo = { when: subscription.nextReminderTime };
  if (subscription.recurrence) {
    alarmInfo.periodInMinutes = Math.round(subscription.recurrence / (60 * 1000));
  }
  chrome.alarms.create(subscription.id, alarmInfo);
}

chrome.runtime.onInstalled.addListener(async () => {
  const subscriptions = await getSubscriptions();
  for (const sub of subscriptions) {
    await scheduleAlarm(sub);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'subscriptionDetected') {
    handleDetection(message.payload).then(result => {
      sendResponse({ received: true, ...result });
    });
    return true;
  }
  if (message?.type === 'removeSubscription' && message.id) {
    removeSubscription(message.id).then(() => sendResponse({ removed: true }));
    return true;
  }
  if (message?.type === 'resolvePendingDetection') {
    resolvePendingDetection(message.decision, message.token).then(result => {
      sendResponse(result);
    });
    return true;
  }
  return false;
});

async function handleDetection(payload) {
  const subscriptions = await getSubscriptions();
  const existing =
    subscriptions.find(sub => sub.url === payload.url) ||
    (payload.id ? subscriptions.find(sub => sub.id === payload.id) : null);

  const pendingDetection = {
    token: uuid(),
    existingId: existing?.id || null,
    name: payload.name,
    url: payload.url,
    detectedAt: payload.detectedAt,
    trial: payload.trial,
    billing: payload.billing
  };

  await setPendingDetection(pendingDetection);
  await openActionPopup();
  return { pending: true, existing: Boolean(existing), token: pendingDetection.token };
}

async function resolvePendingDetection(decision, token) {
  const pending = await getPendingDetection();
  if (!pending || (token && token !== pending.token)) {
    return { resolved: false };
  }

  await clearPendingDetection();

  if (decision === 'dismiss') {
    return { resolved: true, saved: false };
  }

  const result = await finalizePendingDetection(pending);
  return { resolved: true, saved: true, ...result };
}

async function finalizePendingDetection(pending) {
  const subscriptions = await getSubscriptions();
  const matchById = pending.existingId
    ? subscriptions.find(sub => sub.id === pending.existingId)
    : null;
  const existing = matchById || subscriptions.find(sub => sub.url === pending.url);
  const { reminderTime, recurrence, rollover } = computeReminderTimestamps(pending);

  if (existing) {
    existing.name = pending.name;
    existing.url = pending.url;
    existing.detectedAt = pending.detectedAt;
    existing.trial = pending.trial;
    existing.billing = pending.billing;
    existing.nextReminderTime = reminderTime;
    existing.recurrence = recurrence;
    existing.nextRollover = rollover;
    await setSubscriptions(subscriptions);
    await scheduleAlarm(existing);
    await createDetectionNotification(existing, true);
    return { id: existing.id, updated: true };
  }

  const subscription = {
    id: uuid(),
    name: pending.name,
    url: pending.url,
    detectedAt: pending.detectedAt,
    trial: pending.trial,
    billing: pending.billing,
    nextReminderTime: reminderTime,
    recurrence,
    nextRollover: rollover
  };

  subscriptions.push(subscription);
  await setSubscriptions(subscriptions);
  await scheduleAlarm(subscription);
  await createDetectionNotification(subscription, false);
  return { id: subscription.id, updated: false };
}

async function openActionPopup() {
  if (!chrome.action || typeof chrome.action.openPopup !== 'function') {
    return;
  }

  try {
    const maybePromise = chrome.action.openPopup();
    if (maybePromise && typeof maybePromise.then === 'function') {
      await maybePromise;
    }
  } catch (error) {
    console.debug('Subscription Sentinel: failed to open popup automatically', error);
  }
}

async function createDetectionNotification(subscription, updated) {
  const lines = [];
  if (subscription.trial?.durationDays) {
    lines.push(`Trial ends ${new Date(subscription.nextRollover || subscription.nextReminderTime).toLocaleDateString()}`);
  }
  if (subscription.billing?.amount) {
    lines.push(`${subscription.billing.amount} ${subscription.billing.period || ''}`.trim());
  } else if (subscription.billing?.period) {
    lines.push(`Billed ${subscription.billing.period}`);
  }

  await new Promise(resolve => {
    chrome.notifications.create(subscription.id + (updated ? '-updated' : ''), {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: updated ? 'Subscription updated' : 'Subscription detected',
      message: subscription.name,
      contextMessage: lines.join(' • ') || 'Reminder scheduled',
      priority: 1
    }, resolve);
  });
}

async function removeSubscription(id) {
  const subscriptions = await getSubscriptions();
  const remaining = subscriptions.filter(sub => sub.id !== id);
  await setSubscriptions(remaining);
  await new Promise(resolve => chrome.alarms.clear(id, resolve));
  chrome.notifications.clear(id);
  chrome.notifications.clear(`${id}-updated`);
}

chrome.alarms.onAlarm.addListener(async alarm => {
  const subscriptions = await getSubscriptions();
  const subscription = subscriptions.find(sub => sub.id === alarm.name);
  if (!subscription) {
    return;
  }

  await new Promise(resolve => {
    chrome.notifications.create(`${subscription.id}-reminder-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Subscription renewal coming up',
      message: subscription.name,
      contextMessage: subscription.billing?.amount
        ? `${subscription.billing.amount} ${subscription.billing.period || ''}`.trim()
        : 'Review your subscription',
      priority: 2
    }, resolve);
  });

  if (subscription.recurrence) {
    const baseReminder = subscription.nextReminderTime || Date.now();
    subscription.nextReminderTime = baseReminder + subscription.recurrence;
    const baseRollover = subscription.nextRollover || baseReminder;
    subscription.nextRollover = baseRollover + subscription.recurrence;
    await setSubscriptions(subscriptions);
  }
});

chrome.notifications.onClicked.addListener(async notificationId => {
  const subscriptions = await getSubscriptions();
  const subscription = subscriptions.find(sub => notificationId.startsWith(sub.id));
  if (subscription) {
    chrome.tabs.create({ url: subscription.url });
  }
});

# Subscription Sentinel

Subscription Sentinel is a Chrome extension that spots free trials and recurring billing terms while you browse checkout pages. When it detects a subscription, it saves the details locally and schedules notifications so you get reminded before the renewal hits.

## Features

- 🔍 **Automatic detection** – A content script scans the current page for free-trial lengths, billing amounts, and renewal cadence.
- 🧠 **Smart reminders** – Detected subscriptions are stored in `chrome.storage.local` and reminders are scheduled using `chrome.alarms` and `chrome.notifications`.
- 📋 **Quick overview** – The popup shows every tracked subscription, including trial terms, billing cadence, and the next reminder timestamp.
- 🧹 **Simple management** – Remove subscriptions you no longer need directly from the popup.

## Project structure

```
manifest.json        # Extension manifest (MV3)
background.js        # Service worker handling storage, alarms, and notifications
contentScript.js     # Page analyzer that scrapes subscription language
popup.html/.css/.js  # Popup UI for viewing and managing saved subscriptions
```

## How detection works

1. The content script walks visible text nodes on the page (up to ~2 kB) and runs a few regular expressions looking for:
   - Free-trial durations (e.g., “14-day free trial”).
   - Billing amounts tied to a cadence (e.g., “$12.99 per month”).
   - Generic cadence language (e.g., “billed annually”).
2. Matches are normalized to capture the duration (in days) and billing period.
3. The data is sent to the background service worker, which deduplicates entries per URL, stores them, and schedules notifications.
4. Reminders fire one day before the computed rollover. If a billing cadence is available, the reminder recurs on that cadence.

> ℹ️ Detection is heuristic based. For checkout flows rendered inside iframes or heavily scripted experiences, it may miss some offers. You can still add them manually by browsing to confirmation pages or using the popup once support is added.

## Installation

1. Open **chrome://extensions** in Chrome.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and choose this project folder.
4. Navigate to a subscription checkout page—if the extension spots relevant text it will save it automatically and notify you.

## Testing the detection heuristics

You can simulate a detection by creating a simple HTML page with subscription language and loading it via a `file://` URL. The page text should include phrases like “7-day free trial” or “$9.99 per month” for the regexes to latch onto.

## Privacy

All subscription data lives in `chrome.storage.local` and never leaves your device.

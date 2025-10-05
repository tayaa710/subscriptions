(() => {
  if (window.__subscriptionSentinelProcessed) {
    return;
  }
  window.__subscriptionSentinelProcessed = true;

  function textContentFromDocument() {
    const walker = document.createTreeWalker(document.body || document, NodeFilter.SHOW_TEXT);
    const pieces = [];
    let count = 0;
    while (walker.nextNode() && count < 2000) {
      const value = walker.currentNode.nodeValue.trim();
      if (value.length > 0) {
        pieces.push(value);
        count += value.length;
      }
    }
    return pieces.join('\n');
  }

  function extractTrial(text) {
    const trialPatterns = [
      /(\d+)\s*(day|week|month|year)s?\s*(?:free\s*)?trial/i,
      /trial\s*period\s*:?\s*(\d+)\s*(day|week|month|year)s?/i,
      /(free|complimentary) trial.*?(\d+)\s*(day|week|month|year)s?/i
    ];
    for (const pattern of trialPatterns) {
      const match = text.match(pattern);
      if (match) {
        const groups = match.slice(1).filter(Boolean);
        const numeric = groups.find(group => /\d+/.test(group));
        const unitValue = groups.find(group => /(day|week|month|year)s?/i.test(group));
        const value = numeric ? parseInt(numeric.replace(/[^\d]/g, ''), 10) : null;
        const unit = unitValue ? unitValue.toLowerCase() : null;
        return {
          durationText: match[0],
          durationDays: value && unit ? convertToDays(value, unit) : null
        };
      }
    }
    return null;
  }

  function extractBilling(text) {
    const billingPatterns = [
      /(\$|£|€)\s?(\d+[\.,]?\d*)\s*(per|\/)?\s*(month|year|week|day)/i,
      /(\d+[\.,]?\d*)\s*(USD|EUR|GBP)\s*(per|\/)?\s*(month|year|week|day)/i,
      /(billed|charges?)\s*(monthly|annually|yearly|weekly|daily)/i
    ];
    for (const pattern of billingPatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[1] && /\$|£|€/.test(match[1])) {
          return {
            amount: `${match[1]}${match[2]}`,
            period: normalisePeriod(match[4])
          };
        }
        if (match[2] && /(USD|EUR|GBP)/i.test(match[2])) {
          return {
            amount: `${match[1]} ${match[2]}`,
            period: normalisePeriod(match[4])
          };
        }
        if (match[1] && /(billed|charges?)/i.test(match[1])) {
          return {
            amount: null,
            period: normalisePeriod(match[2])
          };
        }
      }
    }
    return null;
  }

  function convertToDays(value, unit) {
    switch (unit) {
      case 'day':
      case 'days':
        return value;
      case 'week':
      case 'weeks':
        return value * 7;
      case 'month':
      case 'months':
        return value * 30;
      case 'year':
      case 'years':
        return value * 365;
      default:
        return null;
    }
  }

  function normalisePeriod(period) {
    if (!period) {
      return null;
    }
    const value = period.toLowerCase();
    if (['month', 'monthly'].includes(value)) return 'monthly';
    if (['year', 'yearly', 'annually', 'annual'].includes(value)) return 'yearly';
    if (['week', 'weekly'].includes(value)) return 'weekly';
    if (['day', 'daily'].includes(value)) return 'daily';
    return value;
  }

  function detectSubscription() {
    const text = textContentFromDocument();
    if (!text || text.length < 40) {
      return null;
    }

    const trial = extractTrial(text);
    const billing = extractBilling(text);

    if (!trial && !billing) {
      return null;
    }

    return {
      name: document.title || location.hostname,
      url: location.href,
      detectedAt: new Date().toISOString(),
      trial,
      billing
    };
  }

  const pendingDetection = detectSubscription();
  if (!pendingDetection) {
    return;
  }

  let dispatched = false;

  const ACTION_KEYWORDS = [
    'subscribe',
    'subscription',
    'trial',
    'start plan',
    'start membership',
    'start free',
    'start my',
    'checkout',
    'complete order',
    'place order',
    'join now',
    'confirm'
  ];

  function hasKeyword(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return ACTION_KEYWORDS.some(keyword => lower.includes(keyword));
  }

  function elementLabel(element) {
    if (!element) return '';
    const attr = element.getAttribute('aria-label') || element.getAttribute('title');
    if (attr) {
      return attr;
    }
    if (element instanceof HTMLInputElement) {
      return element.value || element.placeholder || '';
    }
    return element.innerText || element.textContent || '';
  }

  function dispatchDetection(trigger) {
    if (dispatched) {
      return;
    }
    dispatched = true;
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('click', onClick, true);

    chrome.runtime.sendMessage(
      {
        type: 'subscriptionDetected',
        payload: { ...pendingDetection, trigger }
      },
      response => {
        if (chrome.runtime.lastError) {
          console.debug('Subscription Sentinel: unable to send detection', chrome.runtime.lastError);
        } else if (response && response.received) {
          console.debug('Subscription Sentinel: detection stored', response);
        }
      }
    );
  }

  function onSubmit(event) {
    if (!event.isTrusted) {
      return;
    }
    const submitter = event.submitter;
    if (submitter && hasKeyword(elementLabel(submitter))) {
      dispatchDetection('form-submit');
      return;
    }
    const form = event.target;
    if (form && hasKeyword(elementLabel(form))) {
      dispatchDetection('form-submit');
    }
  }

  function onClick(event) {
    if (!event.isTrusted) {
      return;
    }
    const actionable = event.target.closest('button, [role="button"], input[type="submit"], input[type="button"], a');
    if (!actionable) {
      return;
    }
    if (hasKeyword(elementLabel(actionable))) {
      dispatchDetection('click');
    }
  }

  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('click', onClick, true);
})();

const DEFAULT_IGNORE = [
  'exit interview',
  'powered by',
  'about 5 minutes',
  'type your response',
  'listening',
  'skip',
  'start voice interview'
];

function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function isNoise(text, ignore = DEFAULT_IGNORE) {
  const t = text.toLowerCase();
  if (!t) return true;
  if (t.startsWith('[draft')) return true;
  return ignore.some((p) => t.includes(p));
}

function pickAgentCandidate(texts, ignore = DEFAULT_IGNORE) {
  const cleaned = texts
    .map(normalizeText)
    .filter((t) => t.length >= 20)
    .filter((t) => !isNoise(t, ignore));

  // Prefer questions; otherwise pick the longest.
  const withQ = cleaned.filter((t) => t.includes('?'));
  const pool = withQ.length ? withQ : cleaned;
  if (!pool.length) return '';
  return pool.reduce((a, b) => (b.length > a.length ? b : a), pool[0]);
}

async function extractTexts(page, { includeDrafts = true } = {}) {
  return page.evaluate((opts) => {
    const out = new Set();

    const add = (t) => {
      const s = (t || '').toString().trim();
      if (s) out.add(s);
    };

    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    // Likely prompt text
    document.querySelectorAll('h1,h2,h3,p').forEach((el) => {
      if (!isVisible(el)) return;
      const t = (el.innerText || el.textContent || '').trim();
      if (t.length >= 10 && t.length <= 800) add(t);
    });

    // Dynamic agent text often lives here
    document.querySelectorAll('[aria-live], [role="status"], [role="alert"]').forEach((el) => {
      if (!isVisible(el)) return;
      const t = (el.innerText || el.textContent || '').trim();
      if (t.length >= 3 && t.length <= 800) add(t);
    });

    // Optional: capture drafts for debugging/visibility
    if (opts.includeDrafts) {
      document
        .querySelectorAll('textarea, input[type="text"], input[type="search"], [role="textbox"], [contenteditable="true"]')
        .forEach((el) => {
          let raw = '';
          // eslint-disable-next-line no-prototype-builtins
          if (Object.prototype.hasOwnProperty.call(el, 'value')) raw = el.value || '';
          else raw = el.innerText || el.textContent || '';
          const t = String(raw || '').trim();
          if (t.length >= 1 && t.length <= 1000) add(`[draft] ${t}`);
        });
    }

    return Array.from(out);
  }, { includeDrafts });
}

function createInterviewMonitor(
  page,
  {
    pollIntervalMs = 500,
    debounceMs = 800,
    includeDrafts = true,
    ignore = DEFAULT_IGNORE,
    onAgentMessage,
    onError
  } = {}
) {
  let interval;
  let debounce;
  let lastCandidate = '';
  let lastFired = '';
  let stopped = false;

  const isClosedError = (e) => {
    const msg = String(e?.message || '');
    return (
      msg.includes('Target closed') ||
      msg.includes('Protocol error') ||
      msg.includes('Execution context was destroyed') ||
      msg.includes('detached') ||
      msg.includes('Session closed')
    );
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const texts = await extractTexts(page, { includeDrafts });
      const candidate = pickAgentCandidate(texts, ignore);
      if (!candidate || candidate === lastCandidate) return;
      lastCandidate = candidate;

      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (stopped) return;
        if (candidate && candidate !== lastFired) {
          lastFired = candidate;
          if (onAgentMessage) onAgentMessage(candidate);
        }
      }, debounceMs);
    } catch (e) {
      if (onError) onError(e);
      if (isClosedError(e)) {
        stopped = true;
        if (interval) clearInterval(interval);
        if (debounce) clearTimeout(debounce);
      }
    }
  };

  return {
    start: async () => {
      await poll();
      interval = setInterval(poll, pollIntervalMs);
    },
    stop: async () => {
      stopped = true;
      if (interval) clearInterval(interval);
      if (debounce) clearTimeout(debounce);
    }
  };
}

module.exports = {
  createInterviewMonitor
};



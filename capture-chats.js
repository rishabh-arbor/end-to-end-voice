const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}

function loadSecretsLocalJson() {
  const secretsPath = path.join(__dirname, 'secrets.local.json');
  if (!fs.existsSync(secretsPath)) return;
  try {
    const raw = fs.readFileSync(secretsPath, 'utf8');
    const json = JSON.parse(raw);
    if (json && typeof json === 'object') {
      Object.entries(json).forEach(([k, v]) => {
        if (!k) return;
        if (v === undefined || v === null) return;
        if (!process.env[k]) process.env[k] = String(v);
      });
    }
  } catch (e) {
    console.error(`Failed to read secrets.local.json: ${e?.message || e}`);
  }
}

loadDotEnv();
loadSecretsLocalJson();

const puppeteer = require('puppeteer');

const { createInterviewMonitor } = require('./interview-monitor');
const { typeIntoInterview, showKeyboard } = require('./interview-type');
const { generateGeminiReply } = require('./gemini');
const { tryProgress, logPageSnapshot } = require('./interview-click');

const interviewUrl = process.argv[2] || '';
const manualText = process.argv.slice(3).join(' ') || process.env.ANSWER_TEXT || '';

const wsEndpoint = process.env.PUPPETEER_WS_ENDPOINT || '';
const skipNav = process.env.SKIP_NAV === '1';
const tabTitleFilter = (process.env.TAB_TITLE_FILTER || 'interview')
  .toLowerCase()
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const autoGemini = process.env.AUTO_GEMINI === '1';
const autoSubmit = process.env.AUTO_SUBMIT === '1';
const autoProgress = process.env.AUTO_PROGRESS !== '0'; // enabled by default
const interviewPassword = process.env.INTERVIEW_PASSWORD || '';
const geminiApiKey = process.env.GEMINI_API_KEY || '';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const geminiMinIntervalMs = Number(process.env.GEMINI_MIN_INTERVAL_MS || 15000);
const geminiSystemPrompt = process.env.GEMINI_SYSTEM_PROMPT || 'Reply as the interview candidate. Keep it concise and friendly.';

async function getBrowser() {
  if (wsEndpoint) {
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
    return { browser, launched: false };
  }
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  return { browser, launched: true };
}

async function pickPage(browser) {
  const pages = await browser.pages();
  if (!pages.length) return browser.newPage();
  for (const p of pages) {
    try {
      const title = (await p.title()).toLowerCase();
      if (tabTitleFilter.some((k) => title.includes(k))) return p;
    } catch {
      // ignore
    }
  }
  return pages[0];
}

(async () => {
  if (!wsEndpoint && !interviewUrl) {
    console.error('Provide an interview URL or set PUPPETEER_WS_ENDPOINT.');
    process.exit(1);
  }

  const { browser, launched } = await getBrowser();
  const page = await pickPage(browser);
  await page.setViewport({ width: 1920, height: 1080 });

  // Auto-grant browser permissions (camera, microphone, etc.)
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(
    interviewUrl || 'https://interview-staging.findarbor.com',
    ['camera', 'microphone', 'notifications']
  );
  console.log('Browser permissions granted (camera, microphone, notifications)');

  if (!skipNav && interviewUrl) {
    console.log(`Navigating to: ${interviewUrl}`);
    await page.goto(interviewUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  } else {
    console.log('Skipping navigation (SKIP_NAV=1).');
  }

  let generating = false;
  let pendingDraft = '';
  let nextGeminiAllowedAt = 0;
  let lastGeminiAt = 0;
  let lastAgentAsked = '';
  let scheduledRetry = null;

  const tryTypePending = async () => {
    if (!pendingDraft) return;
    const typed = await typeIntoInterview(page, pendingDraft, { onlyIfEmpty: true, submit: autoSubmit });
    if (typed) {
      if (autoSubmit) {
        console.log('Typed draft and submitted.');
      } else {
        console.log('Typed draft into input (not sent).');
      }
      pendingDraft = '';
    }
  };

  const enqueueDraft = async (draft) => {
    if (!draft) return;
    // Don’t overwrite an existing draft; user may be reviewing it.
    if (pendingDraft) return;
    pendingDraft = draft;
    await tryTypePending();
    // If input wasn’t ready, retry a few times in background.
    let retries = 0;
    const maxRetries = 20;
    const tick = async () => {
      if (!pendingDraft) return;
      retries += 1;
      await tryTypePending();
      if (pendingDraft && retries < maxRetries) setTimeout(tick, 800);
    };
    if (pendingDraft) setTimeout(tick, 800);
  };

  const shouldCallGemini = (agentText) => {
    const t = String(agentText || '').trim();
    if (!t) { console.log('[debug-should] empty text'); return false; }
    // Only respond to actual questions to reduce churn/quota usage.
    if (!t.includes('?')) { console.log('[debug-should] no ? in text'); return false; }
    // Avoid repeated prompts.
    if (t === lastAgentAsked) { console.log('[debug-should] duplicate prompt'); return false; }
    // Rate limit
    const now = Date.now();
    if (now < nextGeminiAllowedAt) { console.log('[debug-should] rate limited (nextAllowed)'); return false; }
    if (now - lastGeminiAt < geminiMinIntervalMs) { console.log(`[debug-should] min interval not met (${now - lastGeminiAt}ms < ${geminiMinIntervalMs}ms)`); return false; }
    // If a draft is already pending, wait for user to handle it.
    if (pendingDraft) { console.log('[debug-should] draft pending'); return false; }
    console.log('[debug-should] all checks passed, calling Gemini');
    return true;
  };

  const monitor = createInterviewMonitor(page, {
    onAgentMessage: async (agentText) => {
      console.log(`Umi: ${agentText}`);

      // Manual typing mode (one-shot)
      if (manualText) {
        await enqueueDraft(manualText);
        return;
      }

      // Gemini auto-draft mode (types, does not submit)
      console.log(`[debug] autoGemini=${autoGemini}, geminiApiKey=${geminiApiKey ? 'SET' : 'MISSING'}, generating=${generating}`);
      if (!autoGemini) {
        console.log('[debug] AUTO_GEMINI not enabled, skipping Gemini call');
        return;
      }
      if (!geminiApiKey) {
        console.error('AUTO_GEMINI=1 set but GEMINI_API_KEY is missing.');
        return;
      }
      if (generating) {
        console.log('[debug] already generating, skipping');
        return;
      }
      const should = shouldCallGemini(agentText);
      console.log(`[debug] shouldCallGemini=${should}`);
      if (!should) return;

      generating = true;
      try {
        lastAgentAsked = agentText;
        lastGeminiAt = Date.now();
        const reply = await generateGeminiReply({
          apiKey: geminiApiKey,
          model: geminiModel,
          systemPrompt: geminiSystemPrompt,
          userPrompt: agentText
        });
        await enqueueDraft(reply);
      } catch (e) {
        const retryAfterMs = Number(e?.retryAfterMs || 0);
        if (e?.status === 429 && retryAfterMs > 0) {
          nextGeminiAllowedAt = Date.now() + retryAfterMs;
          console.error(`Gemini rate limited; retrying after ~${Math.ceil(retryAfterMs / 1000)}s`);

          // Schedule a retry for the same prompt once allowed.
          if (scheduledRetry) clearTimeout(scheduledRetry);
          const promptForRetry = agentText;
          scheduledRetry = setTimeout(async () => {
            scheduledRetry = null;
            if (!autoGemini || generating || pendingDraft) return;
            if (promptForRetry !== lastAgentAsked) return;
            if (Date.now() < nextGeminiAllowedAt) return;

            generating = true;
            try {
              lastGeminiAt = Date.now();
              const reply = await generateGeminiReply({
                apiKey: geminiApiKey,
                model: geminiModel,
                systemPrompt: geminiSystemPrompt,
                userPrompt: promptForRetry
              });
              await enqueueDraft(reply);
            } catch (err2) {
              console.error(`Gemini error: ${err2?.message || err2}`);
            } finally {
              generating = false;
            }
          }, retryAfterMs + 200);
        } else {
          console.error(`Gemini error: ${e?.message || e}`);
        }
      } finally {
        generating = false;
      }
    }
    ,
    onError: (e) => {
      const msg = String(e?.message || '');
      if (msg.includes('Target closed') || msg.includes('Execution context was destroyed') || msg.includes('Protocol error')) {
        console.error('Browser/page closed; stopping.');
      } else {
        console.error(`Monitor error: ${msg}`);
      }
    }
  });

  await monitor.start();

  // Auto-progress: use all methods to advance through interview intro (password, language, buttons)
  let progressInterval;
  let lastPageState = '';
  let lastButtonClicked = '';
  let sameButtonCount = 0;
  let noProgressCount = 0;
  let blockedButtons = new Set(); // track buttons that didn't work
  let lastProgressAction = 0; // timestamp of last successful action
  if (autoProgress) {
    progressInterval = setInterval(async () => {
      try {
        const currentPageState = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || '');
        
        // Try to show keyboard icon (in case text input is available but hidden behind keyboard toggle)
        await showKeyboard(page).catch(() => {});
        
        // Try all progress methods (password, language, buttons)
        const result = await tryProgress(page, { password: interviewPassword, blockedButtons });
        
        // If we made any progress (password/language/etc), reset blocked buttons to retry
        if (result && result.progressed) {
          const now = Date.now();
          if (now - lastProgressAction > 3000) {
            // Reset blockedButtons since we made progress elsewhere (password/language)
            if (blockedButtons.size > 0) {
              console.log('[click] Progress made; resetting blocked buttons to retry');
              blockedButtons.clear();
            }
            lastProgressAction = now;
          }
        }
        
        // If we clicked a button, track it
        if (result && result.buttonClicked) {
          if (result.buttonClicked === lastButtonClicked && currentPageState === lastPageState) {
            sameButtonCount++;
            if (sameButtonCount >= 3) {
              console.log(`[click] Button "${result.buttonClicked}" stuck - analyzing why...`);
              await logPageSnapshot(page, 'button-stuck');
              console.log(`[click] Blocking button "${result.buttonClicked}" - no page change after ${sameButtonCount} clicks`);
              blockedButtons.add(result.buttonClicked);
              sameButtonCount = 0;
            }
          } else {
            lastButtonClicked = result.buttonClicked;
            sameButtonCount = 0;
          }
          noProgressCount = 0; // reset since we did something
        } else {
          // No action taken this cycle
          noProgressCount++;
          if (noProgressCount === 5) {
            console.log('[click] No progress for 10s, logging page snapshot...');
            await logPageSnapshot(page, 'no-progress');
          }
        }
        
        lastPageState = currentPageState;
      } catch (e) {
        // ignore
      }
    }, 2000); // check every 2s
  }

  // Exit cleanly if the browser disconnects
  browser.on('disconnected', async () => {
    console.log('Browser disconnected; stopping...');
    await monitor.stop();
    if (progressInterval) clearInterval(progressInterval);
    process.exit(0);
  });
  
  // Handle unhandled promise rejections gracefully
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    // Don't exit, keep running
  });

  process.on('SIGINT', async () => {
    await monitor.stop();
    if (progressInterval) clearInterval(progressInterval);
    if (launched) await browser.close();
    else await browser.disconnect();
    process.exit(0);
  });
})();


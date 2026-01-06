/**
 * Electron renderer script - runs in the browser context
 * Handles audio capture, automation, STT, Gemini, and typing
 * 
 * Note: CONFIG is injected by main process wrapper
 */

console.log('[electron] Automation starting with config:', CONFIG);

let audioContext;
let audioStream;
let isRecording = false;
let lastGeminiAt = 0;
let generating = false;
let pendingDraft = '';

// ===== AUDIO CAPTURE =====

async function startAudioCapture() {
  if (isRecording) return;
  
  console.log('[audio] Starting audio capture...');
  
  try {
    // Get desktop sources via exposed API
    const sources = await window.electronAPI.getDesktopSources();
    console.log('[audio] Found', sources.length, 'desktop sources');
    const currentWindow = sources.find((s) => s.name.includes('Interview') || s.name.includes('Arbor'));
    
    if (!currentWindow) {
      console.warn('[audio] Could not find interview window, using first source');
    }
    
    const sourceId = currentWindow ? currentWindow.id : sources[0]?.id;
    
    if (!sourceId) {
      console.error('[audio] No desktop source available');
      return;
    }
    
    // Capture audio stream
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      },
      video: false
    });
    
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(audioStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    
    let chunkCount = 0;
    processor.onaudioprocess = (e) => {
      if (!isRecording) return;
      const audioData = e.inputBuffer.getChannelData(0);
      
      chunkCount++;
      
      // Calculate audio level (RMS)
      let sum = 0;
      for (let i = 0; i < audioData.length; i++) {
        sum += audioData[i] * audioData[i];
      }
      const rms = Math.sqrt(sum / audioData.length);
      const dbLevel = 20 * Math.log10(rms);
      
      // Log every 50 chunks (~2 seconds at 4096 samples/chunk, 16kHz)
      if (chunkCount % 50 === 0) {
        console.log(`[audio] Chunk #${chunkCount}: ${audioData.length} samples, level: ${dbLevel.toFixed(1)} dB`);
      }
      
      // TODO: Send to real-time STT (Whisper/Deepgram/Web Speech API)
    };
    
    source.connect(processor);
    processor.connect(audioContext.destination);
    
    isRecording = true;
    console.log('[audio] ✓ Audio capture started');
    
  } catch (err) {
    console.error('[audio] Failed to start capture:', err);
  }
}

function stopAudioCapture() {
  if (!isRecording) return;
  
  isRecording = false;
  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
  }
  if (audioContext) {
    audioContext.close();
  }
  
  console.log('[audio] Audio capture stopped');
}

// ===== AUTOMATION HELPERS =====

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findVisibleElement(selector) {
  const els = document.querySelectorAll(selector);
  for (const el of els) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
      return el;
    }
  }
  return null;
}

async function fillPassword(password) {
  const input = await findVisibleElement('input[type="password"]');
  if (!input) return false;
  
  const current = input.value || '';
  if (current.trim()) return false;
  
  input.focus();
  input.click();
  
  for (const char of password) {
    input.value += char;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(60 + Math.random() * 40);
  }
  
  console.log('[auto] ✓ Filled password');
  return true;
}

async function selectLanguage() {
  // Try dropdown
  const select = await findVisibleElement('select');
  if (select) {
    const label = (select.getAttribute('aria-label') || select.labels?.[0]?.innerText || '').toLowerCase();
    if (label.includes('language')) {
      select.focus();
      select.click();
      
      const options = Array.from(select.options);
      const english = options.find((o) => o.text.toLowerCase().includes('english'));
      if (english) {
        select.value = english.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[auto] ✓ Selected English from dropdown');
        return true;
      }
    }
  }
  
  // Try custom dropdown (click container, wait, click English)
  const divs = document.querySelectorAll('div, button');
  for (const div of divs) {
    const txt = (div.innerText || '').trim();
    if (txt.toLowerCase().includes('language') && txt.toLowerCase().includes('english')) {
      div.click();
      await wait(500);
      
      const options = document.querySelectorAll('li, [role="option"]');
      for (const opt of options) {
        if ((opt.innerText || '').toLowerCase() === 'english') {
          opt.click();
          console.log('[auto] ✓ Selected English from custom dropdown');
          return true;
        }
      }
    }
  }
  
  return false;
}

async function clickButton(texts) {
  const buttons = document.querySelectorAll('button, [role="button"], a');
  for (const btn of buttons) {
    const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
    if (texts.some((t) => txt.includes(t))) {
      const style = window.getComputedStyle(btn);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        btn.click();
        console.log(`[auto] ✓ Clicked: "${txt}"`);
        return true;
      }
    }
  }
  return false;
}

async function showKeyboard() {
  // Click bottom icon buttons (keyboard toggle)
  const allEls = document.querySelectorAll('button, div, [role="button"]');
  for (const el of allEls) {
    const txt = (el.innerText || el.textContent || '').trim();
    if (txt && txt.length > 2) continue;
    
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    
    const rect = el.getBoundingClientRect();
    const svg = el.querySelector('svg');
    
    if (svg && rect.bottom > window.innerHeight * 0.6 && rect.width < 80) {
      el.click();
      console.log('[auto] ✓ Clicked keyboard toggle');
      await wait(800);
      return true;
    }
  }
  return false;
}

async function typeAndSubmit(text) {
  if (!text) return false;
  
  // Show keyboard if needed
  await showKeyboard();
  
  // Find input
  const input = await findVisibleElement('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
  if (!input) {
    console.log('[auto] No input found');
    return false;
  }
  
  input.focus();
  input.click();
  
  // Type with human-like speed
  console.log(`[auto] Typing ${text.length} chars...`);
  for (const char of text) {
    if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
      input.value += char;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('insertText', false, char);
    }
    await wait(50 + Math.random() * 30);
  }
  
  console.log('[auto] Typing complete');
  
  if (CONFIG.autoSubmit) {
    await wait(500);
    
    // Try Enter key
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
    input.dispatchEvent(enterEvent);
    
    console.log('[auto] ✓ Pressed Enter to submit');
  }
  
  return true;
}

// ===== UMI MESSAGE DETECTION =====

let lastUmiMessage = '';

function detectUmiMessage() {
  const bodyText = document.body.innerText || '';
  const lines = bodyText.split('\n').map((l) => l.trim()).filter((l) => l.length > 20);
  
  // Prefer questions
  const questions = lines.filter((l) => l.includes('?'));
  const candidate = questions.length ? questions[questions.length - 1] : lines[lines.length - 1];
  
  if (candidate && candidate !== lastUmiMessage && !candidate.toLowerCase().includes('exit') && !candidate.toLowerCase().includes('powered by')) {
    lastUmiMessage = candidate;
    console.log('[umi]', candidate);
    
    if (candidate.includes('?')) {
      handleUmiQuestion(candidate);
    }
  }
}

async function handleUmiQuestion(question) {
  if (!CONFIG.autoGemini) return;
  if (generating) return;
  
  const now = Date.now();
  if (now - lastGeminiAt < CONFIG.geminiMinIntervalMs) {
    console.log('[gemini] Rate limited, skipping');
    return;
  }
  
  if (pendingDraft) {
    console.log('[gemini] Draft pending, skipping');
    return;
  }
  
  generating = true;
  lastGeminiAt = now;
  
  try {
    console.log('[gemini] Calling Gemini for question...');
    const reply = await window.electronAPI.callGemini({
      userPrompt: question,
      systemPrompt: 'Reply as the interview candidate. Keep it concise and friendly.',
      model: 'auto'
    });
    
    console.log('[gemini] ✓ Reply generated:', reply.slice(0, 100));
    pendingDraft = reply;
    
    // Try to type immediately
    await tryTypePending();
    
    // Retry typing if input wasn't ready
    let retries = 0;
    const retryInterval = setInterval(async () => {
      if (!pendingDraft || retries++ > 20) {
        clearInterval(retryInterval);
        return;
      }
      await tryTypePending();
    }, 800);
    
  } catch (err) {
    console.error('[gemini] Error:', err?.message || err);
  } finally {
    generating = false;
  }
}

async function tryTypePending() {
  if (!pendingDraft) return;
  
  const typed = await typeAndSubmit(pendingDraft);
  if (typed) {
    console.log('[auto] ✓ Typed and submitted draft');
    pendingDraft = '';
  }
}

// ===== AUTO-PROGRESS =====

async function autoProgressTick() {
  if (!CONFIG.autoProgress) return;
  
  // Fill password
  if (CONFIG.interviewPassword) {
    await fillPassword(CONFIG.interviewPassword);
  }
  
  // Select language
  await selectLanguage();
  
  // Click progress buttons
  await clickButton(['get started', 'start voice interview', 'start interview', 'continue', 'next', 'skip', 'begin', 'proceed']);
}

// ===== MAIN LOOP =====

function init() {
  console.log('[electron] Initializing automation...');
  
  // Start audio capture if enabled
  if (CONFIG.captureAudio) {
    setTimeout(startAudioCapture, 2000);
  }
  
  // Monitor Umi messages
  setInterval(detectUmiMessage, 500);
  
  // Auto-progress
  setInterval(autoProgressTick, 2000);
  
  console.log('[electron] ✓ Automation active');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


const DEFAULT_INPUT_SELECTORS = [
  'textarea',
  'input[type="text"]',
  'input[type="search"]',
  '[role="textbox"]',
  '[contenteditable="true"]',
  'input'
];

async function isVisible(handle) {
  if (!handle) return false;
  const box = await handle.boundingBox();
  if (!box) return false;
  const style = await handle.evaluate((el) => {
    const s = window.getComputedStyle(el);
    return { display: s.display, visibility: s.visibility, opacity: s.opacity };
  });
  return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
}

async function findVisibleInput(page, selectors = DEFAULT_INPUT_SELECTORS) {
  for (const selector of selectors) {
    const handles = await page.$$(selector);
    for (const h of handles) {
      if (await isVisible(h)) return h;
    }
  }
  return null;
}

async function readInputValue(handle) {
  return handle.evaluate((el) => {
    if (el == null) return '';
    // input/textarea
    // eslint-disable-next-line no-prototype-builtins
    if (Object.prototype.hasOwnProperty.call(el, 'value')) return String(el.value || '');
    // contenteditable
    return String(el.innerText || el.textContent || '');
  });
}

const { clickSubmit } = require('./interview-click');

/**
 * Types text into the interview response input.
 * Returns true if typed, false if input not found or skipped.
 * @param {Page} page
 * @param {string} text
 * @param {object} options
 * @param {boolean} options.clear - Clear existing text before typing
 * @param {boolean} options.onlyIfEmpty - Only type if input is currently empty
 * @param {boolean} options.submit - Click submit button after typing
 */
/**
 * Click keyboard icon/toggle to show text input keyboard if present
 * Tries multiple aggressive strategies to find and click the keyboard toggle
 */
async function showKeyboard(page) {
  try {
    // Strategy 1: Try clicking via attribute-based selectors first
    const clicked = await page.evaluate(() => {
      const iconElements = Array.from(document.querySelectorAll('button, div, [role="button"]'));
      
      // Check for explicit keyboard attributes
      for (const btn of iconElements) {
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const title = btn.getAttribute('title') || '';
        const testId = btn.getAttribute('data-testid') || '';
        
        if (
          ariaLabel.toLowerCase().includes('keyboard') ||
          ariaLabel.toLowerCase().includes('type') ||
          title.toLowerCase().includes('keyboard') ||
          title.toLowerCase().includes('type') ||
          testId.toLowerCase().includes('keyboard')
        ) {
          const style = window.getComputedStyle(btn);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            btn.click();
            return 'keyboard icon button (attribute)';
          }
        }
      }
      
      // Strategy 2: Look for small DIV elements with SVG at bottom (Arbor's keyboard/mic toggles)
      const bottomDivs = Array.from(document.querySelectorAll('div'));
      for (const div of bottomDivs) {
        const className = div.className || '';
        if (!className.includes('backdrop-blur') && !className.includes('backdrop-filter')) continue;
        
        const style = window.getComputedStyle(div);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const rect = div.getBoundingClientRect();
        const svg = div.querySelector('svg');
        
        // Small square div with SVG at bottom
        if (svg && rect.width > 30 && rect.width < 60 && rect.bottom > window.innerHeight * 0.6) {
          // Click ALL such divs (there are usually 2: keyboard + mic, we want keyboard which is typically left)
          if (rect.right < window.innerWidth / 2 + 100) { // prefer left/center ones
            div.click();
            return 'backdrop-blur DIV with SVG (keyboard toggle)';
          }
        }
      }
      
      // Strategy 3: Look for buttons with keyboard-like SVG icons (no text, bottom of page)
      for (const btn of iconElements) {
        const btnText = (btn.innerText || btn.textContent || '').trim();
        if (btnText && btnText.length > 2) continue; // skip buttons with text
        
        const svg = btn.querySelector('svg');
        if (!svg) continue;
        
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const rect = btn.getBoundingClientRect();
        // Check if button is in the bottom half of the viewport (common for keyboard toggles)
        if (rect.bottom > window.innerHeight / 2) {
          btn.click();
          return 'bottom icon button with SVG';
        }
      }
      
      // Strategy 3: Look for ANY small button with SVG near bottom (very aggressive)
      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const btn of allButtons) {
        const btnText = (btn.innerText || btn.textContent || '').trim();
        if (btnText && btnText.length > 2) continue; // skip buttons with visible text
        
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const rect = btn.getBoundingClientRect();
        // Bottom 30% of viewport, small button
        if (rect.bottom > window.innerHeight * 0.7 && rect.width < 100 && rect.height < 100) {
          const hasSvg = btn.querySelector('svg') || btn.querySelector('path');
          if (hasSvg) {
            btn.click();
            return 'bottom small icon button';
          }
        }
      }
      
      // Strategy 4: VERY aggressive - click ANY button with just an SVG (no text) in the lower half
      for (const btn of allButtons) {
        const btnText = (btn.innerText || btn.textContent || '').trim();
        if (btnText) continue; // must have no text
        
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const rect = btn.getBoundingClientRect();
        if (rect.bottom > window.innerHeight * 0.5) { // lower half
          const hasSvg = btn.querySelector('svg');
          if (hasSvg) {
            btn.click();
            return 'lower-half icon button';
          }
        }
      }
      
      // Strategy 5: ULTRA aggressive - click ALL small icon buttons at bottom to find keyboard
      // (will click multiple buttons if needed)
      let clickedAny = false;
      for (const btn of allButtons) {
        const btnText = (btn.innerText || btn.textContent || '').trim();
        if (btnText && btnText.length > 2) continue;
        
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const rect = btn.getBoundingClientRect();
        // Bottom 20% of viewport, small button
        if (rect.bottom > window.innerHeight * 0.8 && rect.width < 80 && rect.height < 80) {
          const hasSvg = btn.querySelector('svg');
          if (hasSvg) {
            btn.click();
            clickedAny = true;
          }
        }
      }
      
      if (clickedAny) return 'clicked bottom icon buttons (multi)';
      
      return null;
    });
    
    if (clicked) {
      console.log(`[type] ✓ Clicked ${clicked} to show keyboard`);
      await new Promise((r) => setTimeout(r, 800)); // wait for keyboard UI to appear
      return true;
    }
    
    // Debug: log ALL buttons on page (including those we might have missed)
    const debugInfo = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('*'))
        .filter((el) => 
          el.tagName === 'BUTTON' || 
          el.getAttribute('role') === 'button' || 
          el.tagName === 'A' ||
          (el.onclick != null)
        );
      
      return allButtons
        .map((btn) => {
          const style = window.getComputedStyle(btn);
          const rect = btn.getBoundingClientRect();
          return {
            tag: btn.tagName,
            text: (btn.innerText || btn.textContent || '').trim().slice(0, 30),
            ariaLabel: btn.getAttribute('aria-label') || '',
            title: btn.getAttribute('title') || '',
            className: btn.className?.slice?.(0, 50) || '',
            hasSvg: !!btn.querySelector('svg'),
            bottom: Math.round(rect.bottom),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth
          };
        })
        .filter((b) => b.visible && b.bottom > window.innerHeight * 0.6) // bottom 40%
        .slice(0, 15);
    });
    console.log('[type] No keyboard toggle found. All bottom buttons:', JSON.stringify(debugInfo, null, 2));
    return false;
  } catch (err) {
    console.error(`[type] Error showing keyboard: ${err?.message || err}`);
    return false;
  }
}

async function typeIntoInterview(page, text, { clear = true, onlyIfEmpty = true, submit = false, retries = 10 } = {}) {
  if (!text || !text.trim()) return false;

  // Retry loop to wait for input/keyboard to appear
  for (let attempt = 0; attempt < retries; attempt++) {
    // CRITICAL: Try to show keyboard BEFORE looking for input
    console.log(`[type] Attempt ${attempt + 1}/${retries}: Attempting to show keyboard...`);
    const keyboardShown = await showKeyboard(page);
    if (keyboardShown) {
      await new Promise((r) => setTimeout(r, 1000)); // give keyboard UI time to fully appear
    }

    // Try clicking in the center of the page to activate input (sometimes needed)
    if (attempt > 0 && !keyboardShown) {
      await page.mouse.click(page.viewport().width / 2, page.viewport().height / 2).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }

    const input = await findVisibleInput(page);
    if (input) {
      // Found input, proceed with typing
      console.log('[type] Input found, ready to type');
      break;
    }
    
    if (attempt < retries - 1) {
      console.log(`[type] No input found yet, retrying in 1.5s...`);
      await new Promise((r) => setTimeout(r, 1500));
    } else {
      console.log('[type] No visible input found after all retries');
      return false;
    }
  }
  
  const input = await findVisibleInput(page);
  if (!input) {
    console.log('[type] No visible input found');
    return false;
  }

  const currentValue = (await readInputValue(input)).trim();
  if (onlyIfEmpty && currentValue.length > 0) {
    console.log('[type] Input not empty, skipping (onlyIfEmpty=true)');
    return false;
  }

  console.log(`[type] Typing text (${text.length} chars)...`);
  await input.click({ clickCount: 3 });
  await new Promise((r) => setTimeout(r, 200)); // wait for focus
  
  if (clear) {
    await page.keyboard.press('Backspace');
  }
  
  // Human-like typing speed (50-80ms per character with slight randomization)
  for (const char of text) {
    await page.keyboard.type(char, { delay: 0 });
    const randomDelay = 50 + Math.random() * 30; // 50-80ms
    await new Promise((r) => setTimeout(r, randomDelay));
  }
  
  console.log('[type] Typing completed');
  
  if (submit) {
    await new Promise((r) => setTimeout(r, 500)); // pause before submit
    console.log('[type] Submitting...');
    await clickSubmit(page);
  }
  
  return true;
}

module.exports = {
  typeIntoInterview,
  findVisibleInput,
  showKeyboard
};



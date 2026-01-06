/**
 * Click automation for interview flow:
 * - Auto-click "Get Started" / "Start" buttons
 * - Auto-click Submit button after typing a draft
 */

async function isVisible(handle) {
  if (!handle) return false;
  try {
    const box = await handle.boundingBox();
    if (!box) return false;
    const style = await handle.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { display: s.display, visibility: s.visibility, opacity: s.opacity };
    });
    return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
  } catch {
    return false;
  }
}

async function findVisibleElement(page, selectors) {
  for (const selector of selectors) {
    const handles = await page.$$(selector);
    if (!handles || handles.length === 0) continue;
    for (const h of handles) {
      if (await isVisible(h)) return h;
    }
  }
  return null;
}

/**
 * Click "Get Started" / "Start Voice Interview" / "Continue" / "Skip" buttons
 * Returns { clicked: boolean, buttonText: string } if clicked
 * @param {Page} page
 * @param {object} options
 * @param {Set<string>} options.blockedButtons - Set of button texts to skip
 */
async function clickGetStarted(page, { blockedButtons = new Set() } = {}) {
  try {
    const blockedArray = Array.from(blockedButtons);
    
    // Try text-based click first
    const result = await page.evaluate((blocked) => {
      const texts = [
        'get started',
        'start voice interview',
        'start interview',
        'voice interview',
        'continue',
        'proceed',
        'next',
        'skip',
        'begin',
        'start',
        'go',
        'ok'
      ];
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
      for (const el of candidates) {
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (texts.some((t) => txt.includes(t))) {
          // Skip if this button is blocked
          if (blocked.includes(txt)) {
            continue;
          }
          
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            el.click();
            return { clicked: true, buttonText: txt };
          }
        }
      }
      return { clicked: false, buttonText: '' };
    }, blockedArray);
    
    if (result.clicked) {
      console.log(`[click] ✓ Clicked button with text: "${result.buttonText}"`);
    }
    return result;
  } catch (err) {
    console.error(`[click] Error clicking Get Started: ${err?.message || err}`);
    return { clicked: false, buttonText: '' };
  }
}

/**
 * Click Submit button (for sending typed response)
 * Returns true if clicked, false otherwise
 */
async function clickSubmit(page) {
  try {
    console.log('[click] Looking for Submit/Send button...');
    
    // Try specific send button selectors (avoid generic SVG buttons)
    const clicked = await page.evaluate(() => {
      const excludeText = ['exit', 'cancel', 'close', 'back'];
      
      // 1) Try buttons with explicit send/submit attributes
      const explicitButtons = Array.from(document.querySelectorAll(
        'button[type="submit"], button[aria-label*="send" i], button[aria-label*="submit" i], [data-testid*="send" i], [data-testid*="submit" i]'
      ));
      
      for (const btn of explicitButtons) {
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (excludeText.some((ex) => txt.includes(ex))) continue;
        
        const style = window.getComputedStyle(btn);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          btn.click();
          return { clicked: true, method: `explicit send button: "${txt}"` };
        }
      }
      
      // 2) Try buttons with send/submit text
      const textButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const btn of textButtons) {
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (txt.includes('send') || txt.includes('submit')) {
          if (excludeText.some((ex) => txt.includes(ex))) continue;
          
          const style = window.getComputedStyle(btn);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            btn.click();
            return { clicked: true, method: `text button: "${txt}"` };
          }
        }
      }
      
      // 3) Try small icon buttons near bottom-right (common UI pattern for send)
      for (const btn of textButtons) {
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (txt && txt.length > 3) continue; // skip buttons with text
        if (excludeText.some((ex) => txt.includes(ex))) continue;
        
        const rect = btn.getBoundingClientRect();
        const svg = btn.querySelector('svg');
        
        // Bottom-right quadrant, small button with SVG
        if (svg && rect.bottom > window.innerHeight * 0.6 && rect.right > window.innerWidth * 0.6 && rect.width < 80) {
          const style = window.getComputedStyle(btn);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            btn.click();
            return { clicked: true, method: 'bottom-right icon button' };
          }
        }
      }
      
      return { clicked: false, method: '' };
    });
    
    if (clicked.clicked) {
      console.log(`[click] ✓ Clicked Submit (${clicked.method})`);
      return true;
    }
    
    // Last resort: press Enter
    console.log('[click] No Submit button found, pressing Enter as fallback');
    await page.keyboard.press('Enter');
    console.log('[click] ✓ Pressed Enter to submit');
    return true;
  } catch (err) {
    console.error(`[click] Error clicking Submit: ${err?.message || err}`);
    return false;
  }
}

/**
 * Fill password field if present
 * Returns true if password was filled, false otherwise
 */
async function fillPassword(page, password) {
  if (!password) return false;
  
  try {
    console.log('[click] Looking for password field...');
    
    const passwordSelectors = [
      'input[type="password"]',
      'input[placeholder*="password" i]',
      'input[aria-label*="password" i]',
      'input[name*="password" i]',
      'input[id*="password" i]'
    ];
    
    for (const selector of passwordSelectors) {
      const handles = await page.$$(selector);
      for (const h of handles) {
        if (await isVisible(h)) {
          const currentValue = await h.evaluate((el) => el.value || '');
          if (currentValue.trim().length > 0) {
            console.log('[click] Password field already filled, skipping');
            return false;
          }
          
          await h.click({ clickCount: 3 });
          // Type password with human-like speed
          for (const char of password) {
            await page.keyboard.type(char, { delay: 0 });
            await new Promise((r) => setTimeout(r, 60 + Math.random() * 40)); // 60-100ms per char
          }
          console.log('[click] ✓ Filled password field');
          return true;
        }
      }
    }
    
    return false;
  } catch (err) {
    console.error(`[click] Error filling password: ${err?.message || err}`);
    return false;
  }
}

/**
 * Select English (or first option) in language dropdown/radio/text input if present
 * Returns true if interacted, false otherwise
 */
async function selectLanguage(page) {
  try {
    // Strategy 1: Native select dropdown - use Puppeteer API with aggressive event firing
    const selects = await page.$$('select');
    for (const sel of selects) {
      const visible = await isVisible(sel);
      if (!visible) continue;
      
      const info = await sel.evaluate((el) => {
        const lbl = (el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('id') || el.labels?.[0]?.innerText || '').toLowerCase();
        const parentText = (el.parentElement?.innerText || '').toLowerCase();
        const options = Array.from(el.options).map((o) => ({ text: o.text, value: o.value }));
        return { label: lbl, parent: parentText, options };
      });
      
      if (info.label.includes('language') || info.label.includes('lang') || info.parent.includes('language')) {
        const englishOption = info.options.find((o) => o.text.toLowerCase().includes('english') || o.value.toLowerCase().includes('english'));
        
        await sel.focus();
        await sel.click(); // open
        await new Promise((r) => setTimeout(r, 400));
        
        if (englishOption) {
          await sel.select(englishOption.value);
        } else if (info.options.length > 0) {
          await sel.select(info.options[0].value);
        }
        
        // Fire all possible events
        await sel.evaluate((s) => {
          s.dispatchEvent(new Event('change', { bubbles: true }));
          s.dispatchEvent(new Event('input', { bubbles: true }));
          s.dispatchEvent(new Event('blur', { bubbles: true }));
          s.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        
        await sel.press('Enter').catch(() => {}); // submit if needed
        
        console.log('[click] ✓ Language native dropdown: opened and selected English');
        return true;
      }
    }
    
    // Strategy 2: Custom dropdown (click container with "English" text, wait, then click option)
    const customDropdownResult = await page.evaluate(() => {
      // Find containers that show "English" and have language-related context
      const containers = Array.from(document.querySelectorAll('div, button, [role="button"], [role="combobox"]'));
      for (const container of containers) {
        const txt = (container.innerText || container.textContent || '').trim();
        const ariaLabel = (container.getAttribute('aria-label') || '').toLowerCase();
        const parent = container.parentElement;
        const parentText = parent ? (parent.innerText || parent.textContent || '').trim().toLowerCase() : '';
        
        // Check if this is a language dropdown trigger
        if ((parentText.includes('language') || ariaLabel.includes('language') || txt.toLowerCase().includes('select')) 
            && txt.toLowerCase().includes('english')) {
          const style = window.getComputedStyle(container);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            container.click(); // open dropdown
            return { opened: true, containerText: txt };
          }
        }
      }
      return { opened: false, containerText: '' };
    });
    
    if (customDropdownResult.opened) {
      console.log(`[click] ✓ Language opened custom dropdown`);
      await new Promise((r) => setTimeout(r, 600)); // wait for dropdown options to appear
      
      // Now click the English option from the list
      const optionClicked = await page.evaluate(() => {
        const options = Array.from(document.querySelectorAll('li, [role="option"], div[class*="option"], [class*="menu"] div, [class*="dropdown"] div, [class*="item"]'));
        for (const opt of options) {
          const optText = (opt.innerText || opt.textContent || '').trim().toLowerCase();
          if (optText === 'english' || optText === 'en') {
            const style = window.getComputedStyle(opt);
            if (style.display !== 'none' && style.visibility !== 'hidden' && opt.offsetParent !== null) {
              opt.click();
              // Fire events on the option
              opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              opt.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      });
      
      if (optionClicked) {
        console.log('[click] ✓ Language selected English from custom dropdown');
        await new Promise((r) => setTimeout(r, 300));
        // Press Enter to confirm selection
        await page.keyboard.press('Enter').catch(() => {});
        return true;
      }
    }
    
    // Strategy 3: Text input
    const inputs = await page.$$('input[type="text"], input:not([type])');
    for (const input of inputs) {
      const visible = await isVisible(input);
      if (!visible) continue;
      
      const label = await input.evaluate((el) => {
        const lbl = (el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('id') || el.labels?.[0]?.innerText || el.placeholder || '').toLowerCase();
        const parentText = (el.parentElement?.innerText || '').toLowerCase();
        return lbl + ' ' + parentText;
      });
      
      if (label.includes('language') || label.includes('lang')) {
        const currentValue = await input.evaluate((el) => el.value || '');
        if (!currentValue.trim()) {
          await input.click();
          for (const char of 'English') {
            await page.keyboard.type(char, { delay: 0 });
            await new Promise((r) => setTimeout(r, 60 + Math.random() * 40));
          }
          console.log('[click] ✓ Language typed "English" into text field');
          return true;
        }
      }
    }
    
    // Strategy 4: Last resort - evaluated click on native select
    const selected = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const sel of selects) {
        const style = window.getComputedStyle(sel);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        
        const label = (sel.getAttribute('aria-label') || sel.getAttribute('name') || sel.getAttribute('id') || sel.labels?.[0]?.innerText || '').toLowerCase();
        const parentText = (sel.parentElement?.innerText || '').toLowerCase();
        
        if (label.includes('language') || label.includes('lang') || parentText.includes('language') || parentText.includes('preferred language')) {
          const options = Array.from(sel.options);
          const english = options.find((o) => (o.text || o.value || '').toLowerCase().includes('english'));
          
          // Always physically interact: focus, click to open, select, blur
          sel.focus();
          sel.click(); // open dropdown
          
          if (english) {
            sel.value = english.value;
            sel.selectedIndex = Array.from(sel.options).indexOf(english);
          } else if (options.length > 0) {
            sel.selectedIndex = 0;
          }
          
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.blur();
          
          return english ? `dropdown: opened and selected ${english.text}` : `dropdown: opened and selected first option`;
        }
      }
      
      // Try radio buttons
      const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
      for (const radio of radios) {
        const label = radio.labels?.[0]?.innerText || radio.getAttribute('aria-label') || '';
        if (label.toLowerCase().includes('english')) {
          if (!radio.checked) {
            radio.click();
            return `radio: selected English`;
          }
        }
      }
      
      // Try clicking visible "English" text
      const clickables = Array.from(document.querySelectorAll('div, span, label, [role="button"]'));
      for (const el of clickables) {
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (txt === 'english' || txt === 'en') {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            el.click();
            return `clicked English option`;
          }
        }
      }
      
      return null;
    });
    
    if (selected) {
      console.log(`[click] ✓ Language ${selected}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[click] Error selecting language: ${err?.message || err}`);
    return false;
  }
}

/**
 * Log current page snapshot for debugging stuck states
 */
async function logPageSnapshot(page, label = 'snapshot') {
  try {
    const info = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body?.innerText?.slice(0, 500) || '',
        visibleButtons: Array.from(document.querySelectorAll('button, [role="button"], a'))
          .filter((el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map((el) => ({
            text: (el.innerText || el.textContent || '').trim(),
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            type: el.type || el.tagName
          }))
          .filter((b) => b.text)
          .slice(0, 10),
        visibleInputs: Array.from(document.querySelectorAll('input, select, textarea'))
          .filter((el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map((el) => ({
            tag: `${el.tagName}[type=${el.type || 'N/A'}]`,
            value: el.value || '',
            required: el.required || el.getAttribute('aria-required') === 'true',
            valid: el.validity?.valid !== false
          }))
          .slice(0, 10),
        validationErrors: Array.from(document.querySelectorAll('[role="alert"], .error, [class*="error"]'))
          .map((el) => (el.innerText || el.textContent || '').trim())
          .filter(Boolean)
          .slice(0, 5),
        formData: Array.from(document.querySelectorAll('form')).map((form) => ({
          action: form.action,
          method: form.method,
          valid: form.checkValidity?.() !== false
        }))
      };
    });
    console.log(`[snapshot-${label}] title="${info.title}"`);
    console.log(`[snapshot-${label}] visible buttons:`, JSON.stringify(info.visibleButtons, null, 2));
    console.log(`[snapshot-${label}] visible inputs:`, JSON.stringify(info.visibleInputs, null, 2));
    if (info.validationErrors.length > 0) {
      console.log(`[snapshot-${label}] validation errors:`, info.validationErrors);
    }
    if (info.formData.length > 0) {
      console.log(`[snapshot-${label}] forms:`, JSON.stringify(info.formData, null, 2));
    }
  } catch (e) {
    console.error(`[snapshot] failed: ${e?.message || e}`);
  }
}

/**
 * Click confirmation buttons after language/password (OK, Confirm, checkmark, etc.)
 * Returns true if clicked
 */
async function clickConfirmation(page, { blockedButtons = new Set() } = {}) {
  try {
    const result = await page.evaluate((blocked) => {
      const confirmTexts = ['ok', 'confirm', 'submit', 'done', '✓', '✔'];
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (confirmTexts.some((t) => txt === t || txt.includes(t))) {
          if (blocked.includes(txt)) continue;
          
          const style = window.getComputedStyle(btn);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            btn.click();
            return { clicked: true, text: txt };
          }
        }
      }
      return { clicked: false, text: '' };
    }, Array.from(blockedButtons));
    
    if (result.clicked) {
      console.log(`[click] ✓ Clicked confirmation button: "${result.text}"`);
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[click] Error clicking confirmation: ${err?.message || err}`);
    return false;
  }
}

/**
 * Try all methods to progress through the interview intro
 * Returns { progressed: boolean, buttonClicked: string }
 */
async function tryProgress(page, { password = '', blockedButtons = new Set() } = {}) {
  let progressed = false;
  let buttonClicked = '';
  
  // 1) Fill password
  if (password && await fillPassword(page, password)) progressed = true;
  
  // 2) Select language
  const langSelected = await selectLanguage(page);
  if (langSelected) {
    progressed = true;
    // After selecting language, try to click confirmation button
    await new Promise((r) => setTimeout(r, 300));
    if (await clickConfirmation(page, { blockedButtons })) progressed = true;
  }
  
  // 3) Click start/continue buttons (with known text patterns)
  const clickResult = await clickGetStarted(page, { blockedButtons });
  if (clickResult.clicked) {
    progressed = true;
    buttonClicked = clickResult.buttonText;
  }
  
  // 4) If nothing worked, try clicking any primary-looking button (as last resort)
  if (!clickResult.clicked && blockedButtons.size > 0) {
    const anyButton = await page.evaluate((blocked) => {
      const buttons = Array.from(document.querySelectorAll('button[type="submit"], button:not([type]), [role="button"]'));
      for (const btn of buttons) {
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (blocked.includes(txt)) continue;
        
        const style = window.getComputedStyle(btn);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          // Click the first visible, non-blocked button
          btn.click();
          return { clicked: true, text: txt };
        }
      }
      return { clicked: false, text: '' };
    }, Array.from(blockedButtons));
    
    if (anyButton.clicked) {
      console.log(`[click] ✓ Clicked fallback button: "${anyButton.text}"`);
      progressed = true;
      buttonClicked = anyButton.text;
    }
  }
  
  return { progressed, buttonClicked };
}

module.exports = {
  clickGetStarted,
  clickSubmit,
  fillPassword,
  selectLanguage,
  clickConfirmation,
  tryProgress,
  logPageSnapshot
};


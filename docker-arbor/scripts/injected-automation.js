/**
 * Injected Automation Script
 * 
 * This script is injected into the interview page and handles:
 * - Auto-clicking progress buttons (Get Started, Continue, etc.)
 * - Filling password fields
 * - Audio capture from virtual_mic (interviewer audio)
 * - Audio playback to virtual_speaker (TTS response)
 * - Communication with the Node.js host process
 * 
 * Placeholders replaced at runtime:
 * - __PASSWORD__ - Interview password
 * - __GEMINI_API_KEY__ - Gemini API key
 */

(function() {
  'use strict';
  
  console.log('[arbor] Injected automation script starting...');
  
  // ============================================================
  // CONFIGURATION (replaced at runtime by page-controller.js)
  // ============================================================
  
  let PASSWORD = '__PASSWORD__';
  let GEMINI_API_KEY = '__GEMINI_API_KEY__';
  
  // Timing configuration
  const AUTO_CLICK_INTERVAL_MS = 2000;
  const AUDIO_CHUNK_DURATION_MS = 2000;
  const RESPONSE_DELAY_MS = 8000;  // Increased to 8 seconds to wait for complete questions
  const COOLDOWN_MS = 15000;
  
  // ============================================================
  // STATE
  // ============================================================
  
  let isInitialized = false;
  let tickCounter = 0;
  
  // Audio state
  let captureContext = null;
  let captureStream = null;
  let captureWorklet = null;
  let pcmBuffer = [];
  let isCapturing = false;
  let audioMerger = null;  // Channel merger for combining WebRTC downlink + virtual_mic_2
  
  // Playback state
  let playbackContext = null;
  const playbackQueue = [];
  let isPlayingTTS = false;
  let playbackBackoffUntil = 0;  // Block new TTS chunks until this timestamp
  
  // Conversation state
  let transcriptBuffer = '';
  let isWaitingForResponse = false;
  let responseTimer = null;
  let cooldownTimer = null;
  let noAudioTimer = null;  // Timer to check if agent didn't hear anything
  let lastTranscriptionTime = null;  // Track when we last heard from interviewer
  let lastQuestion = '';  // Track the last question asked to detect repeats
  let isInCooldown = false;  // Prevent multiple cooldown calls
  let hasAskedToRepeat = false;  // Prevent "no audio heard" loop
  
  // Audio file tracking
  let capturedAudioChunks = [];  // Accumulate captured audio chunks
  let responseAudioChunks = [];  // Accumulate response audio chunks
  let currentQuestionId = null;  // Track current question for file naming
  
  // Gemini WebSockets (separate for STT and TTS)
  let sttWs = null;       // STT: listens to interviewer audio
  let sttReady = false;
  let ttsWs = null;       // TTS: speaks the response
  let ttsReady = false;
  
  // Legacy alias
  let geminiWs = null;
  let geminiReady = false;
  
  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================
  
  function log(level, message) {
    const prefix = '[arbor]';
    const args = Array.prototype.slice.call(arguments, 1);
    
    switch (level) {
      case 'debug':
        console.debug.apply(console, [prefix].concat(args));
        break;
      case 'warn':
        console.warn.apply(console, [prefix].concat(args));
        break;
      case 'error':
        console.error.apply(console, [prefix].concat(args));
        break;
      default:
        console.log.apply(console, [prefix].concat(args));
    }
    
    // Forward to Node.js if available
    if (window.__arborLog) {
      try {
        window.__arborLog(level, args.join(' '));
      } catch (e) {
        // Ignore
      }
    }
  }
  
  // ============================================================
  // AUTO-CLICK AUTOMATION
  // ============================================================
  
  // Track what we've already done to avoid repeating
  let passwordFilled = false;
  let languageSelected = false;
  let lastClickedButton = '';
  
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           parseFloat(style.opacity || '1') > 0 &&
           rect.width > 0 && rect.height > 0;
  }
  
  function selectLanguage() {
    try {
      // Strategy 1: Native select dropdown
      const selects = document.querySelectorAll('select');
      for (let i = 0; i < selects.length; i++) {
        const sel = selects[i];
        if (!isVisible(sel)) continue;
        
        const label = (sel.getAttribute('aria-label') || sel.getAttribute('name') || sel.getAttribute('id') || '').toLowerCase();
        const parentText = sel.parentElement ? (sel.parentElement.innerText || '').toLowerCase() : '';
        
        if (label.includes('language') || label.includes('lang') || parentText.includes('language') || parentText.includes('preferred')) {
          const options = Array.from(sel.options);
          const englishOpt = options.find(function(o) { 
            return o.text.toLowerCase().includes('english') || o.value.toLowerCase().includes('english'); 
          });
          
          sel.focus();
          sel.click();
          
          if (englishOpt) {
            sel.value = englishOpt.value;
            sel.selectedIndex = options.indexOf(englishOpt);
          } else if (options.length > 0) {
            sel.selectedIndex = 0;
          }
          
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.blur();
          
          log('info', 'Selected language from native dropdown: ' + (englishOpt ? englishOpt.text : 'first option'));
          return true;
        }
      }
      
      // Strategy 2: Custom dropdown (click container, wait for options, click English)
      const dropdownTriggers = document.querySelectorAll('div, button, [role="button"], [role="combobox"], [role="listbox"]');
      for (let j = 0; j < dropdownTriggers.length; j++) {
        const trigger = dropdownTriggers[j];
        if (!isVisible(trigger)) continue;
        
        const txt = (trigger.innerText || trigger.textContent || '').trim().toLowerCase();
        const ariaLabel = (trigger.getAttribute('aria-label') || '').toLowerCase();
        const parent = trigger.parentElement;
        const parentTxt = parent ? (parent.innerText || parent.textContent || '').toLowerCase() : '';
        
        // Check if this looks like a language selector
        if ((parentTxt.includes('language') || ariaLabel.includes('language') || txt.includes('select')) && 
            (txt.includes('english') || txt === '' || txt.includes('choose'))) {
          trigger.click();
          log('info', 'Opened language dropdown');
          
          // Wait for options to appear, then click English
          setTimeout(function() {
            const opts = document.querySelectorAll('li, [role="option"], div[class*="option"], [class*="menu"] div, [class*="dropdown"] div, [class*="item"]');
            for (let k = 0; k < opts.length; k++) {
              const opt = opts[k];
              const optTxt = (opt.innerText || opt.textContent || '').trim().toLowerCase();
              if (optTxt === 'english' || optTxt === 'en' || optTxt.includes('english')) {
                if (isVisible(opt)) {
                  opt.click();
                  opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                  opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                  opt.dispatchEvent(new Event('change', { bubbles: true }));
                  log('info', 'Selected English from custom dropdown');
                  return;
                }
              }
            }
          }, 500);
          
          return true;
        }
      }
      
      // Strategy 3: Radio buttons
      const radios = document.querySelectorAll('input[type="radio"]');
      for (let m = 0; m < radios.length; m++) {
        const radio = radios[m];
        const radioLabel = radio.labels && radio.labels[0] ? radio.labels[0].innerText : (radio.getAttribute('aria-label') || '');
        if (radioLabel.toLowerCase().includes('english')) {
          if (!radio.checked) {
            radio.click();
            log('info', 'Selected English radio button');
            return true;
          }
        }
      }
      
      return false;
    } catch (e) {
      log('error', 'Language selection error:', e.message);
      return false;
    }
  }
  
  function runAutoClick() {
    try {
      tickCounter++;
      
      // Fill password field if present and empty (only once)
      if (!passwordFilled) {
        const pwd = document.querySelector('input[type="password"]');
        if (pwd && !pwd.value && PASSWORD) {
          pwd.focus();
          pwd.value = PASSWORD;
          pwd.dispatchEvent(new Event('input', { bubbles: true }));
          pwd.dispatchEvent(new Event('change', { bubbles: true }));
          log('info', 'Filled password field');
          passwordFilled = true;
        }
      }
      
      // Select language (only attempt a few times)
      if (!languageSelected && tickCounter < 30) {
        if (selectLanguage()) {
          languageSelected = true;
        }
      }
      
      // Click progress buttons
      const buttonTexts = [
        'let\'s get started',
        'get started',
        'start voice interview',
        'start voice',
        'start interview',
        'voice interview',
        'continue',
        'proceed',
        'next',
        'skip',
        'begin',
        'start',
        'ok',
        'confirm',
        'submit'
      ];
      
      const buttons = document.querySelectorAll('button, [role="button"], a');
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const txt = (btn.innerText || btn.textContent || '').toLowerCase().trim();
        
        // Skip if we just clicked this button
        if (txt === lastClickedButton) continue;
        
        if (buttonTexts.some(function(t) { return txt.includes(t); })) {
          if (isVisible(btn)) {
            btn.click();
            lastClickedButton = txt;
            log('info', 'Clicked button: "' + txt.slice(0, 30) + '"');
            
            // Reset after a delay to allow clicking same button again if needed
            setTimeout(function() { lastClickedButton = ''; }, 3000);
            break;
          }
        }
      }
      
    } catch (e) {
      log('error', 'Auto-click error:', e.message);
    }
  }
  
  // ============================================================
  // AUDIO CAPTURE (from page's audio/video elements - Umi's voice)
  // ============================================================
  
  let mediaElementMonitorInterval = null;
  
  async function startAudioCapture() {
    if (isCapturing) return;
    
    try {
      log('info', 'Starting audio capture (PRIMARY: WebRTC downlink, BACKUP: virtual_mic_2)...');
      
      captureContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create a destination to merge all audio sources (WebRTC downlink + virtual_mic_2)
      audioMerger = captureContext.createChannelMerger(2);
      
      // ============================================================
      // PRIMARY INPUT CAPTURE: WebRTC DOWNLINK (Umi's voice)
      // WebRTC downlink track → MediaStreamSource → Capture
      // This is the MAIN path - WebRTC audio doesn't play to speakers
      // ============================================================
      // Note: WebRTC downlink capture is handled in interceptWebRTC()
      // when the 'track' event fires. See pc.addEventListener('track') below.
      
      // ============================================================
      // BACKUP INPUT CAPTURE: virtual_mic_2 (browser audio output)
      // Browser audio output → virtual_speaker_2 → virtual_mic_2 → Capture
      // This is a FALLBACK path in case WebRTC capture fails
      // ============================================================
      
      // Enumerate devices and find virtual_mic_2 for backup
      const devices = await navigator.mediaDevices.enumerateDevices();
      const virtualMic2 = devices.find(function(d) {
        return d.kind === 'audioinput' && 
               (d.label.toLowerCase().includes('virtual_mic_2') || 
                d.label.toLowerCase().includes('virtual mic 2') ||
                d.label.toLowerCase().includes('virtual-mic-2') ||
                d.label.toLowerCase().includes('virtual_mic_2_input'));
      });
      
      if (virtualMic2) {
        log('info', '✓ Found virtual_mic_2 (backup capture path):', virtualMic2.label);
        
        try {
          // Capture from virtual_mic_2 as backup (browser audio output)
          const captureStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: virtualMic2.deviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              googEchoCancellation: false,
              googAutoGainControl: false,
              googNoiseSuppression: false,
              googHighpassFilter: false,
            },
            video: false
          });
          
          // Connect virtual_mic_2 stream to audioMerger (backup path)
          const captureSource = captureContext.createMediaStreamSource(captureStream);
          captureSource.connect(audioMerger);
          log('info', '✓ Connected virtual_mic_2 to capture pipeline (backup path)');
        } catch (e) {
          log('warn', '⚠️ Failed to connect virtual_mic_2 (backup):', e.message, '- will rely on WebRTC downlink only');
        }
      } else {
        log('warn', '⚠️ virtual_mic_2 not found - will rely on WebRTC downlink only');
      }
      
      // === TTS OUTPUT TO WEBRTC ===
      // Create an AudioContext for TTS output to WebRTC
      const ttsOutputContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      const ttsMediaStreamDestination = ttsOutputContext.createMediaStreamDestination();
      const ttsOutputStream = ttsMediaStreamDestination.stream;
      let activePeerConnection = null;
      let originalMicTrack = null;
      
      log('info', '🔊 TTS output stream created for WebRTC injection');
      
      // Function to play TTS audio directly to WebRTC
      window.__arborPlayTTSToWebRTC = async function(pcmData, sampleRate) {
        try {
          // Resume context if suspended
          if (ttsOutputContext.state === 'suspended') {
            await ttsOutputContext.resume();
          }
          
          // Convert Int16 PCM to Float32
          const float32Data = new Float32Array(pcmData.length);
          for (let i = 0; i < pcmData.length; i++) {
            float32Data[i] = pcmData[i] / 32768;
          }
          
          // Create audio buffer
          const audioBuffer = ttsOutputContext.createBuffer(1, float32Data.length, sampleRate);
          audioBuffer.getChannelData(0).set(float32Data);
          
          // Play to the media stream destination
          const source = ttsOutputContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ttsMediaStreamDestination);
          source.start();
          
          // Wait for playback to complete
          return new Promise(function(resolve) {
            source.onended = resolve;
            setTimeout(resolve, (float32Data.length / sampleRate) * 1000 + 50);
          });
        } catch (e) {
          log('error', 'TTS to WebRTC error:', e.message);
        }
      };
      
      // Intercept RTCPeerConnection to capture WebRTC audio AND inject our TTS
      function interceptWebRTC() {
        if (window._arborWebRTCIntercepted) return;
        window._arborWebRTCIntercepted = true;
        
        const OriginalRTCPeerConnection = window.RTCPeerConnection;
        
        window.RTCPeerConnection = function(config) {
          const pc = new OriginalRTCPeerConnection(config);
          activePeerConnection = pc; // Store reference for TTS injection
          
          log('info', '📡 RTCPeerConnection created - will inject TTS audio');
          
          pc.addEventListener('track', function(event) {
            if (event.track.kind === 'audio') {
              log('info', '🎤 WebRTC DOWNLINK audio track received - connecting to capture pipeline');
              
              try {
                const stream = new MediaStream([event.track]);
                const source = captureContext.createMediaStreamSource(stream);
                source.connect(audioMerger);  // Connect to existing merger
                log('info', '✓ Connected WebRTC downlink to capture (Umi voice)');
              } catch (e) {
                log('error', 'Failed to capture WebRTC downlink:', e.message);
              }
            }
          });
          
          // Override addTrack to intercept and replace microphone track
          // IMPORTANT: virtual_mic is used for WebRTC UPLINK only (so interview platform hears TTS)
          // The audio flows: paplay → virtual_speaker → virtual_mic → browser → WebRTC uplink
          // Input capture uses WebRTC DOWNLINK tracks (separate path, no feedback loop)
          const originalAddTrack = pc.addTrack.bind(pc);
          pc.addTrack = function(track, ...streams) {
            if (track.kind === 'audio') {
              log('info', '🎙️ Audio track being added (using virtual_mic from PulseAudio for WebRTC uplink)');
              originalMicTrack = track;
            }
            return originalAddTrack(track, ...streams);
          };
          
          return pc;
        };
        
        // Copy prototype
        window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
        
        // Intercept getUserMedia to route WebRTC UPLINK through virtual_mic
        // IMPORTANT: This is for WebRTC UPLINK only (so interview platform hears TTS)
        // - virtual_mic monitors virtual_speaker (where TTS plays)
        // - This allows TTS to reach the interview platform via WebRTC
        // - Input capture uses WebRTC DOWNLINK (separate, isolated path)
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async function(constraints) {
          if (constraints.audio) {
            log('info', '🎙️ getUserMedia called - routing WebRTC UPLINK through virtual_mic (TTS output path)');
            
            // Find virtual_mic device (monitors virtual_speaker for TTS output)
            const devices = await navigator.mediaDevices.enumerateDevices();
            const virtualMic = devices.find(function(d) {
              return d.kind === 'audioinput' && 
                     (d.label.toLowerCase().includes('virtual_mic') || 
                      d.label.toLowerCase().includes('virtual mic') ||
                      d.label.toLowerCase().includes('virtual-mic'));
            });
            
            if (virtualMic) {
              log('info', '✓ Found virtual_mic for WebRTC UPLINK:', virtualMic.label, virtualMic.deviceId);
            } else {
              log('warn', '⚠️ virtual_mic not found! Available devices:');
              devices.filter(function(d) { return d.kind === 'audioinput'; })
                     .forEach(function(d) { log('warn', '  -', d.label || d.deviceId); });
            }
            
            // If audio is just 'true', replace with detailed constraints
            if (constraints.audio === true) {
              constraints.audio = {};
            }
            
            // Force virtual_mic for WebRTC UPLINK and disable audio processing
            // Note: Input capture uses WebRTC DOWNLINK (separate path, no feedback)
            constraints.audio = {
              ...constraints.audio,
              deviceId: virtualMic ? { exact: virtualMic.deviceId } : undefined,
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              googEchoCancellation: false,
              googAutoGainControl: false,
              googNoiseSuppression: false,
              googHighpassFilter: false,
            };
            
            log('info', '🔧 Audio constraints for WebRTC UPLINK:', JSON.stringify(constraints.audio));
          }
          
          const stream = await originalGetUserMedia(constraints);
          
          if (constraints.audio) {
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
              originalMicTrack = audioTrack;
              log('info', '✓ WebRTC UPLINK track captured (virtual_mic - TTS output path):', audioTrack.label);
            }
          }
          
          return stream;
        };
        
        log('info', 'WebRTC interceptor installed (with audio processing disabled)');
      }
      
      // Install WebRTC interceptor early (for TTS output to WebRTC uplink)
      interceptWebRTC();
      
      // Note: We no longer capture from media elements or WebRTC streams
      // All input capture now comes from virtual_mic_2 (browser audio output)
      
      // Calculate samples per chunk
      const samplesPerChunk = Math.floor(captureContext.sampleRate * AUDIO_CHUNK_DURATION_MS / 1000);
      
      log('info', 'Capture sample rate:', captureContext.sampleRate);
      
      // Create AudioWorklet processor
      const workletCode = [
        'class PCMCaptureProcessor extends AudioWorkletProcessor {',
        '  process(inputs, outputs, parameters) {',
        '    if (inputs[0] && inputs[0][0]) {',
        '      this.port.postMessage(inputs[0][0]);',
        '    }',
        '    return true;',
        '  }',
        '}',
        'registerProcessor("pcm-capture-processor", PCMCaptureProcessor);'
      ].join('\n');
      
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      
      await captureContext.audioWorklet.addModule(url);
      captureWorklet = new AudioWorkletNode(captureContext, 'pcm-capture-processor');
      
      // Handle incoming audio samples from virtual_mic_2 (browser audio output)
      // IMPORTANT: This captures browser audio output (separate from TTS output path)
      // - TTS output: virtual_speaker → virtual_mic → WebRTC UPLINK (interview hears TTS)
      // - Input capture: Browser audio → virtual_speaker_2 → virtual_mic_2 → This capture → STT
      // These are isolated paths, but we gate during TTS as extra safety
      captureWorklet.port.onmessage = function(event) {
        if (isPlayingTTS || isWaitingForResponse) {
          // Extra safety: Skip capture during TTS/cooldown (even though paths are isolated)
          return;
        }
        
        const samples = event.data;
        
        // Check if there's actual audio (not silence)
        // Lowered threshold from 0.01 to 0.001 to catch quieter audio
        let hasAudio = false;
        let maxAmplitude = 0;
        for (let i = 0; i < samples.length; i++) {
          const amp = Math.abs(samples[i]);
          if (amp > maxAmplitude) maxAmplitude = amp;
          if (amp > 0.001) {  // Lowered threshold for better sensitivity
            hasAudio = true;
            break;
          }
        }
        
        // Debug: Log occasionally to verify audio is being captured
        if (Math.random() < 0.01) {  // Log ~1% of chunks for debugging
          log('debug', 'Audio chunk stats - maxAmplitude:', maxAmplitude.toFixed(4), 'hasAudio:', hasAudio, 'samples:', samples.length);
        }
        
        if (!hasAudio) return; // Skip silent chunks
        
        // Convert Float32 to Int16
        for (let i = 0; i < samples.length; i++) {
          const s = Math.max(-1, Math.min(1, samples[i]));
          pcmBuffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
        }
        
        // Check if we have enough samples for a chunk
        if (pcmBuffer.length >= samplesPerChunk) {
          const chunk = pcmBuffer.slice(0, samplesPerChunk);
          pcmBuffer.splice(0, samplesPerChunk);
          sendAudioToLLM(chunk, captureContext.sampleRate);
        }
      };
      
      // Connect audioMerger to capture worklet
      audioMerger.connect(captureWorklet);
      
      isCapturing = true;
      log('info', '✓ Audio capture started (PRIMARY: WebRTC downlink, BACKUP: virtual_mic_2)');
      
    } catch (e) {
      log('error', 'Failed to start audio capture:', e.message);
    }
  }
  
  function stopAudioCapture() {
    if (!isCapturing) return;
    
    isCapturing = false;
    
    if (mediaElementMonitorInterval) {
      clearInterval(mediaElementMonitorInterval);
      mediaElementMonitorInterval = null;
    }
    
    if (captureWorklet) {
      captureWorklet.disconnect();
      captureWorklet = null;
    }
    
    if (captureContext) {
      captureContext.close();
      captureContext = null;
    }
    
    if (captureStream) {
      captureStream.getTracks().forEach(function(t) { t.stop(); });
      captureStream = null;
    }
    
    pcmBuffer = [];
    log('info', 'Audio capture stopped');
  }
  
  // ============================================================
  // AUDIO PLAYBACK (to virtual_speaker)
  // ============================================================
  
  // ============================================================
  // AUDIO PLAYBACK - Play through PulseAudio for REAL audio flow
  // TTS → PulseAudio Speaker → PulseAudio Mic → Interview
  // ============================================================
  
  function playAudioBase64(base64Data, sampleRate) {
    sampleRate = sampleRate || 24000;
    console.log('[arbor] playAudioBase64 called, queue length:', playbackQueue.length, 'isPlaying:', isPlayingTTS);

    // Check if we're in backoff period (after PulseAudio errors)
    const now = Date.now();
    if (playbackBackoffUntil > now) {
      const remainingMs = playbackBackoffUntil - now;
      console.log('[arbor] In backoff period, rejecting chunk (', remainingMs, 'ms remaining)');
      return; // Reject chunk during backoff
    }

    // Accumulate response audio chunks for saving
    responseAudioChunks.push(base64Data);

    // Queue for sequential playback
    playbackQueue.push({ data: base64Data, rate: sampleRate });

    // ✅ ATOMIC CHECK: Only start processing if queue was empty BEFORE we added our chunk
    // This prevents multiple concurrent calls even within the same event loop tick
    // If queue.length === 1, we're the first chunk - start processing
    // If queue.length > 1, another chunk is already being processed - let it continue
    if (playbackQueue.length === 1 && !isPlayingTTS) {
      isPlayingTTS = true;
      console.log('[arbor] Starting playNextFromQueue (queue was empty, we are first)...');
      playNextFromQueue();
    } else {
      console.log('[arbor] Chunk queued (processor already running, queue:', playbackQueue.length, ')');
    }
  }
  
  async function playNextFromQueue() {
    console.log('[arbor] playNextFromQueue called, queue:', playbackQueue.length);
    
    if (playbackQueue.length === 0) {
      isPlayingTTS = false;
      
      // Save response audio file when playback completes
      if (responseAudioChunks.length > 0 && currentQuestionId && window.__arborSaveAudioFile) {
        // Combine all response chunks
        const combinedBase64 = responseAudioChunks.join('');
        
        // Save response audio file
        window.__arborSaveAudioFile(combinedBase64, `response_audio_${currentQuestionId}.pcm`, 24000).catch(e => {
          log('warn', 'Failed to save response audio:', e.message);
        });
        
        // Clear response chunks
        responseAudioChunks = [];
        currentQuestionId = null;
      }
      
      startCooldown();
      return;
    }
    
    // Remove this line - flag already set in playAudioBase64
    // isPlayingTTS = true;
    const item = playbackQueue.shift();
    
    try {
      // Decode base64 to Int16 PCM for WebRTC injection
      const binaryString = atob(item.data);
      const pcmData = new Int16Array(binaryString.length / 2);
      for (let i = 0; i < pcmData.length; i++) {
        pcmData[i] = binaryString.charCodeAt(i * 2) | (binaryString.charCodeAt(i * 2 + 1) << 8);
      }
      
      // Check available audio bridges
      const hasPaplayBridge = typeof window.__arborPlayAudio === 'function';
      const hasWebRTCBridge = typeof window.__arborPlayTTSToWebRTC === 'function';
      
      console.log('[arbor] Audio bridges - paplay:', hasPaplayBridge ? 'YES' : 'NO', 'WebRTC:', hasWebRTCBridge ? 'YES' : 'NO');
      
      // ============================================================
      // PRIMARY: Play via paplay (Real Audio Flow)
      // TTS → PulseAudio speaker → loopback → virtual mic → browser → Umi
      // This gives a real customer experience
      // ============================================================
      if (hasPaplayBridge) {
        console.log('[arbor] PRIMARY: Playing via paplay (real audio flow to Umi)');
        try {
          await window.__arborPlayAudio(item.data, item.rate);
          console.log('[arbor] paplay completed');
        } catch (error) {
          log('error', 'TTS playback failed:', error.message);
          log('error', 'Stopping TTS queue - PulseAudio may be down');
          // Clear the queue to prevent burning through all chunks
          playbackQueue.length = 0;
          isPlayingTTS = false;
          // Notify that audio failed
          log('warn', '⚠️ TTS audio playback failed. Interview may be stuck. Check PulseAudio status.');
          throw error; // Re-throw to stop processing
        }
      }
      
      // ============================================================
      // SECONDARY/FALLBACK: WebRTC injection (if paplay fails)
      // Only used as backup - directly injects into WebRTC stream
      // ============================================================
       else {
        console.warn('[arbor] paplay bridge not available! Audio will not reach Umi.');
        console.warn('[arbor] Make sure __arborPlayAudio is exposed from Node.js');

      }
    } catch (e) {
      console.error('[arbor] Playback error:', e.message);
      // If it's a critical error (PulseAudio down), stop the queue AND enable backoff
      if (e.message && (e.message.includes('PulseAudio') || e.message.includes('TTS playback failed'))) {
        playbackQueue.length = 0;
        isPlayingTTS = false;

        // Enable 5-second backoff to prevent rapid chunk arrivals from causing race condition
        playbackBackoffUntil = Date.now() + 5000;
        log('error', 'CRITICAL: TTS playback failed. Stopping queue and entering 5s backoff period.');
        return; // Don't continue processing
      }
    }
    
    // Continue with next chunk immediately (playback already awaited above)
    if (isPlayingTTS) {
      playNextFromQueue();  // No setTimeout - we already awaited paplay completion
    }
  }
  
  async function playViaBrowser(base64Data, sampleRate) {
    if (!playbackContext) {
      playbackContext = new (window.AudioContext || window.webkitAudioContext)();
      log('info', '🔊 Browser AudioContext created');
    }
    
    // Decode base64 to raw bytes
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    
    // Convert Int16 PCM to Float32
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let j = 0; j < pcm16.length; j++) {
      float32[j] = pcm16[j] / 32768.0;
    }
    
    // Create audio buffer
    const buffer = playbackContext.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);
    
    return new Promise(function(resolve) {
      const source = playbackContext.createBufferSource();
      source.buffer = buffer;
      
      const gain = playbackContext.createGain();
      gain.gain.value = 5.0;  // Boost volume
      
      source.connect(gain);
      gain.connect(playbackContext.destination);
      
      source.onended = resolve;
      source.start(0);
    });
  }
  
  // Expose for external calls
  window.__arborPlayTTS = playAudioBase64;
  
  // ============================================================
  // GEMINI LIVE API - STT (Speech-to-Text) CONNECTION
  // ============================================================
  
  function connectSTT() {
    log('info', 'Connecting STT WebSocket...');
    
    // Get API key from config
    const apiKey = window.__ARBOR_CONFIG && window.__ARBOR_CONFIG.GEMINI_API_KEY 
      ? window.__ARBOR_CONFIG.GEMINI_API_KEY 
      : GEMINI_API_KEY;
    
    if (!apiKey || apiKey.length < 10 || !apiKey.startsWith('AIza')) {
      log('warn', 'No valid Gemini API key provided, STT disabled');
      return;
    }
    
    GEMINI_API_KEY = apiKey;
    
    const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(apiKey);
    
    sttWs = new WebSocket(url);
    geminiWs = sttWs; // Legacy alias
    
    sttWs.onopen = function() {
      log('info', '[STT] WebSocket connected');
      
      // STT setup: TEXT modality + input transcription
      sttWs.send(JSON.stringify({
        setup: {
          model: 'models/gemini-2.0-flash-exp',
          generation_config: {
            response_modalities: ['TEXT']
          },
          input_audio_transcription: {}
        }
      }));
    };
    
    sttWs.onmessage = async function(event) {
      try {
        const txt = typeof event.data === 'string' ? event.data : await event.data.text();
        const data = JSON.parse(txt);
        
        if (data.setupComplete) {
          sttReady = true;
          geminiReady = true;
          log('info', '[STT] ✓ Ready to listen');
          return;
        }
        
        if (data.serverContent) {
          handleSTTResponse(data.serverContent);
        }
      } catch (e) {
        log('error', '[STT] Parse error:', e.message);
      }
    };
    
    sttWs.onerror = function(err) {
      log('error', '[STT] WebSocket error:', err.message || err);
    };
    
    sttWs.onclose = function(ev) {
      sttReady = false;
      geminiReady = false;
      log('info', '[STT] WebSocket closed:', ev.code);
      setTimeout(connectSTT, 5000);
    };
  }
  
  // ============================================================
  // GEMINI LIVE API - TTS (Text-to-Speech) CONNECTION
  // ============================================================
  
  function connectTTS() {
    log('info', 'Connecting TTS WebSocket...');
    
    const apiKey = window.__ARBOR_CONFIG && window.__ARBOR_CONFIG.GEMINI_API_KEY 
      ? window.__ARBOR_CONFIG.GEMINI_API_KEY 
      : GEMINI_API_KEY;
    
    if (!apiKey || apiKey.length < 10) {
      log('warn', 'No valid Gemini API key for TTS');
      return;
    }
    
    const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(apiKey);
    
    ttsWs = new WebSocket(url);
    
    ttsWs.onopen = function() {
      log('info', '[TTS] WebSocket connected');
      
      // TTS setup: AUDIO modality with voice config
      ttsWs.send(JSON.stringify({
        setup: {
          model: 'models/gemini-2.0-flash-exp',
          generation_config: {
            response_modalities: ['AUDIO'],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: {
                  voice_name: 'Puck'
                }
              }
            }
          }
        }
      }));
    };
    
    ttsWs.onmessage = async function(event) {
      try {
        const txt = typeof event.data === 'string' ? event.data : await event.data.text();
        const data = JSON.parse(txt);
        
        if (data.setupComplete) {
          ttsReady = true;
          log('info', '[TTS] ✓ Ready to speak');
          return;
        }
        
        // Handle audio response
        if (data.serverContent && data.serverContent.modelTurn) {
          const parts = data.serverContent.modelTurn.parts || [];
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/')) {
              log('info', '[TTS] Playing audio response...');
              playAudioBase64(part.inlineData.data);
            }
          }
        }
        
        // Turn complete
        if (data.serverContent && data.serverContent.turnComplete) {
          log('info', '[TTS] Response complete');
          isPlayingTTS = false;
          isWaitingForResponse = false;
        }
      } catch (e) {
        log('error', '[TTS] Parse error:', e.message);
      }
    };
    
    ttsWs.onerror = function(err) {
      log('error', '[TTS] WebSocket error:', err.message || err);
    };
    
    ttsWs.onclose = function(ev) {
      ttsReady = false;
      log('info', '[TTS] WebSocket closed:', ev.code);
      setTimeout(connectTTS, 5000);
    };
  }
  
  // Legacy alias for compatibility
  function connectGemini() {
    log('info', 'Starting Gemini connections (STT + TTS)...');
    log('info', 'API key first 10 chars:', GEMINI_API_KEY ? GEMINI_API_KEY.substring(0, 10) : 'checking...');
    connectSTT();
    connectTTS();
  }
  
  function processBufferedQuestion() {
    const question = transcriptBuffer.trim();
    if (question.length > 0) {
      log('info', '⏱️ Processing question...');
      
      // Save captured audio file before processing
      if (capturedAudioChunks.length > 0 && window.__arborSaveAudioFile) {
        const questionId = Date.now();
        currentQuestionId = questionId;
        
        // Combine all captured chunks
        const totalLength = capturedAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of capturedAudioChunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        
        // Convert to base64
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < combined.length; i += chunkSize) {
          const chunk = combined.subarray(i, Math.min(i + chunkSize, combined.length));
          binary += String.fromCharCode.apply(null, chunk);
        }
        const base64 = btoa(binary);
        
        // Get sample rate from capture context or default
        const sampleRate = (captureContext && captureContext.sampleRate) ? captureContext.sampleRate : 48000;
        
        // Save captured audio file
        window.__arborSaveAudioFile(base64, `captured_audio_${questionId}.pcm`, sampleRate).catch(e => {
          log('warn', 'Failed to save captured audio:', e.message);
        });
        
        // Save converted audio (same as captured for now)
        window.__arborSaveAudioFile(base64, `converted_audio_${questionId}.pcm`, sampleRate).catch(e => {
          log('warn', 'Failed to save converted audio:', e.message);
        });
        
        // Clear captured chunks
        capturedAudioChunks = [];
      }
      
      // Check if this is the same question as before
      if (isSameQuestion(question, lastQuestion)) {
        log('info', '🔄 Same question detected, asking to repeat...');
        askToRepeatQuestion();
      } else {
        // New question - store it and generate response
        lastQuestion = question;
        generateResponse(question);
      }
      
      transcriptBuffer = '';
    }
  }
  
  function handleSTTResponse(serverContent) {
    // Input transcription (interviewer's speech)
    if (serverContent.inputTranscription) {
      const text = serverContent.inputTranscription.text || serverContent.inputTranscription.transcript || '';
      
      if (text) {
        log('info', '📝 Interviewer:', text);
        
        // Always update transcription time and buffer - keep listening even while responding
        transcriptBuffer += ' ' + text;
        lastTranscriptionTime = Date.now();
        
        // Cancel "no audio heard" timer since we just heard something
        if (noAudioTimer) {
          clearTimeout(noAudioTimer);
          noAudioTimer = null;
          log('debug', 'Cancelled "no audio heard" timer - received transcription');
        }
        
        // Reset repeat flag when we hear something (Umi responded!)
        if (hasAskedToRepeat) {
          hasAskedToRepeat = false;
          log('debug', 'Reset repeat flag - received transcription after asking to repeat');
        }
        
        // Only process and respond if we're not currently playing TTS or waiting for response
        // But keep building the buffer so we don't miss anything
        if (!isPlayingTTS && !isWaitingForResponse) {
          // Reset response timer
          if (responseTimer) clearTimeout(responseTimer);
          
        // Wait for silence before responding
        responseTimer = setTimeout(function() {
          processBufferedQuestion();
        }, RESPONSE_DELAY_MS);
        }
      }
    }
  }
  
  // Legacy handler for backwards compatibility
  function handleGeminiResponse(serverContent) {
    handleSTTResponse(serverContent);
    
    // Audio response (TTS) - handled by TTS WebSocket now
    if (serverContent.modelTurn) {
      const parts = serverContent.modelTurn.parts || [];
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        
        if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/')) {
          playAudioBase64(part.inlineData.data, 24000);
        }
        
        if (part.text) {
          log('info', '💬 Response:', part.text.slice(0, 100));
        }
      }
    }
  }
  
  function sendAudioToLLM(pcmData, sampleRate) {
    if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN || !geminiReady) {
      log('debug', 'Cannot send audio - STT not ready (readyState:', geminiWs ? geminiWs.readyState : 'null', 'geminiReady:', geminiReady, ')');
      return;
    }
    
    try {
      // Debug: Log occasionally to verify audio is being sent
      if (Math.random() < 0.05) {  // Log ~5% of chunks for debugging
        log('debug', 'Sending audio chunk to STT - size:', pcmData.length, 'samples, rate:', sampleRate);
      }
      // Convert to Int16Array
      const pcm16 = new Int16Array(pcmData);
      const bytes = new Uint8Array(pcm16.buffer);
      
      // Accumulate captured audio chunks for saving
      capturedAudioChunks.push(bytes);
      
      // Convert to base64
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, chunk);
      }
      const base64 = btoa(binary);
      
      // Send to Gemini
      geminiWs.send(JSON.stringify({
        realtimeInput: {
          mediaChunks: [{
            mimeType: 'audio/pcm;rate=' + sampleRate,
            data: base64
          }]
        }
      }));
      
    } catch (e) {
      log('error', 'Send audio error:', e.message);
    }
  }
  
  function generateResponse(question) {
    if (isWaitingForResponse) return;
    
    isWaitingForResponse = true;
    // Note: Don't set isPlayingTTS here - let playAudioBase64 set it when audio arrives
    
    log('info', '🤔 Generating response for:', question.slice(0, 80));
    
    // Use TTS WebSocket to generate audio response
    if (ttsWs && ttsWs.readyState === WebSocket.OPEN && ttsReady) {
      log('info', '💬 Sending to TTS...');
      ttsWs.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{
              text: 'You are being interviewed for a job. Respond naturally and concisely (1-2 sentences max) to this question: ' + question
            }]
          }],
          turnComplete: true
        }
      }));
    } else {
      log('warn', 'TTS not ready, falling back to STT WebSocket');
      // Fallback to STT WebSocket (will return text, not audio)
      if (geminiWs && geminiWs.readyState === WebSocket.OPEN && geminiReady) {
        geminiWs.send(JSON.stringify({
          clientContent: {
            turns: [{
              role: 'user',
              parts: [{
                text: 'You are being interviewed. Respond naturally and concisely (1-2 sentences max) to this question: ' + question
              }]
            }],
            turnComplete: true
          }
        }));
      } else {
        log('error', 'Neither TTS nor STT WebSocket available');
        isWaitingForResponse = false;
        isPlayingTTS = false;
      }
    }
  }
  
  function startCooldown() {
    // Prevent multiple cooldown calls
    if (isInCooldown) {
      log('debug', 'Cooldown already in progress, skipping...');
      return;
    }
    
    log('debug', 'Starting cooldown...');
    isInCooldown = true;
    
    if (cooldownTimer) clearTimeout(cooldownTimer);
    
    cooldownTimer = setTimeout(function() {
      isPlayingTTS = false;
      isWaitingForResponse = false;
      
      // Check if we have buffered transcriptions that came in during cooldown
      if (transcriptBuffer.trim().length > 0) {
        log('info', '📝 Processing buffered transcriptions after cooldown...');
        // Process the buffered question after a short delay
        if (responseTimer) clearTimeout(responseTimer);
        responseTimer = setTimeout(function() {
          processBufferedQuestion();
        }, RESPONSE_DELAY_MS);
      } else {
        // No buffered transcriptions, clear the buffer and continue
        transcriptBuffer = '';
      }
      
      isInCooldown = false;
      hasAskedToRepeat = false;  // Reset repeat flag after cooldown
      log('info', '✓ Ready for next question');
      
      // After cooldown, start monitoring for "no audio heard"
      // Reset transcription time to now (we're ready to listen)
      lastTranscriptionTime = Date.now();
      startNoAudioCheck();
      
      // Clear last question after cooldown (new conversation turn)
      // This allows the same question to be asked again after a response
      lastQuestion = '';
    }, COOLDOWN_MS);
  }
  
  /**
   * Start monitoring if agent doesn't hear anything after 15 seconds
   * If no transcription is received, ask Umi to repeat
   */
  function startNoAudioCheck() {
    // Don't start if we already asked to repeat (prevent loop)
    if (hasAskedToRepeat) {
      log('debug', 'Skipping no-audio check - already asked to repeat');
      return;
    }
    
    // Clear any existing timer
    if (noAudioTimer) {
      clearTimeout(noAudioTimer);
    }
    
    // Set timer for 15 seconds
    noAudioTimer = setTimeout(function() {
      // Check if we've heard anything since the check started
      const timeSinceLastTranscription = Date.now() - (lastTranscriptionTime || 0);
      
      // If no transcription in the last 15 seconds, ask Umi to repeat
      // Only ask once per conversation turn (hasAskedToRepeat flag prevents loop)
      if (timeSinceLastTranscription >= 15000 && !isPlayingTTS && !isWaitingForResponse && !hasAskedToRepeat) {
        log('info', '🔇 No audio heard for 15 seconds, asking Umi to repeat...');
        askUmiToRepeat();
      }
      
      // Reset timer for next check
      noAudioTimer = null;
    }, 15000);
  }
  
  /**
   * Check if two questions are the same (simple similarity check)
   * @param {string} question1 - First question
   * @param {string} question2 - Second question
   * @returns {boolean} True if questions are similar
   */
  function isSameQuestion(question1, question2) {
    if (!question1 || !question2) return false;
    if (question1.length < 10 || question2.length < 10) return false;
    
    // Normalize: lowercase, remove extra spaces, remove punctuation
    const normalize = (str) => {
      // Remove common prefixes like "here's the question one more time", "here's the first question", etc.
      let normalized = str.toLowerCase();
      // Remove prefixes - simplified regex to avoid linter issues
      const prefixPattern1 = /^here'?s?\s+(the\s+)?(question\s+)?(one\s+more\s+time|first\s+question|next\s+question)[\s.]*/i;
      const prefixPattern2 = /^(let'?s?\s+)?(go\s+back\s+to\s+)?(the\s+)?(question|first\s+question)[\s.]*/i;
      normalized = normalized.replace(prefixPattern1, '');
      normalized = normalized.replace(prefixPattern2, '');
      // Remove punctuation and normalize spaces
      normalized = normalized.replace(/[^\w\s]/g, ' ');
      normalized = normalized.replace(/\s+/g, ' ');
      return normalized.trim();
    };
    
    const q1 = normalize(question1);
    const q2 = normalize(question2);
    
    // Check if they're very similar (80% word overlap or exact match)
    if (q1 === q2) return true;
    
    // Word-based similarity
    const words1 = q1.split(' ').filter(w => w.length > 2);  // Ignore short words
    const words2 = q2.split(' ').filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return false;
    
    const commonWords = words1.filter(w => words2.includes(w));
    const similarity = commonWords.length / Math.max(words1.length, words2.length);
    
    return similarity >= 0.6;  // 60% word overlap = same question (lowered threshold)
  }
  
  /**
   * Ask Umi to repeat the question (when question hasn't changed)
   */
  function askToRepeatQuestion() {
    if (!ttsWs || ttsWs.readyState !== WebSocket.OPEN || !ttsReady) {
      log('warn', 'TTS not ready, cannot ask to repeat');
      return;
    }
    
    if (isPlayingTTS || isWaitingForResponse) {
      log('debug', 'Skipping repeat request - already speaking or waiting');
      return;
    }
    
    const repeatMessage = "Can you repeat the question please?";
    
    log('info', '🔄 Asking to repeat question:', repeatMessage);
    
    isWaitingForResponse = true;
    
    // Use TTS WebSocket to speak the request
    ttsWs.send(JSON.stringify({
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{
            text: repeatMessage
          }]
        }],
        turnComplete: true
      }
    }));
  }
  
  /**
   * Ask Umi to repeat (when no audio heard for 15 seconds)
   */
  function askUmiToRepeat() {
    if (!ttsWs || ttsWs.readyState !== WebSocket.OPEN || !ttsReady) {
      log('warn', 'TTS not ready, cannot ask Umi to repeat');
      return;
    }
    
    // Don't ask if we're already playing TTS or waiting for response
    if (isPlayingTTS || isWaitingForResponse) {
      log('debug', 'Skipping repeat request - already speaking or waiting');
      return;
    }
    
    // Prevent asking multiple times (flag will be reset after cooldown)
    if (hasAskedToRepeat) {
      log('debug', 'Already asked to repeat, skipping...');
      return;
    }
    
    const repeatMessage = "Hey Umi, can you come again please? I didn't catch that.";
    
    log('info', '🎤 Asking Umi to repeat:', repeatMessage);
    
    // Mark that we've asked to repeat (prevents loop)
    hasAskedToRepeat = true;
    
    // Use TTS WebSocket to speak the request
    ttsWs.send(JSON.stringify({
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{
            text: repeatMessage
          }]
        }],
        turnComplete: true
      }
    }));
    
    // Mark that we're waiting for response (so we don't ask again immediately)
    isWaitingForResponse = true;
    
    // After asking, wait longer before checking again (30 seconds)
    // This gives Umi time to respond without triggering another loop
    setTimeout(function() {
      isWaitingForResponse = false;
      lastTranscriptionTime = Date.now();
      // Don't restart no-audio check here - it will restart after cooldown
      // This prevents the loop
    }, 5000);
  }
  
  // ============================================================
  // INITIALIZATION
  // ============================================================
  
  function init() {
    if (isInitialized) return;
    isInitialized = true;
    
    log('info', '=== Interview Bot Automation ===');
    
    // Start auto-click automation
    setInterval(runAutoClick, AUTO_CLICK_INTERVAL_MS);
    log('info', 'Auto-click automation started');
    
    // Start audio capture after a delay
    setTimeout(function() {
      startAudioCapture();
      connectGemini();
    }, 5000);
    
    log('info', '✓ Automation initialized');
  }
  
  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();


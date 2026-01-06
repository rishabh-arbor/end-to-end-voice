/**
 * Electron main process - handles app lifecycle and window management
 */

const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

// Load secrets
function loadSecrets() {
  const secretsPath = path.join(__dirname, 'secrets.local.json');
  if (fs.existsSync(secretsPath)) {
    const json = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    Object.entries(json).forEach(([k, v]) => {
      if (!process.env[k]) process.env[k] = String(v);
    });
  }
}

loadSecrets();

let mainWindow;
let interviewUrl = process.argv[2] || process.env.INTERVIEW_URL || '';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // allow cross-origin for audio capture
      enableRemoteModule: true,
      backgroundThrottling: false
    }
  });

  // Grant all permissions including desktop capture
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log(`[main] Permission requested: ${permission}`);
    callback(true); // auto-grant camera, microphone, notifications, media
  });

  // Handle media access specifically for desktop capture
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    console.log(`[main] Permission check: ${permission}`);
    return true; // allow all
  });

  if (!interviewUrl) {
    console.error('No interview URL provided. Pass as first argument or set INTERVIEW_URL env var.');
    app.quit();
    return;
  }

  console.log(`Loading interview: ${interviewUrl}`);
  mainWindow.loadURL(interviewUrl);

  // Open DevTools for debugging (optional)
  if (process.env.DEBUG === '1') {
    mainWindow.webContents.openDevTools();
  }

  // Forward console logs from renderer to terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levels = ['log', 'warn', 'error'];
    const levelName = levels[level] || 'log';
    console.log(`[renderer-${levelName}] ${message}`);
  });

  // Handle renderer crashes
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process crashed:', details.reason);
    if (details.reason !== 'clean-exit') {
      console.log('Attempting to reload...');
      setTimeout(() => {
        if (mainWindow) mainWindow.reload();
      }, 2000);
    }
  });
  
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('Page became unresponsive');
  });
  
  mainWindow.webContents.on('responsive', () => {
    console.log('Page became responsive again');
  });

  mainWindow.on('closed', () => {
    console.log('Window closed');
    mainWindow = null;
  });

  // Mic override DISABLED - using system default (MacBook Air Microphone)
  mainWindow.webContents.on('dom-ready', () => {
    console.log('[audio] Using system default mic (no override)');
  });

  // Inject automation script after page loads
  mainWindow.webContents.on('did-finish-load', async () => {
    console.log('Page loaded, starting automation...');
    
    // Wait a bit for page to settle
    await new Promise((r) => setTimeout(r, 1500));
    
    const password = (process.env.INTERVIEW_PASSWORD || 'test').replace(/'/g, "\\'");
    const geminiKey = (process.env.GEMINI_API_KEY || '').replace(/'/g, "\\'");
    const openaiKey = (process.env.OPENAI_API_KEY || '').replace(/'/g, "\\'");
    const enableSTT = process.env.ENABLE_STT === '1';
    
    // Inject simplified automation inline (no IPC dependencies, no template string issues)
    const automationCode = `
(function() {
  console.log('[electron] Starting automation...');

  // ============================================================
  // VIRTUAL MIC MIXER (Option A): feed interview mic a clean mix of
  // - your physical mic
  // - agent TTS audio
  // This prevents BlackHole/system-audio "background" from going to Umi.
  // We still use BlackHole separately for STT capture.
  // ============================================================

  var __ARBOR_INTERNAL_GUM = false; // allow our own getUserMedia calls
  var uplinkAudioContext = null;
  var uplinkDestination = null; // MediaStreamDestination
  var uplinkReady = false;
  var uplinkMicGate = null;
  var uplinkMicCompressor = null;
  var uplinkMicAnalyser = null;
  var uplinkMicGateInterval = null;

  async function ensureUplinkMixer() {
    if (uplinkReady) return;
    try {
      uplinkAudioContext = uplinkAudioContext || new (window.AudioContext || window.webkitAudioContext)();
      uplinkDestination = uplinkAudioContext.createMediaStreamDestination();
      uplinkMicGate = uplinkAudioContext.createGain();
      uplinkMicGate.gain.value = 0.0; // start closed; open on voice activity
      uplinkMicCompressor = uplinkAudioContext.createDynamicsCompressor();
      uplinkMicCompressor.threshold.value = -24;
      uplinkMicCompressor.knee.value = 20;
      uplinkMicCompressor.ratio.value = 6;
      uplinkMicCompressor.attack.value = 0.003;
      uplinkMicCompressor.release.value = 0.25;
      uplinkMicAnalyser = uplinkAudioContext.createAnalyser();
      uplinkMicAnalyser.fftSize = 2048;

      // Capture the physical mic for uplink
      __ARBOR_INTERNAL_GUM = true;
      var micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Use system-selected mic (user already sets MacBook Air Microphone)
          // Turn these ON to reduce speaker leakage/background
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      __ARBOR_INTERNAL_GUM = false;

      var micSource = uplinkAudioContext.createMediaStreamSource(micStream);
      // mic -> compressor -> (analyser tap) -> noise gate -> uplink
      micSource.connect(uplinkMicCompressor);
      uplinkMicCompressor.connect(uplinkMicAnalyser);
      uplinkMicCompressor.connect(uplinkMicGate);
      uplinkMicGate.connect(uplinkDestination);

      // Simple RMS noise-gate so idle room noise / speaker leakage doesn't reach Umi.
      // Use hysteresis so it doesn't "flutter" around the threshold.
      if (!uplinkMicGateInterval) {
        var timeData = new Float32Array(uplinkMicAnalyser.fftSize);
        var gateOpen = false;
        var openThreshold = 0.06;  // require clear speech
        var closeThreshold = 0.04; // close sooner to reduce echo/leakage
        var lastGateLogAt = 0;
        uplinkMicGateInterval = setInterval(function() {
          try {
            uplinkMicAnalyser.getFloatTimeDomainData(timeData);
            var sum = 0;
            for (var i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
            var rms = Math.sqrt(sum / timeData.length);

            // Gate logic with hysteresis
            if (!gateOpen && rms >= openThreshold) gateOpen = true;
            else if (gateOpen && rms <= closeThreshold) gateOpen = false;

            // Smooth open/close to avoid clicks
            var now = uplinkAudioContext.currentTime;
            uplinkMicGate.gain.cancelScheduledValues(now);
            uplinkMicGate.gain.setTargetAtTime(gateOpen ? 1.0 : 0.0, now, gateOpen ? 0.02 : 0.08);

            // Occasional debug so we can confirm it's not opening from leakage
            var t = Date.now();
            if (t - lastGateLogAt > 2000) {
              lastGateLogAt = t;
              console.log('[uplink] mic rms=', rms.toFixed(3), 'gate=', gateOpen ? 'OPEN' : 'closed');
            }
          } catch (e) {
            // ignore
          }
        }, 50);
      }

      uplinkReady = true;
      console.log('[uplink] ✓ Virtual mic mixer ready (mic gated + TTS)');
    } catch (e) {
      __ARBOR_INTERNAL_GUM = false;
      console.error('[uplink] Failed to init virtual mic mixer:', e && e.message ? e.message : e);
    }
  }

  // Intercept interview's getUserMedia so LiveKit uses our mixed uplink stream
  (function interceptInterviewMic() {
    try {
      var originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async function(constraints) {
        try {
          if (__ARBOR_INTERNAL_GUM) {
            return await originalGetUserMedia(constraints);
          }

          if (constraints && constraints.audio) {
            await ensureUplinkMixer();
            if (uplinkReady && uplinkDestination && uplinkDestination.stream) {
              console.log('[uplink] Supplying mixed mic stream to page getUserMedia');
              return uplinkDestination.stream;
            }
          }
        } catch (e) {
          console.error('[uplink] getUserMedia intercept error:', e && e.message ? e.message : e);
        }
        return await originalGetUserMedia(constraints);
      };
      console.log('[uplink] ✓ getUserMedia intercepted (virtual mic uplink)');
    } catch (e) {
      console.error('[uplink] Failed to intercept getUserMedia:', e && e.message ? e.message : e);
    }
  })();
  
  var PASSWORD = '${password}';
  var OPENAI_API_KEY = '${openaiKey}';
  var ENABLE_STT = ${enableSTT};
  
  var tickCounter = 0;
  var intervalId = setInterval(function() {
    try {
      tickCounter++;
      console.log('[auto-tick] #' + tickCounter);
      
      var pwd = document.querySelector('input[type="password"]');
      if (pwd && !pwd.value) {
        pwd.focus();
        pwd.value = PASSWORD;
        pwd.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('[auto] Filled password');
      }
      
      var btns = document.querySelectorAll('button, [role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var btn = btns[i];
        var txt = (btn.innerText || '').toLowerCase();
        if (txt.includes('get started') || txt.includes('start voice') || txt.includes('skip') || txt.includes('continue')) {
          var style = window.getComputedStyle(btn);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            btn.click();
            console.log('[auto] Clicked: ' + txt.slice(0, 30));
            break;
          }
        }
      }
      
      // TEXT SCRAPING DISABLED - Using audio transcription only
      // All Umi messages will appear as [🔊 UMI VOICE] from Gemini Live API transcription
    } catch (e) {
      console.error('[auto] Error:', e);
    }
  }, 2000);
  
  console.log('[electron] ✓ Automation active, interval ID:', intervalId);
  console.log('[electron] Will log [auto-tick] every 2s');
  
  // Dual capture: speaker (Umi via BlackHole) and mic (User) -> Gemini STT
  setTimeout(function() {
    console.log('[audio] Starting dual audio capture (speaker + mic) with Gemini Live API STT...');

    var GEMINI_API_KEY = '${geminiKey}';
    if (!GEMINI_API_KEY || GEMINI_API_KEY.length < 10) {
      console.log('[gemini-stt] No Gemini API key found, STT disabled');
      return;
    }

    // Utility: get audio devices and pick one by matcher
    async function pickDevice(matcher, label) {
      var devices = await navigator.mediaDevices.enumerateDevices();
      var audioInputs = devices.filter(function(d) { return d.kind === 'audioinput'; });
      console.log('[audio][' + label + '] found ' + audioInputs.length + ' input devices');
      audioInputs.forEach(function(d, i) {
        console.log('[audio][' + label + '] ' + i + ': ' + d.label + ' (id:' + d.deviceId.slice(0, 12) + '...)');
      });
      var chosen = audioInputs.find(matcher);
      if (!chosen) console.warn('[audio][' + label + '] device not found, using default');
      else console.log('[audio][' + label + '] using device: ' + chosen.label);
      return chosen ? chosen.deviceId : undefined;
    }

    async function startStream(opts) {
      var deviceId = await pickDevice(opts.matcher, opts.label);
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: opts.label === 'user',
          noiseSuppression: opts.label === 'user',
          autoGainControl: opts.label === 'user',
          // Don't force sample rate - use device native (48kHz for system audio)
          // sampleRate: 16000,
          channelCount: 1
        },
        video: false
      });
      console.log('[audio][' + opts.label + '] stream OK');
      return stream;
    }

    // ===== LLM Response Generation =====
    var isGenerating = false;
    var conversationHistory = [];
    
    async function generateLLMResponse(question) {
      if (isGenerating) {
        console.log('[llm] Already generating, skipping');
        return null;
      }
      isGenerating = true;
      
      try {
        console.log('[llm] Generating response for:', question.slice(0, 80) + '...');
        
        // Add to conversation history
        conversationHistory.push({ role: 'interviewer', text: question });
        
        // Call Gemini text API
        var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=' + GEMINI_API_KEY;
        var systemPrompt = 'You are an interview candidate. Answer in 1-2 short sentences MAX. Be direct and natural. No markdown.';
        
        var response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: question }] }]
          })
        });
        
        if (!response.ok) {
          throw new Error('Gemini API error: ' + response.status);
        }
        
        var json = await response.json();
        var parts = json?.candidates?.[0]?.content?.parts;
        var text = Array.isArray(parts) ? parts.map(function(p) { return p?.text || ''; }).join('').trim() : '';
        
        if (!text) {
          throw new Error('Empty response from Gemini');
        }
        
        console.log('[llm] ✓ Response:', text.slice(0, 100) + '...');
        conversationHistory.push({ role: 'candidate', text: text });
        
        return text;
      } catch (e) {
        console.error('[llm] Error:', e.message);
        return null;
      } finally {
        isGenerating = false;
      }
    }
    
    // ===== TTS via Gemini Live API =====
    var ttsWs = null;
    var ttsReady = false;
    var audioQueue = [];
    var audioContext = null;
    
    function initTTS() {
      ttsWs = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=' + GEMINI_API_KEY);
      
      ttsWs.onopen = function() {
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
        console.log('[tts] WebSocket connected, setup sent');
      };
      
      ttsWs.onmessage = async function(event) {
        try {
          var txt = typeof event.data === 'string' ? event.data : await event.data.text();
          var data = JSON.parse(txt);
          
          if (data.setupComplete) {
            ttsReady = true;
            console.log('[tts] ✓ Ready for text-to-speech');
            return;
          }
          
          // Handle audio response
          if (data.serverContent && data.serverContent.modelTurn) {
            var parts = data.serverContent.modelTurn.parts || [];
            parts.forEach(function(part) {
              if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/')) {
                var audioData = part.inlineData.data;
                playAudioBase64(audioData);
              }
            });
          }
        } catch (e) {
          console.error('[tts] Parse error:', e.message);
        }
      };
      
      ttsWs.onerror = function(err) {
        console.error('[tts] WebSocket error:', err.message || err);
      };
      
      ttsWs.onclose = function(ev) {
        ttsReady = false;
        console.log('[tts] WebSocket closed:', ev.code);
        // Reconnect after delay
        setTimeout(initTTS, 3000);
      };
    }
    
    var audioPlayQueue = [];
    var isPlayingAudio = false;
    var blackholeDestination = null;
    
    // Route TTS to MacBook Speakers ONLY (mic will pick it up naturally)
    async function setupTTSOutput() {
      try {
        var devices = await navigator.mediaDevices.enumerateDevices();
        var outputs = devices.filter(function(d) { return d.kind === 'audiooutput'; });
        console.log('[tts] Available outputs:', outputs.map(function(d) { return d.label; }));
        
        // Find MacBook Air Speakers specifically
        var speakers = outputs.find(function(d) { 
          return d.label.toLowerCase().includes('macbook') && d.label.toLowerCase().includes('speaker'); 
        });
        
        if (speakers && audioContext.setSinkId) {
          await audioContext.setSinkId(speakers.deviceId);
          console.log('[tts] ✓ Output routed to MacBook Speakers ONLY');
        } else {
          console.log('[tts] MacBook Speakers not found, using default (turn up volume!)');
        }
      } catch (e) {
        console.log('[tts] Output setup error:', e.message);
      }
    }
    
    function playAudioBase64(base64Data, sampleRate) {
      try {
        if (!audioContext) {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          setupTTSOutput();
        }
        
        // Decode base64 to raw bytes
        var binaryString = atob(base64Data);
        var bytes = new Uint8Array(binaryString.length);
        for (var i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Gemini returns raw PCM 16-bit audio at 24kHz
        var pcmRate = sampleRate || 24000;
        var pcm16 = new Int16Array(bytes.buffer);
        
        // Convert Int16 to Float32
        var float32 = new Float32Array(pcm16.length);
        for (var i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 32768.0;
        }
        
        // Create audio buffer and play
        var audioBuffer = audioContext.createBuffer(1, float32.length, pcmRate);
        audioBuffer.getChannelData(0).set(float32);
        
        // Queue audio chunks
        audioPlayQueue.push(audioBuffer);
        playNextAudioChunk();
        
      } catch (e) {
        console.error('[tts] Play error:', e.message);
      }
    }
    
    var ttsToUplinkSource = null; // MediaStreamSource to feed TTS into uplink
    var ttsMediaDest = null; // MediaStreamDestination for TTS
    
    function playNextAudioChunk() {
      if (isPlayingAudio || audioPlayQueue.length === 0) return;
      
      isPlayingAudio = true;
      var audioBuffer = audioPlayQueue.shift();
      
      var source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // Boost volume for speakers
      var gainNode = audioContext.createGain();
      gainNode.gain.value = 10.0;
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // ALSO route TTS to uplink so Umi hears it
      try {
        if (uplinkReady && uplinkAudioContext && uplinkDestination) {
          // Create a MediaStreamDestination to capture TTS audio
          if (!ttsMediaDest) {
            ttsMediaDest = audioContext.createMediaStreamDestination();
          }
          gainNode.connect(ttsMediaDest);
          
          // Feed that stream into the uplink AudioContext
          if (!ttsToUplinkSource) {
            ttsToUplinkSource = uplinkAudioContext.createMediaStreamSource(ttsMediaDest.stream);
            // Connect directly to uplinkDestination (bypasses mic gate)
            ttsToUplinkSource.connect(uplinkDestination);
            console.log('[tts] ✓ TTS audio routed to uplink for Umi');
          }
        }
      } catch (e) {
        console.log('[tts] Uplink routing error:', e.message);
      }
      
      source.onended = function() {
        isPlayingAudio = false;
        playNextAudioChunk();
      };
      source.start(0);
      console.log('[tts] 🔈 Playing audio chunk (10x volume)');
    }
    
    var isTTSPlaying = false; // Flag to mute Umi capture during TTS
    
    async function speakResponse(text) {
      if (!ttsWs || ttsWs.readyState !== WebSocket.OPEN || !ttsReady) {
        console.log('[tts] Not ready, skipping speech');
        return;
      }
      
      // Mute capture BEFORE TTS and clear any pending transcripts
      isTTSPlaying = true;
      fullQuestionBuffer = ''; // Clear buffer to prevent feedback
      transcriptBuffer = '';
      
      // Wait a moment for in-flight audio to be processed
      await new Promise(function(r) { setTimeout(r, 500); });
      
      console.log('[tts] Speaking (capture muted, buffer cleared):', text.slice(0, 50) + '...');
      
      // Send text to be spoken
      ttsWs.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{ text: 'Please say the following out loud: ' + text }]
          }],
          turnComplete: true
        }
      }));
    }
    
    // Initialize TTS
    initTTS();
    
    // ===== Handle Umi Questions =====
    var waitingForUmi = false;
    
    async function handleUmiQuestion(question) {
      if (waitingForUmi) {
        console.log('[interview] Still waiting for Umi to respond, skipping');
        return;
      }
      
      console.log('[interview] 📝 Umi asked:', question);
      
      // Generate LLM response
      var response = await generateLLMResponse(question);
      if (!response) return;
      
      // Speak the response
      await speakResponse(response);
      
      // Wait for TTS to finish playing, then wait 15 more seconds before resuming capture
      waitingForUmi = true;
      console.log('[interview] ⏳ Waiting for TTS to finish + 15s for Umi to respond...');
      
      function checkAndResume() {
        if (isPlayingAudio || audioPlayQueue.length > 0) {
          // TTS still playing, check again in 500ms
          setTimeout(checkAndResume, 500);
          return;
        }
        // TTS done, wait 15 more seconds for Umi to respond
        console.log('[interview] TTS finished, waiting 15s for Umi...');
        setTimeout(function() {
          isTTSPlaying = false;
          fullQuestionBuffer = '';
          transcriptBuffer = '';
          waitingForUmi = false;
          console.log('[interview] ✓ Capture resumed, ready for next question');
        }, 15000);
      }
      checkAndResume();
    }

    function startGemini(label, logTag) {
      var ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=' + GEMINI_API_KEY);
      var ready = false;
      var loggedShape = false;
      var debugCount = 0; // limit serverContent debug logs
      var transcriptBuffer = ''; // accumulate transcript chunks
      var flushTimer = null;
      var fullQuestionBuffer = ''; // accumulate full question for LLM
      var responseTimer = null; // 5 second timer to trigger response
      
      ws.onopen = function() {
        ws.send(JSON.stringify({
          setup: {
            model: 'models/gemini-2.0-flash-exp',
            generation_config: {
              response_modalities: ['TEXT']
            },
            // Enable input audio transcription for STT
            input_audio_transcription: {}
          }
        }));
        console.log('[gemini-stt][' + label + '] connected, setup sent');
      };
      ws.onmessage = async function(event) {
        try {
          var txt = typeof event.data === 'string' ? event.data : await event.data.text();
          var data = JSON.parse(txt);
          if (data.setupComplete) {
            ready = true;
            console.log('[gemini-stt][' + label + '] setup complete (waiting for audio)');
            return;
          }

          // One-time debug: log serverContent keys to confirm STT payload shape
          if (!loggedShape && data.serverContent) {
            loggedShape = true;
            console.log('[gemini-stt][' + label + '] serverContent keys:', Object.keys(data.serverContent));
          }

          // Input audio transcription (from input_audio_transcription config)
          if (data.serverContent && data.serverContent.inputTranscription) {
            var it = data.serverContent.inputTranscription;
            var chunk = it.text || it.transcript || '';
            if (chunk && label === 'umi') {
              // Skip only if TTS is playing or waiting for Umi response
              if (isTTSPlaying || waitingForUmi) {
                console.log('[filter] Ignoring transcript (TTS/wait):', chunk.slice(0,20));
                return;
              }
              transcriptBuffer += chunk;
              fullQuestionBuffer += chunk;
              
              // Flush display after punctuation or short pause
              if (flushTimer) clearTimeout(flushTimer);
              if (/[.?!]$/.test(transcriptBuffer.trim())) {
                // Sentence ended - flush display immediately
                var sentence = transcriptBuffer.trim();
                console.log(logTag + ' ' + sentence);
                transcriptBuffer = '';
              } else {
                // Flush display after 1.5s pause
                flushTimer = setTimeout(function() {
                  if (transcriptBuffer.trim()) {
                    console.log(logTag + ' ' + transcriptBuffer.trim());
                    transcriptBuffer = '';
                  }
                }, 1500);
              }
              
              // Only accept content when user is NOT speaking (mic gate closed)
              // This prevents capturing user's echo as Umi's voice
              var userIsSpeaking = uplinkMicGate && uplinkMicGate.gain && uplinkMicGate.gain.value > 0.1;
              var hasRealContent = chunk && chunk.trim().length > 2;
              if (userIsSpeaking && hasRealContent) {
                console.log('[filter] Ignoring (user speaking):', chunk.slice(0,20));
              }
              if (hasRealContent && !userIsSpeaking) {
                console.log('[debug] New content:', chunk.slice(0,30), '| buffer:', fullQuestionBuffer.length);
                if (responseTimer) clearTimeout(responseTimer);
                responseTimer = setTimeout(function() {
                  var question = fullQuestionBuffer.trim();
                  console.log('[debug] Timer fired! Buffer:', question.slice(0, 80));
                  
                  // ALWAYS respond to ANY text from Umi
                  if (question && question.trim().length > 0) {
                    console.log('[interview] ⏱️ Umi speech detected! Responding...');
                    console.log('[interview] Text:', question.slice(0, 100));
                    fullQuestionBuffer = '';
                    handleUmiQuestion(question);
                  }
                }, 5000); // 5 seconds - give Umi more time to finish speaking
              }
            }
          }

          // Speech recognition results (live STT) - fallback
          if (data.serverContent && data.serverContent.speechRecognitionResult) {
            var alts = data.serverContent.speechRecognitionResult.alternatives || [];
            if (label === 'umi') {
              alts.forEach(function(a) {
                if (a.transcript) {
                  var tr = a.transcript.trim();
                  if (tr) console.log(logTag + ' ' + tr);
                }
              });
            }
          }

        } catch (e) {
          console.error('[gemini-stt][' + label + '] parse error:', e.message);
        }
      };
      ws.onerror = function(err) {
        console.error('[gemini-stt][' + label + '] ws error:', err.message || err);
      };
      ws.onclose = function(ev) {
        ready = false;
        console.error('[gemini-stt][' + label + '] ws closed:', ev.code, ev.reason || 'none');
      };
      return { ws, isReady: function() { return ready; } };
    }

    // Capture Umi audio from LiveKit audio elements (more reliable than BlackHole)
    function captureUmiFromLiveKit() {
      return new Promise(function(resolve) {
        var checkInterval = setInterval(function() {
          // LiveKit creates audio elements for remote participants
          var audioEls = document.querySelectorAll('audio');
          for (var i = 0; i < audioEls.length; i++) {
            var el = audioEls[i];
            // Look for audio element with a srcObject (MediaStream from WebRTC)
            if (el.srcObject && el.srcObject.getAudioTracks && el.srcObject.getAudioTracks().length > 0) {
              console.log('[audio][umi] Found LiveKit audio element with', el.srcObject.getAudioTracks().length, 'audio tracks');
              clearInterval(checkInterval);
              resolve(el.srcObject.clone()); // Clone the stream
              return;
            }
          }
          // Also check for any playing audio with captureStream support
          for (var j = 0; j < audioEls.length; j++) {
            var el2 = audioEls[j];
            if (!el2.paused && el2.captureStream) {
              console.log('[audio][umi] Found playing audio element, using captureStream');
              clearInterval(checkInterval);
              resolve(el2.captureStream());
              return;
            }
          }
        }, 500);
        // Timeout after 30 seconds
        setTimeout(function() {
          clearInterval(checkInterval);
          console.log('[audio][umi] LiveKit audio element not found, falling back to BlackHole');
          startStream({ label: 'umi', matcher: function(d){ return d.label.toLowerCase().includes('blackhole'); }, logTag: '[🔊 UMI VOICE]' })
            .then(resolve);
        }, 30000);
      });
    }

    // Start both captures
    Promise.all([
      captureUmiFromLiveKit(),
      startStream({ label: 'user', matcher: function(d){ return d.label.toLowerCase().includes('mic') || d.label.toLowerCase().includes('microphone'); }, logTag: '[🎤 USER VOICE]' })
    ]).then(function([umiStream, userStream]) {

      function pipeStream(stream, label, logTag) {
        var gem = startGemini(label, logTag);
        // Use native sample rate from stream (typically 48kHz for system audio)
        var audioContext = new (window.AudioContext || window.webkitAudioContext)();
        var source = audioContext.createMediaStreamSource(stream);
        console.log('[audio][' + label + '] AudioContext sample rate:', audioContext.sampleRate);
        var silent = audioContext.createGain(); silent.gain.value = 0;
        source.connect(silent); silent.connect(audioContext.destination);
        var pcm = []; 
        // 2 seconds of audio at native sample rate
        var SAMPLES_PER_CHUNK = audioContext.sampleRate * 2; 
        var sent = 0;
        var rmsTimer = 0;
        var workletCode = 'class PCMProcessor extends AudioWorkletProcessor { process(inputs){ if(inputs[0]&&inputs[0][0]) this.port.postMessage(inputs[0][0]); return true;} } registerProcessor("pcm-processor", PCMProcessor);';
        var blob = new Blob([workletCode], { type:'application/javascript' });
        var url = URL.createObjectURL(blob);
        audioContext.audioWorklet.addModule(url).then(function() {
          var node = new AudioWorkletNode(audioContext, 'pcm-processor');
          node.port.onmessage = function(ev){
            var f32 = ev.data;
            // RMS monitoring
            var sum = 0;
            for (var j = 0; j < f32.length; j++) { var v = f32[j]; sum += v * v; }
            var rms = Math.sqrt(sum / f32.length);
            rmsTimer++;
            if (label === 'umi' && rmsTimer % 20 === 0) { // log levels only for Umi
              var db = 20 * Math.log10(rms + 1e-8);
              console.log('[audio]['+label+'] level ~ ' + db.toFixed(1) + ' dB');
            }
            for(var i=0;i<f32.length;i++){ var s=Math.max(-1,Math.min(1,f32[i])); pcm.push(s<0?s*0x8000:s*0x7FFF);}
            if(pcm.length>=SAMPLES_PER_CHUNK) flush();
          };
          source.disconnect(silent); source.connect(node); node.connect(silent);
          console.log('[audio]['+label+'] worklet active');
        }).catch(function(err){ console.error('[audio]['+label+'] worklet failed:', err.message);});

        function flush(){
          if(!gem.ws || gem.ws.readyState!==WebSocket.OPEN || !gem.isReady()){ pcm=[]; return; }
          try{
            var pcm16 = new Int16Array(pcm); pcm=[];
            var bytes = new Uint8Array(pcm16.buffer);
            var bin=''; var chunkSize=8192;
            for(var i=0;i<bytes.length;i+=chunkSize){ var chunk=bytes.subarray(i,Math.min(i+chunkSize,bytes.length)); bin+=String.fromCharCode.apply(null,chunk); }
            var base64 = btoa(bin);
            // Use actual sample rate from audioContext
            var mimeType = 'audio/pcm;rate=' + audioContext.sampleRate;
            gem.ws.send(JSON.stringify({ realtimeInput:{ mediaChunks:[{ mimeType: mimeType, data: base64 }]}}));
            sent++; if(sent%3===0) console.log('[gemini-stt]['+label+'] sent chunk #'+sent+' ('+(bytes.length/1024).toFixed(1)+' KB)');
          }catch(e){ console.error('[gemini-stt]['+label+'] send error:', e.message); }
        }
      }

      if (umiStream) pipeStream(umiStream, 'umi', '[🔊 UMI VOICE]');
      if (userStream) pipeStream(userStream, 'user', '[🎤 USER VOICE]');
    }).catch(function(err){
      console.error('[audio] dual capture failed:', err.message);
    });

  }, 5000);
})();
    `;
    
    mainWindow.webContents.executeJavaScript(automationCode)
      .then(() => {
        console.log('✓ Automation script injected successfully');
      })
      .catch((err) => {
        console.error('Failed to inject automation:', err);
      });
  });
}

// Handle requests for desktop sources (for audio capture)
if (ipcMain && typeof ipcMain.handle === 'function') {
  ipcMain.handle('get-desktop-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      fetchWindowIcons: true
    });
    return sources;
  });
} else {
  console.warn('[main] ipcMain.handle unavailable; desktop source IPC disabled');
}

// Handle Gemini API calls from renderer
if (ipcMain && typeof ipcMain.handle === 'function') {
  ipcMain.handle('call-gemini', async (event, { userPrompt, systemPrompt, model }) => {
    const { generateGeminiReply } = require('./gemini');
    const apiKey = process.env.GEMINI_API_KEY || '';
    
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not set');
    }
    
    return await generateGeminiReply({
      apiKey,
      model: model || process.env.GEMINI_MODEL || 'auto',
      systemPrompt: systemPrompt || process.env.GEMINI_SYSTEM_PROMPT || 'Reply as the interview candidate. Keep it concise and friendly.',
      userPrompt
    });
  });
} else {
  console.warn('[main] ipcMain.handle unavailable; Gemini IPC disabled');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});



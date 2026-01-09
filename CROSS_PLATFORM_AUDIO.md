# Cross-Platform Audio Capture - macOS vs Linux

## Problem: Removing BlackHole on macOS

### Current Implementation

The code currently uses:
1. **BlackHole** (macOS) - Primary method
2. **getDisplayMedia** (Fallback) - Both platforms

### Issues if BlackHole is Removed on macOS

#### 1. **getDisplayMedia Limitations on macOS**

**Problems**:
- ❌ **Requires user interaction** - Cannot be automated
- ❌ **Permission prompts** - User must manually grant screen/audio capture permission
- ❌ **May not capture all system audio** - Only captures what's being shared
- ❌ **Unreliable** - May miss audio if user doesn't grant permission immediately
- ❌ **Security restrictions** - macOS restricts system audio capture for security

**What happens**:
```javascript
navigator.mediaDevices.getDisplayMedia({ audio: true })
  // ❌ Shows permission dialog - requires user click
  // ❌ May be blocked by macOS security settings
  // ❌ May not capture all system audio reliably
```

#### 2. **No Alternative Virtual Audio Device**

On macOS, without BlackHole:
- ❌ No built-in virtual audio device for system audio capture
- ❌ Cannot route system audio to an input device
- ❌ Must rely on `getDisplayMedia` which has limitations

#### 3. **Multi-Output Device Dependency**

Current setup requires:
- ✅ Multi-Output Device (MacBook Speakers + BlackHole)
- ✅ System output set to Multi-Output Device
- ✅ BlackHole receives system audio

**Without BlackHole**:
- ❌ Cannot create Multi-Output Device with virtual input
- ❌ System audio goes only to speakers (not capturable)
- ❌ No way to route system audio to an input device

---

## Solution: Cross-Platform Audio Detection

### Platform-Specific Audio Capture

**macOS**: Use BlackHole (best) → getDisplayMedia (fallback)
**Linux**: Use PulseAudio null sink → getDisplayMedia (fallback)

### Implementation

```javascript
// Detect platform and use appropriate method
function captureUmiFromSpeakers() {
  return new Promise(function(resolve) {
    const platform = process.platform; // 'darwin' (macOS) or 'linux'
    
    if (platform === 'darwin') {
      // macOS: Try BlackHole first
      startStream({ 
        label: 'umi', 
        matcher: function(d) { 
          return d.label.toLowerCase().includes('blackhole'); 
        }
      })
      .then(function(stream) {
        console.log('[audio][umi] ✓ BlackHole stream obtained (macOS)');
        resolve(stream);
      })
      .catch(function(err) {
        console.log('[audio][umi] ⚠️ BlackHole failed, trying getDisplayMedia...');
        // Fallback to getDisplayMedia
        tryGetDisplayMedia(resolve);
      });
      
    } else if (platform === 'linux') {
      // Linux: Try PulseAudio null sink
      startStream({ 
        label: 'umi', 
        matcher: function(d) { 
          return d.label.toLowerCase().includes('virtual') || 
                 d.label.toLowerCase().includes('null-sink') ||
                 d.label.toLowerCase().includes('remap') ||
                 d.label.toLowerCase().includes('monitor');
        }
      })
      .then(function(stream) {
        console.log('[audio][umi] ✓ PulseAudio null sink obtained (Linux)');
        resolve(stream);
      })
      .catch(function(err) {
        console.log('[audio][umi] ⚠️ PulseAudio failed, trying getDisplayMedia...');
        // Fallback to getDisplayMedia
        tryGetDisplayMedia(resolve);
      });
      
    } else {
      // Windows/Other: Use getDisplayMedia only
      console.log('[audio][umi] Platform not macOS/Linux, using getDisplayMedia...');
      tryGetDisplayMedia(resolve);
    }
  });
}

function tryGetDisplayMedia(resolve) {
  navigator.mediaDevices.getDisplayMedia({ 
    audio: { 
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    video: false 
  })
  .then(function(stream) {
    console.log('[audio][umi] ✓ getDisplayMedia stream obtained');
    resolve(stream);
  })
  .catch(function(err) {
    console.error('[audio][umi] ❌ All capture methods failed:', err.message);
    
    if (process.platform === 'darwin') {
      console.error('[audio][umi] macOS Setup Required:');
      console.error('  1. Install BlackHole 2ch: https://github.com/ExistentialAudio/BlackHole');
      console.error('  2. Create Multi-Output Device in Audio MIDI Setup');
      console.error('  3. Add MacBook Speakers + BlackHole 2ch');
      console.error('  4. Set system output to Multi-Output Device');
    } else if (process.platform === 'linux') {
      console.error('[audio][umi] Linux Setup Required:');
      console.error('  1. Install PulseAudio: sudo apt-get install pulseaudio');
      console.error('  2. Create null sink: pactl load-module module-null-sink sink_name=virtual_speaker');
      console.error('  3. Set default sink: pactl set-default-sink virtual_speaker');
      console.error('  4. Create remap source: pactl load-module module-remap-source master=virtual_speaker.monitor');
    }
    
    resolve(null);
  });
}
```

---

## Why Keep BlackHole on macOS?

### Advantages of BlackHole

1. ✅ **Fully Automated** - No user interaction required
2. ✅ **Reliable** - Captures all system audio automatically
3. ✅ **No Permission Prompts** - Works immediately after setup
4. ✅ **Better Quality** - Direct audio routing, no compression
5. ✅ **Multi-Output Device** - User can still hear audio while it's captured

### Disadvantages of getDisplayMedia on macOS

1. ❌ **Manual Permission** - User must click "Share" button
2. ❌ **Security Restrictions** - macOS may block it
3. ❌ **Unreliable** - May not capture all system audio
4. ❌ **Not Automated** - Breaks automation flow

---

## Recommended Approach

### Keep Platform-Specific Solutions

**macOS**: 
- ✅ Keep BlackHole as primary method
- ⚠️ Use getDisplayMedia only as fallback (with warnings)

**Linux**:
- ✅ Use PulseAudio null sink as primary method
- ⚠️ Use getDisplayMedia as fallback

### Code Structure

```javascript
// Platform detection
const platform = process.platform;

// macOS-specific
if (platform === 'darwin') {
  // Try BlackHole first (best for macOS)
  // Fallback to getDisplayMedia if BlackHole not available
}

// Linux-specific
if (platform === 'linux') {
  // Try PulseAudio null sink first (best for Linux)
  // Fallback to getDisplayMedia if PulseAudio not available
}

// Cross-platform fallback
// getDisplayMedia (works on both, but with limitations)
```

---

## Migration Path

### Option 1: Keep Both (Recommended)

- ✅ macOS uses BlackHole (best experience)
- ✅ Linux uses PulseAudio (best experience)
- ✅ Both fallback to getDisplayMedia if needed

**Pros**: Best experience on each platform
**Cons**: Platform-specific code

### Option 2: Remove BlackHole, Use Only getDisplayMedia

- ❌ macOS: Requires manual permission grants
- ❌ macOS: Less reliable
- ✅ Linux: Still works with PulseAudio
- ⚠️ Both: Degraded experience

**Pros**: Simpler code
**Cons**: Poor macOS experience, breaks automation

### Option 3: Platform Detection with Warnings

- ✅ Detect platform automatically
- ✅ Use best method for each platform
- ✅ Show helpful error messages if setup missing

**Pros**: Best of both worlds
**Cons**: More code complexity

---

## Conclusion

**Removing BlackHole on macOS would cause**:
1. ❌ Loss of automation (requires manual permission)
2. ❌ Unreliable audio capture
3. ❌ Poor user experience
4. ❌ Security permission issues

**Best Solution**: 
- ✅ **Keep BlackHole for macOS** (primary method)
- ✅ **Use PulseAudio for Linux** (primary method)
- ✅ **getDisplayMedia as fallback** (both platforms)
- ✅ **Platform detection** (automatic)

This provides the best experience on each platform while maintaining cross-platform compatibility.


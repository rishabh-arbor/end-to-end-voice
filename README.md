# Arbor Interview Chat Capture

This tool uses Puppeteer to capture live chat messages from Arbor interview sessions in real-time.

## Installation

```bash
npm install
```

## Usage

```bash
node capture-chats.js <interview-url>
```

Or if you want to set the URL in the script directly, just run:

```bash
node capture-chats.js
```

## Example

```bash
node capture-chats.js https://interview-staging.findarbor.com/interview/abc123
```

## How it works

1. Launches a visible Chrome browser (headless: false)
2. Navigates to the interview URL
3. Monitors the DOM for changes
4. Extracts and displays chat messages as they appear
5. Prevents duplicate messages from being logged

## Stopping

Press `Ctrl+C` to stop the script and close the browser.


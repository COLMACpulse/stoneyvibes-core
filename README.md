# Lifted States

**A private instrument for observing how cannabis actually lands for you.**

Local-only. No accounts. No servers. No tracking. No bullshit.

---

## What this is

Lifted States is a personal observation tool for experienced cannabis users — the people who want to know what something actually does for *them*, not what the label claims or what the internet says.

It is **not**:

- a strain database
- a recommendation engine
- a social feed
- a marketplace

It **is**:

- a stash library, with photos and notes
- a fast session log with voice notes and live transcription
- a pattern-surface that only names a signal once it has *repeated*

## Core rule

> A signal is only real if it survives time and repeats across different conditions.

One strong session is a story. A pattern is a story that keeps coming back.

## How it works

1. **Stash.** Add what you have. Name, category, optional photo and visual traits.
2. **Log.** Pick from stash, hit record, talk for a minute. Tag what landed.
3. **Ask.** Once you have data, ask your own system what helps sleep, what runs steady, what makes you anxious. Patterns surface only when they repeat.

## Data and privacy

- Every byte stays on your device.
- Stash data lives in `localStorage`. Photos and audio live in IndexedDB.
- No accounts, no servers, no analytics, no tracking, no telemetry, ever.
- Export gives you a JSON file you fully own. Import restores from one.
- Wipe removes everything from the device with no remainder.

## Running locally

This is a static site. No build step.

```bash
# any static file server works
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying

Drop these files at the root of any static host (GitHub Pages, Netlify, Vercel, S3+CloudFront, a $5/mo VPS). That's it.

```
index.html
styles.css
app.js
favicon.svg
icon-192.png
icon-512.png
manifest.webmanifest
og.png
og.svg
```

## Browser support

- **Recording + transcript:** Chrome, Edge, Android. iOS Safari needs the fallback recorder (file upload from the Voice Memos app); transcription on iOS falls back to manual.
- **Everything else:** any evergreen browser.
- **Installable as a PWA** on iOS and Android.

## Philosophy

Built for the user who already knows how to handle their own life. Plain language. Scientific thinking. The word "bullshit" used intentionally and sparingly.

Clarity beats novelty. Signal beats story. Grounded beats hype.

---

## Version

v1.0 · session capture instrument

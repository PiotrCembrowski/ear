# Manual test checklist: live listening

Automated tests cover the engine and the database rules (`npm test`), and every page in Chromium with a fake microphone, including accessibility and layout at phone, tablet and desktop widths (`npm run test:e2e`). Real microphones, permission prompts, other browsers and real phones can only be checked by hand.

Run this checklist before a release on each target:

| Browser | Desktop | Mobile |
|---|---|---|
| Chrome / Edge (current) | ☐ | ☐ Android |
| Firefox (current) | ☐ | — |
| Safari (current) | ☐ macOS | ☐ iOS / iPadOS |

Use the deployed **https** site, or `npm run dev` on `localhost` for desktop. Mobile browsers need https, for example a Vercel preview deployment.

**Where each browser shows that the microphone is on:**

| Browser | Indicator |
|---|---|
| Chrome / Edge desktop | Red dot on the tab, and a mic icon at the right of the address bar |
| Firefox desktop | Red mic icon in the address bar (and the sharing indicator window or menu-bar icon) |
| Safari macOS | Mic icon in the address bar, and the orange dot in the macOS menu bar |
| iOS / iPadOS | Orange dot in the status bar (Control Centre names the site) |
| Android Chrome | Green mic icon in the status bar, and the "Microphone in use" notice |

Before you start, run the security check against the staging project (see README, "Security check"): `npm run verify:rls -- --yes` must report 0 failed.

## 1. First start and permission
- [ ] Open **/listen** signed out. It shows "Microphone off", the privacy note and **Start listening**.
- [ ] Press **Start listening**. The browser asks for the microphone. Allow it.
- [ ] The badge shows "Listening · measuring background…", then "Listening", with a red pulsing dot. The panel border turns red.
- [ ] The browser's microphone indicator appears (see the table above).
- [ ] **Input device** now lists real device names.

## 2. Note identification (the acceptance test)
- [ ] Play **A4** on a piano or keyboard near the device. The tuner shows **A4** within about 0.2 s, with a cents value within about ±10 (pianos are often tuned a few cents off; the reading should be steady, not jumping).
- [ ] When the note fades, **Last note** shows A4, the cents, the frequency and the confidence (normally "High").
- [ ] Play **C4** and **E5**. Both are named correctly.
- [ ] Sing or whistle a steady note. The tuner follows it, and the needle moves smoothly.
- [ ] Play a low note (A1 or lower) and a high one (C7). Expect slower or less confident readings at the extremes (known limitation).
- [ ] Clap or knock. No note is shown; at most "No clear pitch".

## 3. Controls
- [ ] Move **Sensitivity** towards "Less sensitive". Quiet sounds stop triggering "Sound detected". The yellow threshold marker on the level meter moves right.
- [ ] Choose a different **Input device** while listening. Listening restarts on that device ("Using …" updates).
- [ ] Reload the page. The chosen device is remembered.
- [ ] Signed in with A4 = 442 Hz (in Settings): a 440 Hz tone reads about −8 cents.

## 4. Stopping and privacy
- [ ] Press **Stop listening**. The badge shows "Microphone off", **and the browser's microphone indicator disappears** within a second or two. Repeat while a sound is still ringing ("Sound detected"): the indicator still turns off.
- [ ] Open DevTools → **Network** and start listening for 30 s. No requests are sent while listening. Static files (the worker and worklet scripts) may load once at start; nothing is uploaded.
- [ ] Signed in, in Compare mode, play a note until "Saved to your history". In **Network**, the only new request is `POST /api/comparisons`. Its payload is a few kilobytes of JSON (scores, note names, a short pitch curve), with no audio and no `user_id`. Filter by **Media** or **Fetch/XHR**: nothing else was sent.
- [ ] Leave the page (click another link) while listening. The mic indicator turns off.
- [ ] Close the tab while listening. The indicator turns off.

## 5. Interruptions and errors
- [ ] **Switch tabs** (or apps on mobile) while listening. You come back to "Listening paused… the microphone was turned off", and the indicator is off. **Start listening again** works.
- [ ] **Block** the microphone in site settings, then press Start. "Microphone access is blocked" appears, with instructions.
- [ ] **Unplug** a USB or headset microphone while listening. "The microphone was disconnected" appears.
- [ ] **No microphone** (disable it in the OS, or use a desktop without one). "No microphone found" appears.
- [ ] **Mic in use** (Windows: another app in exclusive mode; some Android phones during a call). "The microphone is busy" appears.
- [ ] **iOS:** while listening, lock the screen or take a call, then return. "Audio was interrupted" appears, and **Resume listening** works.
- [ ] **Bluetooth headset** in call mode (if available). The low-quality input warning appears.
- [ ] Open the site over plain **http** on a LAN IP (not localhost). "A secure connection is needed" appears.

## 6. Compare, closest match, history and settings (signed in)
- [ ] In the **Library**, press **Compare** on a piano note. Play that note: a score appears about 0.6 s after the note starts, then "Saved to your history".
- [ ] Play a different note. The score is low and the breakdown explains why ("… cents from the reference").
- [ ] **Closest match** → Piano → play a note. The top match is that note.
- [ ] Open **History**: the results are listed, search and the type filter work, details re-open, and Delete asks for confirmation.
- [ ] **Settings**: set A4 to 442 and reopen Listen. Readings shift by about 8 cents for a 440 Hz tone.
- [ ] **Settings**: turn off "Save results to my history automatically". Results now show "Not saved…" with a **Save this result** button.
- [ ] **Settings → Delete account** (use a test account). Without typing DELETE it refuses. With DELETE you are signed out, and signing in with that account fails.

## 7. Accessibility
- [ ] Keyboard only: Tab reaches Start/Stop, the device picker, the sensitivity slider and the view toggle. Focus rings are visible, and Enter/Space work.
- [ ] Screen reader (VoiceOver or NVDA): the level meter is announced as a meter with a text value, and detected notes are announced ("Detected A4, plus 5 cents") at most every 1.5 s.
- [ ] Turn on "Reduce motion" in the OS. The pulsing dot and the needle/meter animations stop.
- [ ] Browser zoom at 200% on desktop: text stays readable, nothing overlaps, and no horizontal scrolling (apart from the admin import preview table, which scrolls inside its own box).

## 8. Responsive layout
- [ ] Phone (about 360–430 px wide), portrait: no horizontal scrolling on any page; the menu button opens the navigation; **Start listening** is fully visible without scrolling on /listen.
- [ ] Rotate the phone to landscape while listening. The layout adjusts and listening keeps going.
- [ ] Tablet (iPad) portrait and landscape: the menu button is used below 1024 px and the sidebar from 1024 px; result charts fit their card.
- [ ] Large desktop (1920 px or wider): content stays at a comfortable width, nothing stretches across the whole screen.
- [ ] iOS: the on-screen keyboard on the sign-in and search fields does not hide the field you are typing in.

## 9. Admin (admin account, staging project)
- [ ] **Admin → Bulk import samples**: choose real WAV notes (for example 88 piano notes) and enter the license and source. The preview names each note from its filename and flags files it cannot use; the coverage box says "Complete set · 88 of 88 piano notes…"; the import shows progress.
- [ ] **Library**: the imported notes appear, and their preview plays (a signed link that expires).
- [ ] **Closest match** with that instrument ranks the note you play first.
- [ ] A normal (non-admin) account cannot open /admin pages (it is sent to the dashboard).

Record the browser versions and any failures in the release notes.

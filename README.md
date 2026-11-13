# VTOP++

**VTOP++** (Manifest V3, `v1.0.0`) is an all-in-one productivity, UI modernization, and study utilities Chrome extension built **exclusively for VIT Vellore students** on the **VIT Vellore VTOP portal (`vtop.vit.ac.in`)**. It does not support other VIT campuses (Chennai, Bhopal, or AP).

It brings batch course material downloads, live course filtering, attendance bunk calculations, marks summaries & Lab/Soft-Skill grade prediction, digital assignment countdown tracking, home class messages, client-side auto-captcha solving, dark mode, privacy blur, navbar quick shortcuts, and `Ctrl+K` keyboard navigation into one modular extension.

---

## Features Breakdown

### 1. Course Material Downloader
- **Teacher-Grouped & All-Material Downloads:** Collects notes, slides, and syllabus files on Course Pages, including automatic multi-page table traversal.
- **Instant ZIP Packaging:** Uses local JSZip `STORE` mode compression for fast packaging without freezing the browser tab.
- **Anti-Rate-Limit Pacing Modes:**
  - **Human** *(default)*: `1.6s – 2.6s` jitter (natural clicking pace).
  - **Fast**: `0.4s – 0.75s` jitter.
- **Draggable & Minimizable Panel:** Floating UI with auto-detected registration number, course/faculty sync, and resilient SPA watchdog.

### 2. Consolidated Course Filter & Live Table Search
- **Semester, Subject & Faculty Selectors:** Organizes VTOP's Course Page Consolidated view by Semester (most recent first), Subject, and Faculty with local faculty caching (`vtopFilter.v1`).
- **Live Topic Filter Bar:** Injects an instant search bar directly above the course materials table to filter rows by topic, module, or keyword.

### 3. Attendance Bunk Calculator & Debarment Alerts
- Analyzes attendance tables across VTOP:
  - Shows how many classes you can **safely bunk** (`Can bunk X classes` / `Can bunk all remaining`) when above your target, or how many classes you **need to attend** (`Need to attend X classes` / `Impossible` when recovery exceeds realistic semester limits) when below it, rendered as clean inline text.
- **Continuous Target Slider & Input (`1%–100%`):** Persists your target percentage (default `75%`) and shows a warning banner if set below VIT's `75%` debarment threshold.
- **Summary Card:** Tracks Average Attendance, Safe Subjects (`≥80%`), Warning (`75%–79%`), Debarred Risk (`<75%`), and On-Duty (OD) classes.

### 4. Marks Summary & Lab/Soft-Skill Grade Predictor
- Appends an inline footer summary to every course marks table showing total weightage scored out of weightage given.
- For **Lab** and **Soft Skill** courses with remaining weightage, computes the remaining weightage needed for **S (`≥90`)**, **A (`≥80`)**, **B (`≥70`)**, and **Pass (`≥50`)** targets.

### 5. Digital Assignment (DA) Deadline Hub
- **Single-Course Assignment Upload Page:** Injects a deadline summary banner and inline countdown badges directly into Due Date cells.
- **Course Overview Page:** Adds a **Next Assignment** column scanning pending/submitted status per course.
- **Dynamic Color Coding:**
  - **Purple:** Due today (`0` days left / `<24h`).
  - **Red:** Due in `≤3` days or overdue.
  - **Green:** More than `3` days left or already submitted.

### 6. Client-Side Auto-Captcha Solver
- Segments and classifies login captcha images directly in the browser on an offscreen HTML5 canvas using local neural weights (`models/velloreWeights.json`) — zero external server calls.

### 7. Session Keep-Alive
- Prevents VTOP idle session timeouts via a **9-minute** background service-worker alarm paired with an **8-minute** client-side heartbeat backup (`HEARTBEAT_PING`).

### 8. Command Palette (`Ctrl + K` / `Cmd + K`)
- Universal keyboard launcher powered by a dynamic menu crawler with acronym/synonym matching and 1-click native VTOP navigation.

### 9. Navbar Quick Dock, Dark Mode, Privacy Mode & Dashboard Widgets
- **Navbar-Integrated Quick Dock:** Adds 1-click page shortcut pills, a top linear navigation progress bar, and instant icon toggles directly into the VTOP navbar.
- **Zero-Leak Dark Mode Engine:** Applied at `document_start` to avoid white flash (FOUC), preserves identical geometry across light and dark toggles (zero layout shift), includes automatic `@media print` reset for clean fee receipts/hall tickets, and pairs with consistent rounded slate scrollbars in both themes.
- **Privacy Mode:** One-click toggle that blurs student photos, registration numbers, profile names, and CGPA values on screen (reveals on hover).
- **Home Class Messages & Page Modernization:** Fetches faculty class messages into a Home dashboard card (with 5-minute cache), unifies card rounding (`0.375rem`) and styling across Dashboard, Course Page, and My Curriculum (category cards, tabs, and DataTables), strips stray VTOP DOM artifacts, and adds backdrop + close controls to VTOP mega-menu drawers.

---

## Project Structure

```text
VTOP-Plus-Plus/
├── manifest.json                         # Manifest V3 extension config & script/CSS order
├── jszip.min.js                          # Bundled JSZip library
├── models/
│   └── velloreWeights.json               # Pre-trained client-side captcha weights
├── icons/                                # Extension icons (16, 48, 128)
└── src/
    ├── background/
    │   └── background.js                 # Service worker (9m keep-alive alarm, asset/weight fetches)
    ├── content/
    │   ├── content.js                    # Master SPA lifecycle orchestrator & storage/popup sync
    │   └── styles/                       # Modular ordered stylesheets
    │       ├── privacy-and-navigation.css
    │       ├── widgets.css
    │       ├── dark-mode-core.css
    │       ├── dark-mode-components.css
    │       ├── dark-mode-widgets.css
    │       └── dashboard-and-layout.css
    ├── modules/                          # Self-contained feature modules
    │   ├── attendance-calculator.js
    │   ├── auto-captcha.js
    │   ├── command-palette.js
    │   ├── course-downloader.js
    │   ├── course-filter.js
    │   ├── crawler.js
    │   ├── da-tracker.js
    │   ├── dark-mode.js
    │   ├── home-messages.js
    │   ├── marks-fat-predictor.js
    │   ├── menu-drawer.js
    │   ├── privacy-mode.js
    │   ├── quick-dock.js
    │   └── session-keeper.js
    ├── popup/                            # Extension settings & quick actions popup
    │   ├── popup.html
    │   ├── popup.css
    │   └── popup.js
    └── utils/
        ├── dom.js                        # Shared DOM/CSRF/auth/DataTable helpers
        └── storage.js                    # Default settings & chrome.storage helpers
```

---

## Installation Guide (Testing & Development)

1. Open **Google Chrome**, **Brave**, or **Microsoft Edge**.
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the **`VTOP-Plus-Plus`** folder.
5. **VTOP++** is ready on your next VTOP visit.

---

## Privacy & Safety

- **100% Client-Side:** All scraping, ZIP bundling, captcha solving, and calculations run locally in your browser.
- **No Credential Storage:** The extension never stores or transmits VTOP passwords.
- **Rate-Limit Friendly:** Batch material downloads and background DA/message requests run with conservative spacing and randomized jitter.

---

## License
MIT License. Built exclusively for the students of VIT Vellore.

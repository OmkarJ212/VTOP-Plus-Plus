# 🚀 VTOP++ (The Ultimate All-in-One God Extension)

**VTOP++** is an all-in-one productivity and intelligence suite tailored exclusively for Vellore Institute of Technology students on the **VIT Vellore portal (vtop.vit.ac.in)**.

It merges high-speed material downloads, live course filtering, attendance bunk calculation, FAT grade prediction, digital assignment tracking, login auto-captcha, and keyboard page search navigation into a single, cohesive, modular extension.

---

## ✨ Features Breakdown

### 1. 📦 Course Material Downloader (from `vtop-downloader-extension`)
- **Teacher-Specific Downloads:** Groups notes, slides, and syllabus files by faculty name.
- **Instant ZIP Packaging:** Uses `STORE` mode compression for near-instantaneous (<100ms) ZIP generation without freezing the browser tab.
- **Safe Anti-Rate-Limit Pacing:**
  - **⚡ Fast:** `0.4s – 0.75s` jitter (Safe accelerated mode).
  - **🛡️ Safe:** `1.5s – 2.5s` jitter (Conservative human simulation).
  - **🐢 Stealth:** `3.0s – 5.0s` jitter.
- **Resilient Observer & Watchdog:** Never detaches during SPA navigation.

### 2. 🔍 Live Course Filter (from `vtop-course-filter`)
- Adds a real-time search bar directly above the course materials table.
- Filter files instantly by keyword, faculty, or type (Theory vs. Lab).

### 3. 📊 Attendance Bunk Calculator & Debarment Alerts
- Automatically analyzes the Class Attendance table:
  - If **≥75%**: Tells you exactly how many classes you can **safely bunk**.
  - If **<75%**: Tells you how many consecutive classes you **must attend** to escape debarment.
- Interactive Target Threshold slider (75%, 80%, 85%, 90%).
- Color-coded badges: 🟢 Safe, 🟡 Warning, 🔴 Debarred Risk.

### 4. 🎯 FAT Grade & Target Marks Predictor
- Injects into the Marks page:
  - Extracts continuous assessment marks (CAT-1, CAT-2, DA, Quizzes).
  - Calculates exactly what raw mark out of 100 you need in the Final Assessment Test (FAT) for **S, A, B, and C grades**.

### 5. 📝 Digital Assignment (DA) Deadline Hub
- Injects into the Digital Assignment page:
  - Scans across all courses to show total pending assignments.
  - Highlights urgent assignments due in `<48 hours` with countdown warnings.

### 6. ⚡ Client-Side Auto-Captcha Solver
- Binarizes and segments login captchas directly on an offscreen HTML5 canvas.
- Automatically fills the captcha input upon page load. Zero external server calls.

### 7. ⏱️ 9-Minute Session Keep-Alive
- Sends background heartbeat pings to prevent VTOP's annoying 15-minute idle session timeout while studying lecture notes.

### 8. 🔍 Search Pages (`Ctrl + K` / `Cmd + K`)
- Press `Ctrl+K` anywhere on VTOP to open a fast keyboard launcher:
  - Jump instantly to Attendance, Course Materials, Marks, Leave, or DA without digging through 4-level deep menus.

### 9. 🚀 Floating Quick Dock & Privacy Mode
- Sleek floating top dock with 1-click shortcuts to top pages.
- **🔒 Privacy Mode:** One-click toggle that blurs student photos, registration numbers, and CGPA in public spaces (e.g. library, labs, projector).

---

## 🛠️ Installation Guide (Testing & Development)

1. Open **Google Chrome**, **Brave**, or **Microsoft Edge**.
2. Navigate to: `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner).
4. Click **Load unpacked** (top-left).
5. Select the **`VTOP-Plus-Plus`** folder:
   ```
   C:\Users\Omkar Joshi\Desktop\VTOP_Extention\VTOP-Plus-Plus
   ```
6. The extension **VTOP++** is now installed and active!

---

## 🔒 Privacy & Safety Guarantee

- **100% Client-Side:** Everything runs locally within your browser.
- **No Password Storage:** The extension never asks for, records, or transmits passwords.
- **Safe Pacing:** All network interactions respect VTOP rate limits with randomized human jitter.

---

## ⚖️ License
MIT License. Built for the students of Vellore Institute of Technology.

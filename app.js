// Vocabulary Learning Application Logic - Vanilla JS (ES6+)

// 1. Structured JSON Dictionary Dataset & Dynamic Starter Templates
const defaultStarterData = {};

const dictionaryData = { ...defaultStarterData };

// 2. State Controller
const state = {
  // Configs
  selectedBooks: [],
  selectedUnits: [], // stored as "Book|||Unit" composite key
  activeSetupBook: null, // Track currently selected book tab in setup screen
  direction: "en-uz", // "en-uz", "uz-en", "mixed"
  mode: "multiple", // "flashcard", "multiple", "match", "cover", "linematch"
  limit: Infinity, // always use every selected word (no count picker in the UI)
  questionOrder: "random", // "random" or "sequential"
  
  // Game session
  questions: [],
  currentIndex: 0,
  streak: 0,
  maxStreak: 0,
  correctCount: 0,
  incorrectCount: 0,
  mistakes: [], // list of mistake word objects
  autoAdvanceTimeout: null,
  
  // Audio state
  speechSynth: window.speechSynthesis,
  voices: [],
  speechRate: 1.0,
  speechPitch: 1.0,
  speechVoiceURI: "",
  activeAudioElement: null,
  timerMode: false,
  soundSfx: true,
  questionTimer: null,
  timeLeft: 15,
  
  // Dictionary view state
  activeDictBook: "all",
  dictSearchQuery: "",
  
  // Match mode states
  selectedMatchCard: null,
  matchRoundWords: [],
  matchedPairsCount: 0,
  
  // Cover mode states
  coverTarget: "uz", // which side is hidden
  
  // LineMatch mode states
  lineMatchRoundWords: [],
  lineMatchSelectedLeft: null,
  lineMatchConnections: [],
  lineMatchMatchedCount: 0,
  
  // Active mode timeouts to prevent race conditions
  modeTimeout: null,
  balloonAnimationId: null,
  
  // Book Viewer states
  activeBookViewBook: localStorage.getItem("vocab_active_book") || "Essential 1",
  activeBookViewUnit: localStorage.getItem("vocab_active_unit") || "Unit 1",
  memorizedWords: []
};

function cleanupQuiz() {
  if (state.autoAdvanceTimeout) {
    clearTimeout(state.autoAdvanceTimeout);
    state.autoAdvanceTimeout = null;
  }
  if (state.questionTimer) {
    clearInterval(state.questionTimer);
    state.questionTimer = null;
  }
  if (state.modeTimeout) {
    clearTimeout(state.modeTimeout);
    state.modeTimeout = null;
  }
  if (state.balloonAnimationId) {
    cancelAnimationFrame(state.balloonAnimationId);
    state.balloonAnimationId = null;
  }
  stopConfetti();
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch(e) {}
  }
  state.questions = [];
  state.currentIndex = 0;
}

// Initialize Speech Voices
if (state.speechSynth) {
  state.voices = state.speechSynth.getVoices() || [];
  state.speechSynth.onvoiceschanged = () => {
    state.voices = state.speechSynth.getVoices() || [];
  };
}

// One-time user interaction unlock for iOS WKWebView and Android WebView
state.ttsUnlocked = false;
state.audioUnlocked = false;
function unlockTTS() {
  // 1. Unlock Web Speech Synthesis (iOS WKWebView)
  if (state.speechSynth && !state.ttsUnlocked) {
    try {
      const u = new SpeechSynthesisUtterance("");
      u.volume = 0; // Silent
      state.speechSynth.speak(u);
      state.ttsUnlocked = true;
    } catch (e) {}
  }
  
  // 2. Unlock DOM Audio Element (Android WebView / Telegram)
  const audioEl = document.getElementById("global-tts-player");
  if (audioEl && !state.audioUnlocked) {
    try {
      // Tiny silent 1-sample WAV file to satisfy user-gesture requirement
      audioEl.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA";
      audioEl.play().then(() => {
        audioEl.pause();
        state.audioUnlocked = true;
      }).catch(err => {
        console.warn("DOM Audio unlock failed:", err);
      });
    } catch (e) {
      console.warn("DOM Audio initialization failed:", e);
    }
  }

  // Cleanup listeners once both are unlocked
  if (state.ttsUnlocked && state.audioUnlocked) {
    document.removeEventListener("click", unlockTTS);
    document.removeEventListener("touchstart", unlockTTS);
  }
}
document.addEventListener("click", unlockTTS);
document.addEventListener("touchstart", unlockTTS);

// 3. Helper Algorithms
// Fisher-Yates Randomizer
function shuffleArray(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ---- Multi-Language Text-to-Speech (TTS) Engine ----
function detectTextLang(text, wordItem = null) {
  if (wordItem && wordItem._srcLang) return wordItem._srcLang;
  if (!text) return "en";

  // Check Arabic script (e.g. وَقْت, سَفَر, خَبَر, دُنْيَا)
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text)) return "ar";
  // Check Cyrillic / Russian script
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  // Check Korean
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(text)) return "ko";
  // Check Japanese (Hiragana/Katakana/Kanji)
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FBF]/.test(text)) return "ja";
  // Check Chinese
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";

  // Infer from active book key (e.g. "🇸🇦 Arab - 🇺🇿 O'zbek")
  if (state && state.activeBookKey) {
    const srcStr = state.activeBookKey.split(" - ")[0] || "";
    const entry = Object.entries(LANG_META).find(([code, meta]) =>
      srcStr.includes(meta.name) || srcStr.includes(meta.flag)
    );
    if (entry) return entry[0];
  }
  return "en";
}

function speakWord(text, onEndCallback = null, explicitLang = null) {
  const lang = explicitLang || detectTextLang(text);
  speakWordInLang(text, lang, onEndCallback);
}

function speakWordInLang(text, langCode = "en", onEndCallback = null) {
  if (!text || !text.toString().trim()) {
    if (typeof onEndCallback === "function") onEndCallback();
    return;
  }
  const cleanText = text.toString().trim();
  const lang = (langCode || detectTextLang(cleanText) || "en").toLowerCase();

  let handled = false;
  const done = () => {
    if (handled) return;
    handled = true;
    if (typeof onEndCallback === "function") onEndCallback();
  };

  // Primary: DOM audio player using Google Translate / Youdao TTS
  const audioEl = document.getElementById("global-tts-player");
  if (audioEl) {
    try {
      audioEl.pause();

      const url = (lang === "en")
        ? `https://dict.youdao.com/dictvoice?type=2&audio=${encodeURIComponent(cleanText)}`
        : `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=${encodeURIComponent(lang)}&client=tw-ob`;

      audioEl.src = url;
      audioEl.load();

      audioEl.onended = done;
      audioEl.onerror = () => playNativeTTSInLang(cleanText, lang, done);

      const playPromise = audioEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn("TTS audio element play catch, falling back to Web Speech:", err);
          playNativeTTSInLang(cleanText, lang, done);
        });
      }
      return;
    } catch (e) {
      console.warn("TTS audio element exception, falling back to Web Speech:", e);
    }
  }

  // Fallback: Web Speech API
  playNativeTTSInLang(cleanText, lang, done);
}

function playNativeTTSInLang(text, langCode, onEndCallback) {
  const synth = window.speechSynthesis || (state && state.speechSynth);
  if (!synth) {
    if (typeof onEndCallback === "function") onEndCallback();
    return;
  }

  let handled = false;
  const done = () => {
    if (handled) return;
    handled = true;
    if (typeof onEndCallback === "function") onEndCallback();
  };

  try {
    if (synth.paused) synth.resume();
    synth.cancel();
  } catch (e) {}

  const meta = LANG_META[langCode] || { bcp: "en-US" };
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = meta.bcp || langCode;
  utterance.rate = (state && state.speechRate) || 0.88;
  utterance.pitch = (state && state.speechPitch) || 1.0;

  const voices = (synth.getVoices ? synth.getVoices() : null) || (state && state.voices) || [];
  if (voices && voices.length > 0) {
    const matchVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(langCode.toLowerCase()));
    if (matchVoice) utterance.voice = matchVoice;
  }

  utterance.onend = done;
  utterance.onerror = done;

  try {
    synth.speak(utterance);
  } catch (e) {
    done();
  }
}

// 4. UI Transition & Navigation Tab Manager
// Dedupe guard for page_view logging: re-entering the exact same
// screen+context back to back (e.g. reopening the same book/unit) shouldn't
// write a fresh row every time — only actual changes are worth a log entry.
let lastTrackedKey = null;
function trackScreenView(screen, extraPayload) {
  if (!window.trackEvent) return;
  const key = screen + JSON.stringify(extraPayload || {});
  if (key === lastTrackedKey) return;
  lastTrackedKey = key;
  window.trackEvent("page_view", { screen, ...extraPayload });
}

function showScreen(screenId) {
  document.querySelectorAll(".view-screen").forEach(screen => {
    screen.classList.remove("active");
  });
  
  const activeScreen = document.getElementById(screenId);
  if (activeScreen) {
    activeScreen.classList.add("active");
    // Add subtle fade-in transition
    activeScreen.classList.remove("fade-in");
    void activeScreen.offsetWidth; // Force layout recalculation
    activeScreen.classList.add("fade-in");
  }
  
  // Update Bottom Nav active states
  document.querySelectorAll(".nav-tab").forEach(tab => {
    if (tab.dataset.target === screenId) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });
  
  // Hide bottom nav during active quiz or result view
  const bottomNav = document.getElementById("bottom-nav-bar");
  if (bottomNav) {
    if (screenId === "quiz-screen" || screenId === "result-screen") {
      bottomNav.style.display = "none";
    } else {
      bottomNav.style.display = "flex";
    }
  }
  
  // If result screen is shown, initialize empty state check
  if (screenId === "result-screen") {
    initResultEmptyState();
  }

  // If the library (book) screen is shown, always start at the selection
  // dashboard (never straight into a word list); this also refreshes the
  // streak strip, since showLibraryPhase("selection") calls it internally
  if (screenId === "book-screen") {
    showLibraryPhase("selection");
  }

  // If Mashqlar (setup) screen is shown, always start the wizard at step 1
  if (screenId === "setup-screen") {
    showWizardStep(1);
  }
}

// Mashqlar Wizard Navigation (3-step setup flow)
function showWizardStep(stepNumber) {
  document.querySelectorAll(".wizard-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.step === String(stepNumber));
  });

  document.querySelectorAll(".wizard-step-dot").forEach((dot) => {
    const dotStep = parseInt(dot.dataset.stepDot, 10);
    dot.classList.toggle("active", dotStep === stepNumber);
    dot.classList.toggle("completed", dotStep < stepNumber);
  });

  if (stepNumber === 3) {
    renderStep3SelectionSummary();
  }

  const configSteps = document.getElementById("config-steps");
  if (configSteps) configSteps.scrollTop = 0;
}

// Human-readable recap of the books/units chosen in Step 1, e.g.
// "Essential 1 (Unit 1, 2), Essential 2 (Unit 3)"
function getSelectedUnitsSummaryText() {
  if (state.selectedUnits.length === 0) return "To'plam tanlanmagan";
  const unitsByBook = {};
  state.selectedUnits.forEach(compositeKey => {
    const [book, unit] = compositeKey.split("|||");
    if (dictionaryData[book] && dictionaryData[book][unit]) {
      if (!unitsByBook[book]) unitsByBook[book] = [];
      if (!unitsByBook[book].includes(unit)) {
        unitsByBook[book].push(unit);
      }
    }
  });

  const bookKeys = Object.keys(unitsByBook);
  if (bookKeys.length === 0) return "To'plam tanlanmagan";

  return bookKeys
    .map(book => {
      const units = unitsByBook[book];
      return `${book} (${units.join(", ")})`;
    })
    .join("; ");
}

// Fills the Step 3 "Siz tanladingiz: ..." recap with the chosen book/units and practice mode
function renderStep3SelectionSummary() {
  const bookOut = document.getElementById("step3-summary-book");
  const modeOut = document.getElementById("step3-summary-mode");

  if (bookOut) bookOut.textContent = getSelectedUnitsSummaryText();

  if (modeOut) {
    const selectedChip = document.querySelector("#mode-chips .choice-chip.selected");
    const emoji = selectedChip ? selectedChip.querySelector(".mode-emoji") : null;
    const name = selectedChip ? selectedChip.querySelector(".mode-name") : null;
    modeOut.textContent = [emoji ? emoji.textContent : "", name ? name.textContent : ""]
      .filter(Boolean)
      .join(" ");
  }
}

let appAlertConfirmCallback = null;

function showAppAlert(title, message) {
  const overlay = document.getElementById("app-alert-overlay");
  const titleEl = document.getElementById("app-alert-title");
  const messageEl = document.getElementById("app-alert-message");
  const okBtn = document.getElementById("app-alert-ok-btn");
  const cancelBtn = document.getElementById("app-alert-cancel-btn");
  if (!overlay || !titleEl || !messageEl || !okBtn || !cancelBtn) return;

  appAlertConfirmCallback = null;
  titleEl.innerText = title;
  messageEl.innerText = message;
  okBtn.innerText = "Tushunarli";
  cancelBtn.style.display = "none";
  overlay.style.display = "flex";
}

function showAppConfirm(title, message, onConfirm) {
  const overlay = document.getElementById("app-alert-overlay");
  const titleEl = document.getElementById("app-alert-title");
  const messageEl = document.getElementById("app-alert-message");
  const okBtn = document.getElementById("app-alert-ok-btn");
  const cancelBtn = document.getElementById("app-alert-cancel-btn");
  if (!overlay || !titleEl || !messageEl || !okBtn || !cancelBtn) return;

  appAlertConfirmCallback = onConfirm;
  titleEl.innerText = title;
  messageEl.innerText = message;
  okBtn.innerText = "Ha";
  cancelBtn.style.display = "block";
  overlay.style.display = "flex";
}

function hideAppAlert() {
  const overlay = document.getElementById("app-alert-overlay");
  if (overlay) overlay.style.display = "none";
  appAlertConfirmCallback = null;
}

function closeAppAlert() {
  const overlay = document.getElementById("app-alert-overlay");
  if (overlay) overlay.style.display = "none";
}

// 6. Local Storage Settings Sync
function saveSettings() {
  try {
    localStorage.setItem("vocab_selected_books", JSON.stringify(state.selectedBooks));
    localStorage.setItem("vocab_selected_units", JSON.stringify(state.selectedUnits));
    localStorage.setItem("vocab_direction", state.direction);
    localStorage.setItem("vocab_mode", state.mode);
    localStorage.setItem("vocab_limit", state.limit.toString());
    localStorage.setItem("vocab_question_order", state.questionOrder);
  } catch (err) {
    console.error("Local storage save error", err);
  }
}

function loadSettings() {
  try {
    const savedBooks = localStorage.getItem("vocab_selected_books");
    const savedUnits = localStorage.getItem("vocab_selected_units");
    const savedDirection = localStorage.getItem("vocab_direction");
    const savedMode = localStorage.getItem("vocab_mode");
    const savedLimit = localStorage.getItem("vocab_limit");
    const savedOrder = localStorage.getItem("vocab_question_order");

    if (savedBooks && savedUnits) {
      state.selectedBooks = JSON.parse(savedBooks);
      state.selectedUnits = JSON.parse(savedUnits);
      // Clean stale references not present in dictionaryData
      state.selectedUnits = state.selectedUnits.filter(compositeKey => {
        const [b, u] = compositeKey.split("|||");
        return dictionaryData[b] && dictionaryData[b][u];
      });
      state.selectedBooks = state.selectedBooks.filter(b => dictionaryData[b]);
    }

    if (state.selectedUnits.length === 0) {
      const books = Object.keys(dictionaryData);
      if (books.length > 0) {
        const firstBook = books[0];
        const units = Object.keys(dictionaryData[firstBook] || {});
        if (units.length > 0) {
          state.selectedBooks = [firstBook];
          state.selectedUnits = [`${firstBook}|||${units[0]}`];
        }
      }
    }
    
    // Set active Setup book based on selected books
    if (state.selectedBooks.length > 0) {
      state.activeSetupBook = state.selectedBooks[0];
    } else {
      const firstBook = Object.keys(dictionaryData)[0];
      if (firstBook) state.activeSetupBook = firstBook;
    }
    
    if (savedDirection) {
      state.direction = savedDirection;
    }
    
    if (savedMode) {
      state.mode = savedMode;
    }
    
    if (savedLimit) {
      state.limit = savedLimit === "Infinity" ? Infinity : parseInt(savedLimit, 10);
    }

    if (savedOrder === "random" || savedOrder === "sequential") {
      state.questionOrder = savedOrder;
    }

    // Sync all UI states
    renderActiveBookPanel();
    syncSetupScreenUI();
    syncOrderGlider();

    document.querySelectorAll('#mode-chips .choice-chip').forEach(chip => {
      chip.classList.toggle("selected", chip.dataset.val === state.mode);
    });
  } catch (err) {
    console.error("Local storage loaded values corrupted. Resetting...", err);
    state.selectedBooks = [];
    state.selectedUnits = [];
    const books = Object.keys(dictionaryData);
    if (books.length > 0) {
      const firstBook = books[0];
      const units = Object.keys(dictionaryData[firstBook] || {});
      if (units.length > 0) {
        state.selectedBooks = [firstBook];
        state.selectedUnits = [`${firstBook}|||${units[0]}`];
      }
    }
    state.direction = "en-uz";
    state.mode = "multiple";
    state.limit = Infinity;
    state.questionOrder = "random";
    renderActiveBookPanel();
    syncSetupScreenUI();
    syncOrderGlider();
  }
}

function initAppAlert() {
  const overlay = document.getElementById("app-alert-overlay");
  const okBtn = document.getElementById("app-alert-ok-btn");
  const cancelBtn = document.getElementById("app-alert-cancel-btn");

  if (okBtn) {
    okBtn.addEventListener("click", () => {
      const callback = appAlertConfirmCallback;
      hideAppAlert();
      if (callback) callback();
    });
  }
  if (cancelBtn) cancelBtn.addEventListener("click", hideAppAlert);
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) hideAppAlert();
    });
  }
}

function initWizardNavigation() {
  const next1 = document.getElementById("wizard-next-1");
  if (next1) {
    next1.addEventListener("click", () => {
      if (state.selectedUnits.length === 0) {
        showAppAlert(
          "Unit tanlanmagan",
          "Davom etish uchun kamida bitta kitobdan bitta unitni tanlang. Xohlasangiz bir nechta unitni birga ham tanlashingiz mumkin."
        );
        return;
      }
      showWizardStep(2);
    });
  }

  const next2 = document.getElementById("wizard-next-2");
  if (next2) next2.addEventListener("click", () => showWizardStep(3));

  document.querySelectorAll(".wizard-back-btn").forEach((btn) => {
    btn.addEventListener("click", () => showWizardStep(parseInt(btn.dataset.backTo, 10)));
  });

  document.querySelectorAll(".wizard-step-dot").forEach((dot) => {
    dot.addEventListener("click", () => showWizardStep(parseInt(dot.dataset.stepDot, 10)));
  });
}

function initNavigation() {
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const targetScreen = tab.dataset.target;
      const currentActive = document.querySelector(".view-screen.active");

      // If quiz screen is active and user attempts to leave
      if (currentActive && currentActive.id === "quiz-screen" && targetScreen !== "quiz-screen") {
        const isQuizOngoing = state.questions.length > 0 && state.currentIndex < state.questions.length;
        if (isQuizOngoing) {
          showAppConfirm(
            "Testdan chiqasizmi?",
            "Haqiqatan ham testdan chiqmoqchimisiz? Mashq natijalari saqlanmaydi.",
            () => {
              cleanupQuiz();
              showScreen(targetScreen);
            }
          );
          return; // Wait for the modal's decision instead of navigating now
        }
        // Quiz already finished, clear quiz state and continue below
        cleanupQuiz();
      }

      // Prevent entering empty quiz screen
      if (targetScreen === "quiz-screen" && state.questions.length === 0) {
        showAppAlert("Mashq boshlanmagan", "Iltimos, avval testni boshlang (Amaliyot bo'limidan)!");
        showScreen("setup-screen");
        return;
      }

      showScreen(targetScreen);
    });
  });
}

function calculateTotalSelectedWords() {
  let count = 0;
  state.selectedUnits.forEach(compositeKey => {
    const [book, unit] = compositeKey.split("|||");
    if (dictionaryData[book] && dictionaryData[book][unit]) {
      count += dictionaryData[book][unit].length;
    }
  });
  return count;
}

function getSliderValKeys(totalWords) {
  const standardPresets = [10, 20, 50, 100];
  const activePresets = [];
  const minVal = Math.min(10, totalWords);
  
  standardPresets.forEach(presetVal => {
    if (presetVal > minVal && presetVal < totalWords) {
      activePresets.push(presetVal);
    }
  });
  
  const valKeys = [minVal];
  activePresets.forEach(p => valKeys.push(p));
  if (totalWords > minVal) {
    valKeys.push(totalWords);
  }
  return valKeys;
}

function pctToVal(pct, valKeys) {
  if (valKeys.length <= 1) return valKeys[0] || 10;
  
  const numSegments = valKeys.length - 1;
  const segmentWidth = 100 / numSegments;
  
  let segmentIdx = Math.floor(pct / segmentWidth);
  if (segmentIdx >= numSegments) {
    segmentIdx = numSegments - 1;
  }
  
  const segmentPct = (pct - segmentIdx * segmentWidth) / segmentWidth;
  const minVal = valKeys[segmentIdx];
  const maxVal = valKeys[segmentIdx + 1];
  
  return Math.round(minVal + segmentPct * (maxVal - minVal));
}

function valToPct(v, valKeys) {
  if (valKeys.length <= 1) return 0;
  if (v <= valKeys[0]) return 0;
  if (v >= valKeys[valKeys.length - 1]) return 100;
  
  const numSegments = valKeys.length - 1;
  const segmentWidth = 100 / numSegments;
  
  for (let i = 0; i < numSegments; i++) {
    const minVal = valKeys[i];
    const maxVal = valKeys[i + 1];
    if (v >= minVal && v <= maxVal) {
      const segmentPct = (v - minVal) / (maxVal - minVal);
      return (i + segmentPct) * segmentWidth;
    }
  }
  return 0;
}

function updateLimitUI() {
  const totalWords = calculateTotalSelectedWords();
  const slider = document.getElementById("limit-range-slider");
  const badge = document.getElementById("limit-slider-badge");
  const indicator = document.getElementById("limit-selected-indicator");
  const limitChipsContainer = document.getElementById("limit-chips");
  
  if (slider) {
    if (totalWords > 0) {
      slider.min = 0;
      slider.max = 100;
      slider.disabled = false;
    } else {
      slider.min = 0;
      slider.max = 100;
      slider.disabled = true;
    }
  }
  
  let currentVal = state.limit;
  if (currentVal === Infinity) {
    currentVal = totalWords > 0 ? totalWords : 100;
  } else if (totalWords > 0 && currentVal > totalWords) {
    currentVal = totalWords;
    state.limit = totalWords;
  }
  
  if (slider) {
    if (totalWords > 0) {
      const valKeys = getSliderValKeys(totalWords);
      slider.value = valToPct(currentVal, valKeys);
    } else {
      slider.value = 50;
    }
  }
  
  if (badge) {
    badge.innerText = state.limit === Infinity ? (totalWords > 0 ? totalWords : "all") : state.limit;
  }
  
  if (indicator) {
    if (state.limit === Infinity) {
      indicator.innerText = totalWords > 0 ? `Hammasi (${totalWords} ta so'z)` : "Hammasi";
    } else {
      indicator.innerText = `${state.limit} ta so'z`;
    }
  }
  
  if (limitChipsContainer) {
    limitChipsContainer.innerHTML = "";
    
    // Choose standard presets: 10, 20, 50, 100
    const standardPresets = [10, 20, 50, 100];
    const activePresets = [];
    
    standardPresets.forEach(presetVal => {
      if (presetVal < totalWords) {
        activePresets.push(presetVal);
      }
    });
    
    activePresets.forEach(presetVal => {
      const isSelected = (state.limit !== Infinity && state.limit === presetVal);
      const span = document.createElement("span");
      span.className = `tick-preset${isSelected ? " selected" : ""}`;
      span.dataset.val = presetVal;
      span.innerText = presetVal;
      limitChipsContainer.appendChild(span);
    });
    
    const isAllSelected = (state.limit === Infinity);
    const jamiSpan = document.createElement("span");
    jamiSpan.className = `tick-preset${isAllSelected ? " selected" : ""}`;
    jamiSpan.id = "chip-all-btn";
    jamiSpan.dataset.val = "all";
    jamiSpan.innerText = totalWords > 0 ? `Jami (${totalWords})` : "Jami";
    limitChipsContainer.appendChild(jamiSpan);
  }
}

// 5. Setup Screen Logic
function renderActiveBookPanel() {
  const panel = document.getElementById("active-book-panel");
  if (!panel) return;
  
  const activeBookName = state.activeSetupBook;
  if (!activeBookName) return;
  
  const bookUnits = dictionaryData[activeBookName];
  if (!bookUnits) return;
  
  const books = Object.keys(dictionaryData);
  const activeIndex = books.indexOf(activeBookName);
  
  const sortUnits = (keys) => {
    return keys.sort((a, b) => {
      const numA = parseInt(a.replace("Unit ", ""), 10);
      const numB = parseInt(b.replace("Unit ", ""), 10);
      return numA - numB;
    });
  };
  
  const unitNames = sortUnits(Object.keys(bookUnits));
  let wordCount = 0;
  Object.values(bookUnits).forEach(unitWords => {
    wordCount += unitWords.length;
  });
  
  const firstUnitName = unitNames[0];
  const wordsPerUnit = firstUnitName ? bookUnits[firstUnitName].length : 20;
  
  panel.innerHTML = `
    <div class="active-book-header" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
      <span class="active-book-title" style="font-size: 0.82rem; font-weight: 800; color: var(--text-main); white-space: nowrap;">${activeBookName}</span>
      <div class="units-quick-actions" style="margin-left: auto; flex-wrap: nowrap; display: flex; gap: 4px;">
        <button type="button" class="action-chip" onclick="quickSelectUnits(${activeIndex}, 'all')">Barchasi</button>
        <button type="button" class="action-chip" onclick="quickSelectUnits(${activeIndex}, 'none')">Tozalash</button>
        <button type="button" class="action-chip" onclick="quickSelectUnits(${activeIndex}, 'odd')">Toqlar</button>
        <button type="button" class="action-chip" onclick="quickSelectUnits(${activeIndex}, 'even')">Juftlar</button>
      </div>
    </div>
    <div class="units-grid-scroll">
      <div class="units-grid" id="active-units-grid">
        <!-- Rendered dynamically -->
      </div>
    </div>
  `;
  
  const gridContainer = document.getElementById("active-units-grid");
  if (!gridContainer) return;

  gridContainer.style.display = "grid";
  gridContainer.style.gridTemplateColumns = "repeat(10, 1fr)";
  gridContainer.style.gap = "4px";
  gridContainer.style.padding = "2px 0";

  unitNames.forEach(unitName => {
    const compositeKey = `${activeBookName}|||${unitName}`;
    const unitWords = bookUnits[unitName].length;
    const isSelected = state.selectedUnits.includes(compositeKey);
    const chipId = `active-unit-chip-${unitName.replace(/[^a-zA-Z0-9_\-]/g, "-")}`;
    
    const chip = document.createElement("button");
    chip.type = "button";
    chip.id = chipId;
    chip.className = `unit-chip ${isSelected ? "selected" : ""}`;

    const cleanTitle = unitName.replace(/^📁\s*/, "");
    const isLongText = cleanTitle.length > 4;
    const fontSz = isLongText ? (cleanTitle.length > 7 ? "0.45rem" : "0.52rem") : "0.68rem";

    chip.innerHTML = `
      <span style="font-size: ${fontSz}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 96%; display: block; line-height: 1.1;">${escapeHTML(cleanTitle)}</span>
      <span class="unit-chip-meta">${unitWords}</span>
    `;
    
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleUnitChip(activeBookName, unitName, activeIndex);
    });
    
    gridContainer.appendChild(chip);
  });
}

function syncSetupScreenUI() {
  const books = Object.keys(dictionaryData);
  
  books.forEach((bookName, idx) => {
    const tabBtn = document.getElementById(`book-tab-${idx}`);
    if (!tabBtn) return;
    
    const allUnits = Object.keys(dictionaryData[bookName] || {});
    const selectedUnitsForBook = state.selectedUnits.filter(key => key.startsWith(bookName + "|||"));
    const selectedCount = selectedUnitsForBook.length;
    
    tabBtn.classList.toggle("active", bookName === state.activeSetupBook);
    
    const badge = tabBtn.querySelector(".tab-badge");
    if (badge) {
      if (selectedCount === allUnits.length && allUnits.length > 0) {
        badge.innerHTML = "✓";
        badge.style.display = "inline-flex";
      } else if (selectedCount > 0) {
        badge.innerHTML = selectedCount;
        badge.style.display = "inline-flex";
      } else {
        badge.style.display = "none";
      }
    }
  });
  
  if (state.activeSetupBook && dictionaryData[state.activeSetupBook]) {
    const allUnits = Object.keys(dictionaryData[state.activeSetupBook]);
    allUnits.forEach(unitName => {
      const compositeKey = `${state.activeSetupBook}|||${unitName}`;
      const isSelected = state.selectedUnits.includes(compositeKey);
      const chipId = `active-unit-chip-${unitName.replace(/[^a-zA-Z0-9_\-]/g, "-")}`;
      const chip = document.getElementById(chipId);
      if (chip) {
        chip.classList.toggle("selected", isSelected);
      }
    });
  }
  
  state.selectedBooks = [];
  books.forEach(bookName => {
    const hasSelected = state.selectedUnits.some(key => key.startsWith(bookName + "|||"));
    if (hasSelected) {
      state.selectedBooks.push(bookName);
    }
  });
  
  updateLimitUI();
  syncDirectionGlider();
  syncOrderGlider();
}

function initSetupScreen() {
  const books = Object.keys(dictionaryData);
  if (books.length > 0 && !state.activeSetupBook) {
    state.activeSetupBook = books[0];
  }
  
  const tabsContainer = document.getElementById("book-tabs-bar");
  if (tabsContainer) {
    tabsContainer.innerHTML = "";
    books.forEach((bookName, idx) => {
      const tabBtn = document.createElement("button");
      tabBtn.type = "button";
      tabBtn.className = "book-tab-btn";
      tabBtn.id = `book-tab-${idx}`;
      tabBtn.innerHTML = `
        <span class="tab-label">${bookName}</span>
        <span class="tab-badge" style="display: none;">0</span>
      `;
      tabBtn.addEventListener("click", () => {
        state.activeSetupBook = bookName;
        renderActiveBookPanel();
        syncSetupScreenUI();
      });
      tabsContainer.appendChild(tabBtn);
    });
  }
  
  renderActiveBookPanel();
  loadSettings();
}

function toggleUnitChip(bookName, unitName, idx) {
  const compositeKey = `${bookName}|||${unitName}`;
  const keyIndex = state.selectedUnits.indexOf(compositeKey);
  
  if (keyIndex > -1) {
    state.selectedUnits.splice(keyIndex, 1);
  } else {
    state.selectedUnits.push(compositeKey);
  }
  
  syncSetupScreenUI();
  saveSettings();
}

function toggleBookCheckbox(idx) {
  const bookName = Object.keys(dictionaryData)[idx];
  if (!bookName) return;
  
  const allBookUnits = Object.keys(dictionaryData[bookName]);
  const selectedUnitsForBook = state.selectedUnits.filter(key => key.startsWith(bookName + "|||"));
  
  if (selectedUnitsForBook.length > 0) {
    // Some or all selected: deselect all
    state.selectedUnits = state.selectedUnits.filter(key => !key.startsWith(bookName + "|||"));
  } else {
    // None selected: select all
    allBookUnits.forEach(unitName => {
      const compositeKey = `${bookName}|||${unitName}`;
      if (!state.selectedUnits.includes(compositeKey)) {
        state.selectedUnits.push(compositeKey);
      }
    });
  }
  
  syncSetupScreenUI();
  saveSettings();
}



function quickSelectUnits(idx, mode) {
  const bookName = Object.keys(dictionaryData)[idx];
  if (!bookName) return;
  
  const allBookUnits = Object.keys(dictionaryData[bookName]);
  
  // Clear first
  state.selectedUnits = state.selectedUnits.filter(key => !key.startsWith(bookName + "|||"));
  
  if (mode === "all") {
    allBookUnits.forEach(unitName => {
      state.selectedUnits.push(`${bookName}|||${unitName}`);
    });
  } else if (mode === "odd" || mode === "even") {
    allBookUnits.forEach(unitName => {
      const match = unitName.match(/\d+/);
      const num = match ? parseInt(match[0], 10) : 0;
      const isOdd = num % 2 !== 0;
      
      if ((mode === "odd" && isOdd) || (mode === "even" && !isOdd)) {
        state.selectedUnits.push(`${bookName}|||${unitName}`);
      }
    });
  } // 'none' is already cleared by filtering
  
  syncSetupScreenUI();
  saveSettings();
}

function updateBooksState() {
  // Sync selectedBooks array based on active selectedUnits
  state.selectedBooks = [];
  Object.keys(dictionaryData).forEach(bookName => {
    const hasSelected = state.selectedUnits.some(key => key.startsWith(bookName + "|||"));
    if (hasSelected) {
      state.selectedBooks.push(bookName);
    }
  });
}

function updateDirectionLabelsForActiveSetup() {
  const dirChips = document.querySelectorAll('#dir-chips .segmented-item');
  if (dirChips.length < 2) return;

  const activeBook = state.activeSetupBook || Object.keys(dictionaryData)[0];
  let srcCode = "en";
  let tgtCode = "uz";

  if (activeBook && dictionaryData[activeBook]) {
    const units = Object.keys(dictionaryData[activeBook]);
    if (units.length > 0) {
      const firstUnitWords = dictionaryData[activeBook][units[0]] || [];
      if (firstUnitWords.length > 0) {
        if (firstUnitWords[0]._srcLang) srcCode = firstUnitWords[0]._srcLang;
        if (firstUnitWords[0]._tgtLang) tgtCode = firstUnitWords[0]._tgtLang;
      }
    }
  }

  const srcMeta = LANG_META[srcCode] || { name: srcCode, flag: "🌐", code: srcCode };
  const tgtMeta = LANG_META[tgtCode] || { name: tgtCode, flag: "🌐", code: tgtCode };

  const srcStr = (srcMeta.code || srcCode || "en").toString().toUpperCase();
  const tgtStr = (tgtMeta.code || tgtCode || "uz").toString().toUpperCase();

  dirChips[0].innerHTML = `${srcMeta.flag || "🌐"} ${srcStr} → ${tgtMeta.flag || "🌐"} ${tgtStr}`;
  dirChips[1].innerHTML = `${tgtMeta.flag || "🌐"} ${tgtStr} → ${srcMeta.flag || "🌐"} ${srcStr}`;
}

function syncDirectionGlider() {
  updateDirectionLabelsForActiveSetup();
  const glider = document.getElementById("dir-glider");
  if (!glider) return;

  const items = document.querySelectorAll("#dir-chips .segmented-item");
  let activeIndex = 0;
  items.forEach((item, index) => {
    if (item.dataset.val === state.direction) {
      activeIndex = index;
      item.classList.add("selected");
    } else {
      item.classList.remove("selected");
    }
  });

  glider.style.transform = `translateX(calc(${activeIndex * 100}% + ${activeIndex * 4}px))`;
}


function syncOrderGlider() {
  const glider = document.getElementById("order-glider");
  if (!glider) return;

  const items = document.querySelectorAll("#order-chips .segmented-item");
  let activeIndex = 0;
  items.forEach((item, index) => {
    if (item.dataset.val === state.questionOrder) {
      activeIndex = index;
      item.classList.add("selected");
    } else {
      item.classList.remove("selected");
    }
  });

  glider.style.transform = `translateX(calc(${activeIndex * 100}% + ${activeIndex * 4}px))`;
}

// Config Chips Handler
function setupConfigChips() {
  // Direction selection (Segmented Glider)
  const dirChips = document.querySelectorAll('#dir-chips .segmented-item');
  dirChips.forEach(chip => {
    chip.addEventListener("click", () => {
      dirChips.forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      state.direction = chip.dataset.val;
      syncDirectionGlider();
      saveSettings();
    });
  });

  // Question order selection (Segmented Glider)
  const orderChips = document.querySelectorAll('#order-chips .segmented-item');
  orderChips.forEach(chip => {
    chip.addEventListener("click", () => {
      orderChips.forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      state.questionOrder = chip.dataset.val;
      syncOrderGlider();
      saveSettings();
    });
  });

  // Mode selection — picking a mode auto-advances the wizard to step 3
  const modeChips = document.querySelectorAll('#mode-chips .choice-chip');
  modeChips.forEach(chip => {
    chip.addEventListener("click", () => {
      modeChips.forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      state.mode = chip.dataset.val;
      saveSettings();
      if (window.trackEvent) {
        window.trackEvent("mode_selected", {
          mode: state.mode,
          book: state.selectedBooks && state.selectedBooks.length ? state.selectedBooks.join(", ") : null,
          units: state.selectedUnits,
        });
      }
      showWizardStep(3);
    });
  });
  
  // Limits selection (Slider + Preset Ticks)
  const slider = document.getElementById("limit-range-slider");
  
  if (slider) {
    slider.addEventListener("input", (e) => {
      const pct = parseFloat(e.target.value);
      const totalWords = calculateTotalSelectedWords();
      
      if (totalWords > 0) {
        const valKeys = getSliderValKeys(totalWords);
        const val = pctToVal(pct, valKeys);
        
        if (val >= totalWords) {
          state.limit = Infinity;
        } else {
          state.limit = val;
        }
      } else {
        state.limit = 20;
      }
      
      updateLimitUI();
      saveSettings();
    });
  }
  
  const limitChipsContainer = document.getElementById("limit-chips");
  if (limitChipsContainer) {
    limitChipsContainer.addEventListener("click", (e) => {
      const chip = e.target.closest('.tick-preset');
      if (!chip) return;
      
      const valAttr = chip.dataset.val;
      const totalWords = calculateTotalSelectedWords();
      
      if (valAttr === "all") {
        state.limit = Infinity;
      } else {
        const valNum = parseInt(valAttr, 10);
        state.limit = Math.min(valNum, totalWords > 0 ? totalWords : valNum);
      }
      
      updateLimitUI();
      saveSettings();
    });
  }

  const limitInfoBtn = document.getElementById("limit-info-btn");
  if (limitInfoBtn) {
    limitInfoBtn.addEventListener("click", () => {
      showAppAlert(
        "So'zlar sonini tanlash",
        "Surgichni surib, tanlangan unitlardagi so'zlarning barchasi bilan emas, faqat bir qismi bilan mashq qilishingiz mumkin. Masalan, 100 ta so'zdan atigi 10 yoki 40 tasini tanlab, qisqaroq mashq qilsangiz bo'ladi. Standart holatda barcha so'zlar tanlangan bo'ladi."
      );
    });
  }
}

// Progressive setup: reveal remaining config once a practice type is chosen
function updateModeSummary() {
  const selected = document.querySelector('#mode-chips .choice-chip.selected');
  if (!selected) return;
  const emojiEl = selected.querySelector('.mode-emoji');
  const nameEl = selected.querySelector('.mode-name');
  const emojiOut = document.getElementById('mode-summary-emoji');
  const nameOut = document.getElementById('mode-summary-name');
  if (emojiOut) emojiOut.textContent = emojiEl ? emojiEl.textContent : '🎯';
  if (nameOut) nameOut.textContent = nameEl ? nameEl.textContent : '';
}

function revealConfigSteps() {
  // Always visible now
}

function expandModePicker() {
  // Always visible now
}

// 6. LocalStorage States
function saveSettings() {
  localStorage.setItem("vocab_selected_books", JSON.stringify(state.selectedBooks));
  localStorage.setItem("vocab_selected_units", JSON.stringify(state.selectedUnits));
  localStorage.setItem("vocab_direction", state.direction);
  localStorage.setItem("vocab_mode", state.mode);
  localStorage.setItem("vocab_limit", state.limit.toString());
  localStorage.setItem("vocab_question_order", state.questionOrder);
}

function loadSettings() {
  try {
    const savedBooks = localStorage.getItem("vocab_selected_books");
    const savedUnits = localStorage.getItem("vocab_selected_units");
    const savedDirection = localStorage.getItem("vocab_direction");
    const savedMode = localStorage.getItem("vocab_mode");
    const savedLimit = localStorage.getItem("vocab_limit");
    const savedOrder = localStorage.getItem("vocab_question_order");

    if (savedBooks && savedUnits) {
      state.selectedBooks = JSON.parse(savedBooks);
      state.selectedUnits = JSON.parse(savedUnits);
    } else {
      // Default: select only Essential 1 and Unit 1
      state.selectedBooks = ["Essential 1"];
      state.selectedUnits = ["Essential 1|||Unit 1"];
    }
    
    // Set active Setup book based on selected books
    if (state.selectedBooks.length > 0) {
      state.activeSetupBook = state.selectedBooks[0];
    } else {
      const firstBook = Object.keys(dictionaryData)[0];
      if (firstBook) state.activeSetupBook = firstBook;
    }
    
    if (savedDirection) {
      state.direction = savedDirection;
    }
    
    if (savedMode) {
      state.mode = savedMode;
    }
    
    if (savedLimit) {
      state.limit = savedLimit === "Infinity" ? Infinity : parseInt(savedLimit, 10);
    }

    if (savedOrder === "random" || savedOrder === "sequential") {
      state.questionOrder = savedOrder;
    }

    // Sync all UI states
    renderActiveBookPanel();
    syncSetupScreenUI();
    syncOrderGlider();

    document.querySelectorAll('#mode-chips .choice-chip').forEach(chip => {
      chip.classList.toggle("selected", chip.dataset.val === state.mode);
    });
  } catch (err) {
    console.error("Local storage loaded values corrupted. Resetting...", err);
    state.selectedBooks = ["Essential 1"];
    state.selectedUnits = ["Essential 1|||Unit 1"];
    state.direction = "en-uz";
    state.mode = "multiple";
    state.limit = Infinity;
    state.questionOrder = "random";
    renderActiveBookPanel();
    syncSetupScreenUI();
    syncOrderGlider();
  }
}


// 7. Settings Screen View Logic & Sound Synthesis
function initSettingsScreen() {
  const themeBtns = document.querySelectorAll(".theme-btn");
  const rateSlider = document.getElementById("settings-speech-rate");
  const rateVal = document.getElementById("rate-val");
  const pitchSlider = document.getElementById("settings-speech-pitch");
  const pitchVal = document.getElementById("pitch-val");
  const timerCheckbox = document.getElementById("settings-timer-mode");
  const sfxCheckbox = document.getElementById("settings-sound-sfx");
  const resetBtn = document.getElementById("settings-reset-btn");
  
  // 1. Load settings from localStorage
  const savedTheme = localStorage.getItem("vocab_theme") || "neon-night";
  applyTheme(savedTheme);
  
  state.speechRate = parseFloat(localStorage.getItem("settings_speech_rate") || "1.0");
  if (rateSlider) {
    rateSlider.value = state.speechRate;
    setSliderFill(rateSlider);
    if (rateVal) rateVal.innerText = `${state.speechRate.toFixed(1)}x`;
  }

  state.speechPitch = parseFloat(localStorage.getItem("settings_speech_pitch") || "1.0");
  if (pitchSlider) {
    pitchSlider.value = state.speechPitch;
    setSliderFill(pitchSlider);
    if (pitchVal) pitchVal.innerText = `${state.speechPitch.toFixed(1)}`;
  }
  
  state.timerMode = localStorage.getItem("settings_timer_mode") === "true";
  if (timerCheckbox) {
    timerCheckbox.checked = state.timerMode;
  }
  
  state.soundSfx = (localStorage.getItem("settings_sound_sfx") !== "false"); // default true
  if (sfxCheckbox) {
    sfxCheckbox.checked = state.soundSfx;
  }
  
  // No voice configuration in settings — speakWord() uses the system default English voice.

  // 2. Event Listeners
  // Theme Buttons
  themeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
    });
  });
  
  // Rate Slider
  if (rateSlider) {
    rateSlider.addEventListener("input", (e) => {
      state.speechRate = parseFloat(e.target.value);
      localStorage.setItem("settings_speech_rate", state.speechRate);
      setSliderFill(e.target);
      if (rateVal) rateVal.innerText = `${state.speechRate.toFixed(1)}x`;
    });
  }
  
  // Pitch Slider
  if (pitchSlider) {
    pitchSlider.addEventListener("input", (e) => {
      state.speechPitch = parseFloat(e.target.value);
      localStorage.setItem("settings_speech_pitch", state.speechPitch);
      setSliderFill(e.target);
      if (pitchVal) pitchVal.innerText = `${state.speechPitch.toFixed(1)}`;
    });
  }
  
  // Timer Checkbox
  if (timerCheckbox) {
    timerCheckbox.addEventListener("change", (e) => {
      state.timerMode = e.target.checked;
      localStorage.setItem("settings_timer_mode", state.timerMode);
    });
  }
  
  // SFX Checkbox
  if (sfxCheckbox) {
    sfxCheckbox.addEventListener("change", (e) => {
      state.soundSfx = e.target.checked;
      localStorage.setItem("settings_sound_sfx", state.soundSfx);
    });
  }
  
  // Reset Button
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      showAppConfirm(
        "Hammasini tozalaysizmi?",
        "Barcha saqlangan natijalar va sozlamalarni o'chirishni xohlaysizmi?",
        () => {
          localStorage.clear();
          window.location.reload();
        }
      );
    });
  }
}

// Paint a range input's fill up to its current value (0.5–1.5 → 0–100%)
function setSliderFill(el) {
  if (!el) return;
  const min = parseFloat(el.min), max = parseFloat(el.max);
  const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
  el.style.setProperty("--pct", `${pct}%`);
}

function applyTheme(themeName) {
  document.documentElement.setAttribute("data-theme", themeName);
  localStorage.setItem("vocab_theme", themeName);
  
  updateThemeIcon(themeName);
  
  document.querySelectorAll(".theme-btn").forEach(btn => {
    if (btn.dataset.theme === themeName) {
      btn.classList.add("selected");
    } else {
      btn.classList.remove("selected");
    }
  });
}

// Synthesize sound effects offline-first using Web Audio API
function playSound(type) {
  if (!state.soundSfx) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === "correct") {
      // Clean C5 - E5 double beep
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } else if (type === "incorrect") {
      // Dull low buzzer
      osc.type = "triangle";
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.setValueAtTime(100, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.32);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    }
  } catch (err) {
    console.error("Audio synth error", err);
  }
}

function handleTimeOut() {
  playSound("incorrect");
  state.incorrectCount++;
  state.streak = 0;
  
  const currentWord = state.questions[state.currentIndex];
  state.mistakes.push({ word: currentWord, userAnswer: "Vaqt tugadi ⏳" });
  
  // Disable option buttons in MCQ, Gap, Def
  document.querySelectorAll(".option-choice-btn").forEach(btn => {
    btn.disabled = true;
  });
  
  if (state.mode === "multiple") {
    const correctVal = currentWord.activeDirection === "en-uz" ? currentWord.uz : currentWord.en;
    document.querySelectorAll("#mc-options-box .option-choice-btn").forEach(btn => {
      if (btn.innerText.trim() === correctVal) {
        btn.classList.add("correct");
      }
    });
  }
  
  if (state.mode === "fillgap") {
    const correctVal = currentWord.en;
    document.querySelectorAll("#fg-options-box .option-choice-btn").forEach(btn => {
      if (btn.innerText.trim().toLowerCase() === correctVal.toLowerCase()) {
        btn.classList.add("correct");
      }
    });
  }
  
  if (state.mode === "definition") {
    const correctVal = currentWord.activeDirection === "en-uz" ? currentWord.uz : currentWord.en;
    document.querySelectorAll("#def-options-box .option-choice-btn").forEach(btn => {
      if (btn.innerText.trim() === correctVal) {
        btn.classList.add("correct");
      }
    });
  }
  
  const inputEl = document.getElementById("as-input") || document.getElementById("aw-input");
  if (inputEl) {
    inputEl.disabled = true;
    inputEl.classList.add("error");
  }
  
  const nextBtn = document.getElementById("next-question-btn");
  if (nextBtn) {
    nextBtn.classList.add("answered");
    const btnText = document.getElementById("next-btn-text");
    if (btnText) {
      btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
    }
  }
  
  state.autoAdvanceTimeout = setTimeout(() => {
    nextQuestion();
  }, 1800);
}

function renderDictionaryList() {
  const listContainer = document.getElementById("dict-words-list");
  const countLabel = document.getElementById("dict-words-count");

  // Tear down any previous infinite-scroll observer before rebuilding
  if (dictScrollObserver) {
    dictScrollObserver.disconnect();
    dictScrollObserver = null;
  }
  listContainer.innerHTML = "";
  dictMatches = [];
  dictRenderedCount = 0;
  dictLastGroup = null;

  const query = state.dictSearchQuery ? state.dictSearchQuery.trim().toLowerCase() : "";
  const bookFilter = state.activeDictBook;

  if (!query || query.length < 2) {
    countLabel.innerText = "Qidirish kutilmoqda";
    listContainer.innerHTML = `
      <div class="metric-card" style="text-align: center; color: var(--text-muted); font-weight: 600; padding: 25px; font-size: 0.85rem; border: 1px dashed var(--card-border); border-radius: 12px; margin-top: 15px;">
        🔍 So'zlarni ko'rish uchun kamida 2 ta harf yozing.
      </div>
    `;
    return;
  }

  // Gather and filter matches
  Object.keys(dictionaryData).forEach(bookName => {
    if (bookFilter !== "all" && bookName !== bookFilter) return;

    Object.keys(dictionaryData[bookName]).forEach(unitName => {
      dictionaryData[bookName][unitName].forEach(item => {
        const matchQuery = item.en.toLowerCase().includes(query) ||
                           item.uz.toLowerCase().includes(query) ||
                           (item.def && item.def.toLowerCase().includes(query));
        if (matchQuery) {
          dictMatches.push({
            ...item,
            book: bookName,
            unit: unitName
          });
        }
      });
    });
  });

  // Cap at 30 results to prevent scraping/copying
  const maxResults = 30;
  let isCapped = false;
  const totalFound = dictMatches.length;
  if (totalFound > maxResults) {
    dictMatches = dictMatches.slice(0, maxResults);
    isCapped = true;
  }

  // Display total matching count
  if (isCapped) {
    countLabel.innerText = `${totalFound} ta so'z topildi (top ${maxResults} ko'rsatildi)`;
  } else {
    countLabel.innerText = `${dictMatches.length} ta so'z topildi`;
  }

  if (dictMatches.length === 0) {
    listContainer.innerHTML = `
      <div class="metric-card" style="text-align: center; color: var(--text-muted); font-weight: 600; padding: 20px;">
        Hech qanday so'z topilmadi.
      </div>
    `;
    return;
  }

  // Sentinel sits at the bottom of the list; scrolling it into view loads more
  const sentinel = document.createElement("div");
  sentinel.id = "dict-scroll-sentinel";
  sentinel.className = "dict-scroll-sentinel";
  listContainer.appendChild(sentinel);

  // Render the first batch immediately so the view is never empty
  renderNextDictBatch();

  // Lazily load the remaining batches as the sentinel approaches the viewport
  if (dictRenderedCount < dictMatches.length) {
    const scrollRoot = document.querySelector(".main-content-scroll");
    dictScrollObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) renderNextDictBatch();
      });
    }, { root: scrollRoot, rootMargin: "400px 0px" });
    dictScrollObserver.observe(sentinel);
  }
}

// 8. Session Engine
function startQuiz(mistakesOnly = false) {
  // Cancel active timers
  if (state.autoAdvanceTimeout) clearTimeout(state.autoAdvanceTimeout);
  
  let pool = [];
  
  if (mistakesOnly) {
    // Retry incorrect words from the previous session
    pool = state.mistakes.map(m => m.word);
  } else {
    // Standard pool gathering
    if (state.selectedUnits.length === 0) {
      showAppAlert("Unit tanlanmagan", "Iltimos, kamida 1 ta kitob va unitni tanlang!");
      return;
    }
    
    state.selectedUnits.forEach(compositeKey => {
      const [book, unit] = compositeKey.split("|||");
      if (dictionaryData[book] && dictionaryData[book][unit]) {
        dictionaryData[book][unit].forEach(item => {
          pool.push({
            ...item,
            book: book,
            unit: unit
          });
        });
      }
    });
  }
  
  if (pool.length === 0) {
    showAppAlert("Savollar topilmadi", "Savollar havzasi bo'sh. Iltimos, kitob va unitlarni tekshiring.");
    return;
  }
  
  // Order the pool per the user's chosen question order
  if (state.questionOrder !== "sequential") {
    pool = shuffleArray(pool);
  }

  // Cap at limits
  const actualLimit = Math.min(pool.length, state.limit);
  state.questions = pool.slice(0, actualLimit);
  
  // Reset counters
  state.currentIndex = 0;
  state.correctCount = 0;
  state.incorrectCount = 0;
  state.streak = 0;
  state.maxStreak = 0;
  state.mistakes = [];
  
  showScreen("quiz-screen");
  renderQuestion();
}

function renderQuestion() {
  if (state.questionTimer) {
    clearInterval(state.questionTimer);
    state.questionTimer = null;
  }

  if (state.currentIndex >= state.questions.length) {
    finishQuiz();
    return;
  }
  
  // Update Meta Header
  document.getElementById("q-count").innerText = `${state.currentIndex + 1}/${state.questions.length}`;
  document.getElementById("streak-val").innerText = state.streak;
  
  const streakBlock = document.getElementById("streak-block");
  if (state.streak > 0) {
    streakBlock.style.display = "flex";
  } else {
    streakBlock.style.display = "none";
  }
  
  // Handle countdown timer
  const timerBlock = document.getElementById("timer-block");
  if (state.timerMode) {
    if (timerBlock) {
      timerBlock.style.display = "flex";
      state.timeLeft = 15;
      document.getElementById("timer-val").innerText = state.timeLeft;
      state.questionTimer = setInterval(() => {
        state.timeLeft--;
        const timerVal = document.getElementById("timer-val");
        if (timerVal) timerVal.innerText = state.timeLeft;
        if (state.timeLeft <= 0) {
          clearInterval(state.questionTimer);
          state.questionTimer = null;
          handleTimeOut();
        }
      }, 1000);
    }
  } else {
    if (timerBlock) timerBlock.style.display = "none";
  }
  
  // Update Progress Bar
  const progressPct = (state.currentIndex / state.questions.length) * 100;
  document.getElementById("q-progress-bar").style.width = `${progressPct}%`;
  
  // Hide all Mode UI
  document.getElementById("flashcard-mode-section").style.display = "none";
  document.getElementById("multiple-mode-section").style.display = "none";
  document.getElementById("match-mode-section").style.display = "none";
  document.getElementById("cover-mode-section").style.display = "none";
  document.getElementById("linematch-mode-section").style.display = "none";
  const fgSection = document.getElementById("fillgap-mode-section");
  if (fgSection) fgSection.style.display = "none";
  const defSection = document.getElementById("definition-mode-section");
  if (defSection) defSection.style.display = "none";
  const wsSection = document.getElementById("wordsearch-mode-section");
  if (wsSection) wsSection.style.display = "none";
  const asSection = document.getElementById("audiospelling-mode-section");
  if (asSection) asSection.style.display = "none";
  const awSection = document.getElementById("audiowrite-mode-section");
  if (awSection) awSection.style.display = "none";
  const bpSection = document.getElementById("balloon-mode-section");
  if (bpSection) bpSection.style.display = "none";
  const tankSection = document.getElementById("tank-mode-section");
  if (tankSection) tankSection.style.display = "none";

  
  // Reset next button state (it acts as "Skip" by default)
  const nextBtn = document.getElementById("next-question-btn");
  if (nextBtn) {
    // Skip/Next control removed for these modes: flashcard and cover have
    // their own advance actions, and the rest already auto-advance once
    // answered (or, for match/linematch, once the round is completed).
    const noSkipModes = ["flashcard", "cover", "multiple", "definition", "fillgap", "match", "linematch", "balloon", "tank", "audiospelling", "audiowrite"];
    nextBtn.style.display = noSkipModes.includes(state.mode) ? "none" : "flex";
    nextBtn.classList.remove("answered");
    const btnText = document.getElementById("next-btn-text");
    if (btnText) {
      if (state.currentIndex === state.questions.length - 1) {
        btnText.innerText = "O'tkazib yuborish & Yakunlash";
      } else {
        btnText.innerText = "O'tkazib yuborish";
      }
    }
  }
  
  const currentWord = state.questions[state.currentIndex];
  
  // Determine question direction (EN or UZ)
  let qDir = state.direction;
  if (qDir === "mixed") {
    qDir = Math.random() < 0.5 ? "en-uz" : "uz-en";
  }
  
  // Store dynamic state to word object for reporting
  currentWord.activeDirection = qDir;
  
  // Execute Mode layouts
  if (state.mode === "flashcard") {
    setupFlashcardMode(currentWord, qDir);
  } else if (state.mode === "multiple") {
    setupMultipleChoiceMode(currentWord, qDir);
  } else if (state.mode === "match") {
    setupMatchMode();
  } else if (state.mode === "cover") {
    setupCoverMode();
  } else if (state.mode === "linematch") {
    setupLineMatchMode();
  } else if (state.mode === "fillgap") {
    setupFillGapMode(currentWord, qDir);
  } else if (state.mode === "definition") {
    setupDefinitionMode(currentWord, qDir);
  } else if (state.mode === "wordsearch") {
    setupWordSearchMode(currentWord, qDir);
  } else if (state.mode === "audiospelling") {
    setupAudioSpellingMode(currentWord, qDir);
  } else if (state.mode === "audiowrite") {
    setupAudioWriteMode(currentWord, qDir);
  } else if (state.mode === "balloon") {
    setupBalloonPopMode(currentWord, qDir);
  } else if (state.mode === "tank") {
    setupTankMode(currentWord, qDir);
  }
}

// Dynamic Target Word Highlighter in Example Sentences
function highlightExampleTarget(exampleText, targetWord) {
  if (!exampleText || !targetWord) return exampleText || "";
  const cleanTarget = targetWord.trim().toLowerCase();
  
  // Create stems matching variations (plural, past tense, progressive)
  const stems = [cleanTarget];
  if (cleanTarget.endsWith("y")) {
    stems.push(cleanTarget.slice(0, -1) + "ie[d|s]");
  } else if (cleanTarget.endsWith("e")) {
    stems.push(cleanTarget + "d?");
    stems.push(cleanTarget.slice(0, -1) + "ing");
  } else {
    stems.push(cleanTarget + "s?");
    stems.push(cleanTarget + "ed");
    stems.push(cleanTarget + "ing");
  }
  
  const stemRegexStr = `\\b(${stems.join("|")})\\b`;
  try {
    const regex = new RegExp(stemRegexStr, 'gi');
    return exampleText.replace(regex, `<span class="example-target-highlight">$1</span>`);
  } catch (e) {
    return exampleText;
  }
}

// Helper to replace target word with blank underscores in sentences
function getBlankedExample(exampleText, targetWord) {
  if (!exampleText || !targetWord) return exampleText || "";
  const cleanTarget = targetWord.trim().toLowerCase();
  
  // Create stems matching variations (plural, past tense, progressive)
  const stems = [cleanTarget];
  if (cleanTarget.endsWith("y")) {
    stems.push(cleanTarget.slice(0, -1) + "ie[d|s]");
  } else if (cleanTarget.endsWith("e")) {
    stems.push(cleanTarget + "d?");
    stems.push(cleanTarget.slice(0, -1) + "ing");
  } else {
    stems.push(cleanTarget + "s?");
    stems.push(cleanTarget + "ed");
    stems.push(cleanTarget + "ing");
  }
  
  const stemRegexStr = `\\b(${stems.join("|")})\\b`;
  try {
    const regex = new RegExp(stemRegexStr, 'gi');
    return exampleText.replace(regex, "______");
  } catch (e) {
    return exampleText.replace(targetWord, "______");
  }
}

// Helper to gather all words in active units or full dictionary for distractor picking
function getDistractorPool() {
  let pool = [];
  state.selectedUnits.forEach(compositeKey => {
    const [book, unit] = compositeKey.split("|||");
    if (dictionaryData[book] && dictionaryData[book][unit]) {
      dictionaryData[book][unit].forEach(w => {
        pool.push(w);
      });
    }
  });
  
  if (pool.length < 4) {
    Object.keys(dictionaryData).forEach(book => {
      Object.keys(dictionaryData[book]).forEach(unit => {
        dictionaryData[book][unit].forEach(w => {
          pool.push(w);
        });
      });
    });
  }
  return pool;
}

// Mode UI Setup: Fill the Gap (Gapni to'ldirish)
function setupFillGapMode(wordItem, direction) {
  const container = document.getElementById("fillgap-mode-section");
  if (!container) return;
  container.style.display = "block";

  const questionSentence = document.getElementById("fg-question-sentence");
  const optionsBox = document.getElementById("fg-options-box");
  if (!questionSentence || !optionsBox) return;
  optionsBox.innerHTML = "";

  const blanked = getBlankedExample(wordItem.ex, wordItem.en);

  questionSentence.innerHTML = `
    <div style="font-size: 1.15rem; line-height: 1.6; font-weight: 500;">
      "${blanked}"
    </div>
  `;

  let distractorPool = getDistractorPool();
  const targetWord = wordItem.en;
  let distractors = distractorPool
    .map(w => w.en)
    .filter(val => val.toLowerCase() !== targetWord.toLowerCase());
  distractors = [...new Set(distractors)];
  distractors = shuffleArray(distractors).slice(0, 3);

  let choices = [targetWord, ...distractors];
  choices = shuffleArray(choices);

  choices.forEach(optionText => {
    const btn = document.createElement("button");
    btn.className = "option-choice-btn";
    btn.innerHTML = `<span>${optionText}</span>`;

    btn.addEventListener("click", () => {
      handleFillGapSelection(btn, optionText, targetWord, wordItem);
    });

    optionsBox.appendChild(btn);
  });
}

function handleFillGapSelection(selectedBtn, selectedVal, correctVal, wordItem) {
  document.querySelectorAll("#fg-options-box .option-choice-btn").forEach(btn => {
    btn.disabled = true;
  });

  const isCorrect = selectedVal.toLowerCase() === correctVal.toLowerCase();
  const qCard = document.getElementById("fg-word-card");
  const questionSentence = document.getElementById("fg-question-sentence");

  if (isCorrect) {
    playSound("correct");
    selectedBtn.classList.add("correct");
    selectedBtn.classList.add("pop-it");
    state.correctCount++;
    state.streak++;
    state.maxStreak = Math.max(state.streak, state.maxStreak);
    
    if (questionSentence) {
      const highlightedEx = highlightExampleTarget(wordItem.ex, wordItem.en);
      questionSentence.innerHTML = `
        <div style="font-size: 1.15rem; line-height: 1.6; margin-bottom: 12px; font-weight: 500;">
          "${highlightedEx}"
        </div>
        <div style="font-size: 0.85rem; color: var(--success); font-weight: 600; margin-top: 6px;">
          To'g'ri! 🎉
        </div>
      `;
    }

    speakWord(wordItem.ex, () => {
      state.autoAdvanceTimeout = setTimeout(() => {
        if (qCard) qCard.classList.remove("shake-it");
        nextQuestion();
      }, 1000);
    });
  } else {
    playSound("incorrect");
    selectedBtn.classList.add("incorrect");
    if (qCard) qCard.classList.add("shake-it");
    state.incorrectCount++;
    state.streak = 0;
    state.mistakes.push({ word: wordItem, userAnswer: selectedVal });

    if (questionSentence) {
      const highlightedEx = highlightExampleTarget(wordItem.ex, wordItem.en);
      questionSentence.innerHTML = `
        <div style="font-size: 1.15rem; line-height: 1.6; margin-bottom: 12px; font-weight: 500;">
          "${highlightedEx}"
        </div>
        <div style="font-size: 0.85rem; color: var(--danger); font-weight: 600; margin-top: 6px;">
          Noto'g'ri. To'g'ri javob: ${correctVal}
        </div>
      `;
    }

    document.querySelectorAll("#fg-options-box .option-choice-btn").forEach(btn => {
      if (btn.innerText.trim().toLowerCase() === correctVal.toLowerCase()) {
        btn.classList.add("correct");
      }
    });

    speakWord(correctVal, () => {
      state.autoAdvanceTimeout = setTimeout(() => {
        if (qCard) qCard.classList.remove("shake-it");
        nextQuestion();
      }, 1200);
    });
  }

  const nextBtn = document.getElementById("next-question-btn");
  if (nextBtn) {
    nextBtn.classList.add("answered");
    const btnText = document.getElementById("next-btn-text");
    if (btnText) {
      btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
    }
  }
}

// Mode UI Setup: Definition Match (Ta'rifni topish)
function setupDefinitionMode(wordItem, direction) {
  const container = document.getElementById("definition-mode-section");
  if (!container) return;
  container.style.display = "block";

  const questionText = document.getElementById("def-question-text");
  const optionsBox = document.getElementById("def-options-box");
  if (!questionText || !optionsBox) return;
  optionsBox.innerHTML = "";

  const targetField = (direction === "en-uz") ? "uz" : "en";
  const correctAnswer = wordItem[targetField];

  questionText.innerHTML = `
    <div style="font-size: 1.1rem; line-height: 1.5; color: var(--text-main); font-weight: 500; font-style: italic;">
      "${wordItem.def}"
    </div>
    <div id="def-hint-word" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px; font-weight: 600; display: none;">
      So'z: ${wordItem.en}
    </div>
  `;

  let distractorPool = getDistractorPool();
  let distractors = distractorPool
    .map(w => w[targetField])
    .filter(val => val !== correctAnswer);
  distractors = [...new Set(distractors)];
  distractors = shuffleArray(distractors).slice(0, 3);

  let choices = [correctAnswer, ...distractors];
  choices = shuffleArray(choices);

  choices.forEach(optionText => {
    const btn = document.createElement("button");
    btn.className = "option-choice-btn";
    btn.innerHTML = `<span>${optionText}</span>`;

    btn.addEventListener("click", () => {
      handleDefinitionSelection(btn, optionText, correctAnswer, wordItem, targetField);
    });

    optionsBox.appendChild(btn);
  });
}

function handleDefinitionSelection(selectedBtn, selectedVal, correctVal, wordItem, targetField) {
  document.querySelectorAll("#def-options-box .option-choice-btn").forEach(btn => {
    btn.disabled = true;
  });

  const isCorrect = selectedVal === correctVal;
  const qCard = document.getElementById("def-word-card");
  const hintWord = document.getElementById("def-hint-word");

  if (isCorrect) {
    playSound("correct");
    selectedBtn.classList.add("correct");
    selectedBtn.classList.add("pop-it");
    state.correctCount++;
    state.streak++;
    state.maxStreak = Math.max(state.streak, state.maxStreak);
    
    if (hintWord) {
      hintWord.innerHTML = `<span style="color: var(--success); font-weight: 700;">To'g'ri! So'z: ${wordItem.en} (${wordItem.uz})</span>`;
      hintWord.style.display = "block";
    }

    speakWord(wordItem.en, () => {
      state.autoAdvanceTimeout = setTimeout(() => {
        if (qCard) qCard.classList.remove("shake-it");
        nextQuestion();
      }, 1000);
    });
  } else {
    playSound("incorrect");
    selectedBtn.classList.add("incorrect");
    if (qCard) qCard.classList.add("shake-it");
    state.incorrectCount++;
    state.streak = 0;
    state.mistakes.push({ word: wordItem, userAnswer: selectedVal });

    if (hintWord) {
      hintWord.innerHTML = `<span style="color: var(--danger); font-weight: 700;">Noto'g'ri. So'z: ${wordItem.en} (${wordItem.uz})</span>`;
      hintWord.style.display = "block";
    }

    document.querySelectorAll("#def-options-box .option-choice-btn").forEach(btn => {
      if (btn.innerText.trim() === correctVal) {
        btn.classList.add("correct");
      }
    });

    speakWord(wordItem.en, () => {
      state.autoAdvanceTimeout = setTimeout(() => {
        if (qCard) qCard.classList.remove("shake-it");
        nextQuestion();
      }, 1200);
    });
  }

  const nextBtn = document.getElementById("next-question-btn");
  if (nextBtn) {
    nextBtn.classList.add("answered");
    const btnText = document.getElementById("next-btn-text");
    if (btnText) {
      btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
    }
  }
}

// ============================================================
// Canvas Confetti Particle System
// ============================================================
let confettiActive = false;
let confettiAnimId = null;
let confettiParticles = [];

function triggerConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) return;
  canvas.style.display = "block";
  const ctx = canvas.getContext("2d");
  
  const resizeCanvas = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  
  confettiParticles = [];
  const colors = ["#ff5964", "#35a7ff", "#386150", "#ffe74c", "#ffffff", "#ec4899", "#8b5cf6", "#10b981"];
  const particleCount = 120;
  
  for (let i = 0; i < particleCount; i++) {
    confettiParticles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height - 20,
      size: Math.random() * 6 + 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: Math.random() * 4 - 2,
      vy: Math.random() * 5 + 4,
      rotation: Math.random() * 360,
      rotationSpeed: Math.random() * 6 - 3,
      opacity: 1,
      decay: Math.random() * 0.006 + 0.003
    });
  }
  
  if (confettiActive) {
    cancelAnimationFrame(confettiAnimId);
  }
  confettiActive = true;
  
  function updateAndDraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let activeCount = 0;
    
    confettiParticles.forEach(p => {
      if (p.y > canvas.height || p.opacity <= 0) return;
      activeCount++;
      
      p.x += p.vx + Math.sin(p.y / 30) * 0.5;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;
      p.opacity -= p.decay;
      
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.5);
      ctx.restore();
    });
    
    if (activeCount > 0 && confettiActive) {
      confettiAnimId = requestAnimationFrame(updateAndDraw);
    } else {
      confettiActive = false;
      canvas.style.display = "none";
      window.removeEventListener("resize", resizeCanvas);
    }
  }
  
  confettiAnimId = requestAnimationFrame(updateAndDraw);
}

function stopConfetti() {
  confettiActive = false;
  if (confettiAnimId) {
    cancelAnimationFrame(confettiAnimId);
    confettiAnimId = null;
  }
  const canvas = document.getElementById("confetti-canvas");
  if (canvas) canvas.style.display = "none";
}

// ============================================================
// Speech Recognition Logic (Talaffuzni tekshirish)
// ============================================================
let speechRecognition = null;
let isSpeechRecognitionActive = false;
let activeSpeechButton = null;
let activeSpeechFeedback = null;

function initSpeechRecognition() {
  if (speechRecognition) return speechRecognition;
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return null;
  }
  
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;
  
  recognition.onstart = () => {
    isSpeechRecognitionActive = true;
    if (activeSpeechButton) {
      activeSpeechButton.classList.add("listening");
    }
    if (activeSpeechFeedback) {
      activeSpeechFeedback.innerText = "Eshityapman... gapiring 🎙";
      activeSpeechFeedback.classList.add("visible");
      activeSpeechFeedback.classList.remove("success", "error");
    }
  };
  
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const spokenText = transcript.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
    
    if (activeSpeechButton) {
      const targetWord = activeSpeechButton.dataset.word.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
      const isMatch = spokenText === targetWord;
      
      activeSpeechButton.classList.remove("listening");
      if (isMatch) {
        activeSpeechButton.classList.add("success");
        if (activeSpeechFeedback) {
          activeSpeechFeedback.innerText = `Zo'r! 🌟 100% ("${transcript}")`;
          activeSpeechFeedback.classList.add("visible", "success");
        }
      } else {
        activeSpeechButton.classList.add("error");
        if (activeSpeechFeedback) {
          activeSpeechFeedback.innerText = `Qayta urining: "${transcript}"`;
          activeSpeechFeedback.classList.add("visible", "error");
        }
      }
    }
  };
  
  recognition.onerror = (event) => {
    if (activeSpeechButton) {
      activeSpeechButton.classList.remove("listening");
      activeSpeechButton.classList.add("error");
      
      let errorMsg = "Xato yuz berdi.";
      if (event.error === 'not-allowed') {
        errorMsg = "Mikrofon ruxsatsiz.";
      } else if (event.error === 'no-speech') {
        errorMsg = "Ovoz eshitilmadi.";
      }
      
      if (activeSpeechFeedback) {
        activeSpeechFeedback.innerText = errorMsg;
        activeSpeechFeedback.classList.add("visible", "error");
      }
    }
  };
  
  recognition.onend = () => {
    isSpeechRecognitionActive = false;
    if (activeSpeechButton) {
      activeSpeechButton.classList.remove("listening");
      
      const targetBtn = activeSpeechButton;
      const targetFeedback = activeSpeechFeedback;
      setTimeout(() => {
        targetBtn.classList.remove("success", "error");
        if (targetFeedback && targetFeedback.classList.contains("visible") && !targetBtn.classList.contains("listening")) {
          targetFeedback.classList.remove("visible", "success", "error");
          targetFeedback.innerText = "";
        }
      }, 3500);
    }
  };
  
  speechRecognition = recognition;
  return speechRecognition;
}

function handleSpeechRecognitionClick(btn, feedbackEl, targetWord) {
  const recognition = initSpeechRecognition();
  if (!recognition) {
    showAppAlert("Qo'llab-quvvatlanmaydi", "Brauzeringizda ovozni aniqlash tizimi ishlamaydi. Iltimos Chrome, Safari yoki Edge ishlating.");
    return;
  }
  
  btn.dataset.word = targetWord;
  activeSpeechButton = btn;
  activeSpeechFeedback = feedbackEl;
  
  if (isSpeechRecognitionActive) {
    try { recognition.stop(); } catch(e) {}
  } else {
    btn.classList.remove("success", "error");
    if (feedbackEl) {
      feedbackEl.innerText = "";
      feedbackEl.classList.remove("visible", "success", "error");
    }
    
    try {
      recognition.start();
    } catch (err) {
      console.warn("Speech start failed:", err);
    }
  }
}

function playSpeakEffect(btn) {
  if (!btn) return;
  btn.classList.add("playing");
  setTimeout(() => btn.classList.remove("playing"), 400);
}

// Mode UI Setup: Flashcard
function setupFlashcardMode(wordItem, direction) {
  const container = document.getElementById("flashcard-mode-section");
  container.style.display = "block";
  
  const fcardContainer = document.getElementById("fcard-container");
  // Reset the flip instantly (no transition) when a new question loads.
  // Without this, the CSS flip transition animates from the previous
  // card's flipped state, briefly exposing the new word's translation
  // on the back face before it rotates into the front-facing position.
  const fcardInner = fcardContainer.querySelector(".flashcard-3d");
  if (fcardInner) {
    fcardInner.style.transition = "none";
    fcardContainer.classList.remove("flipped");
    void fcardInner.offsetHeight; // force reflow to apply the instant reset
    fcardInner.style.transition = "";
  } else {
    fcardContainer.classList.remove("flipped");
  }

  const wordFront = document.getElementById("fcard-front-word");
  const transFront = document.getElementById("fcard-front-trans");
  const posFront = document.getElementById("fcard-front-pos");
  
  const wordBackTitle = document.getElementById("fcard-back-translation");
  const transBack = document.getElementById("fcard-back-trans");
  const posBack = document.getElementById("fcard-back-pos");
  const wordBackDef = document.getElementById("fcard-back-def");
  const wordBackExample = document.getElementById("fcard-back-example");
  
  // Reset card elements
  transFront.innerText = "";
  posFront.style.display = "none";
  transBack.innerText = "";
  posBack.style.display = "none";
  wordBackDef.style.display = "none";
  
  const exWrapper = document.getElementById("fcard-back-ex-wrapper");
  if (exWrapper) {
    exWrapper.style.display = "none";
  }
  
  if (direction === "en-uz") {
    wordFront.innerText = wordItem.en;
    if (wordItem.tr) {
      transFront.innerText = wordItem.tr;
    }
    if (wordItem.pos) {
      posFront.innerText = wordItem.pos;
      posFront.style.display = "inline-block";
    }
    
    wordBackTitle.innerText = wordItem.uz;
    if (wordItem.def) {
      wordBackDef.innerText = wordItem.def;
      wordBackDef.style.display = "block";
    }
    if (wordItem.ex && exWrapper) {
      const highlightedEx = highlightExampleTarget(wordItem.ex, wordItem.en);
      wordBackExample.innerHTML = highlightedEx;
      exWrapper.style.display = "flex";
    }
    
    // Auto speak the English word on front show
    setTimeout(() => speakWord(wordItem.en), 300);
  } else {
    wordFront.innerText = wordItem.uz;
    
    wordBackTitle.innerText = wordItem.en;
    if (wordItem.tr) {
      transBack.innerText = wordItem.tr;
    }
    if (wordItem.pos) {
      posBack.innerText = wordItem.pos;
      posBack.style.display = "inline-block";
    }
    if (wordItem.def) {
      wordBackDef.innerText = wordItem.def;
      wordBackDef.style.display = "block";
    }
    if (wordItem.ex && exWrapper) {
      const highlightedEx = highlightExampleTarget(wordItem.ex, wordItem.en);
      wordBackExample.innerHTML = highlightedEx;
      exWrapper.style.display = "flex";
    }
  }
  
  // Add 3D Flip triggers
  fcardContainer.onclick = () => {
    fcardContainer.classList.toggle("flipped");
    
    // Auto speak English if it was revealed on the back
    if (fcardContainer.classList.contains("flipped") && direction === "uz-en") {
      speakWord(wordItem.en);
    }
  };
  
  // Hook TTS Button inside Flashcard Back
  const ttsBtn = document.getElementById("fcard-tts-btn");
  if (ttsBtn) {
    ttsBtn.onclick = (e) => {
      e.stopPropagation(); // Avoid flipping
      speakWord(wordItem.en);
      playSpeakEffect(ttsBtn);
    };
  }
  
  // Hook TTS Button inside Flashcard Front
  const frontTtsBtn = document.getElementById("fcard-front-tts-btn");
  if (frontTtsBtn) {
    frontTtsBtn.onclick = (e) => {
      e.stopPropagation(); // Avoid flipping
      speakWord(wordItem.en);
      playSpeakEffect(frontTtsBtn);
    };
  }

  // Hook Speech Mic Button
  const fcardSpeechBtn = document.getElementById("fcard-speech-btn");
  const fcardSpeechFeedback = document.getElementById("fcard-speech-feedback");
  if (fcardSpeechBtn && fcardSpeechFeedback) {
    fcardSpeechFeedback.innerText = "";
    fcardSpeechFeedback.classList.remove("visible", "success", "error");
    fcardSpeechBtn.classList.remove("success", "error", "listening");
    
    fcardSpeechBtn.onclick = (e) => {
      e.stopPropagation(); // Avoid card flipping
      handleSpeechRecognitionClick(fcardSpeechBtn, fcardSpeechFeedback, wordItem.en);
    };
  }
}

function submitFlashcardResponse(knewIt) {
  const cardWrapper = document.getElementById("fcard-container");
  const currentWord = state.questions[state.currentIndex];
  // If the user already flipped the card to peek at the translation,
  // clicking "Bildim" afterwards isn't a genuine recall — don't count it
  // as correct, and log it separately so it's clear in the mistakes review.
  const wasRevealed = cardWrapper.classList.contains("flipped");

  if (knewIt && !wasRevealed) {
    cardWrapper.classList.add("pop-it");
    state.correctCount++;
    state.streak++;
    state.maxStreak = Math.max(state.streak, state.maxStreak);

    setTimeout(() => {
      cardWrapper.classList.remove("pop-it");
      state.currentIndex++;
      renderQuestion();
    }, 400);
  } else {
    cardWrapper.classList.add("shake-it");
    state.incorrectCount++;
    state.streak = 0;
    state.mistakes.push({ word: currentWord, userAnswer: knewIt ? "Ochib ko'rilgan 👁" : "Bilmadim" });

    setTimeout(() => {
      cardWrapper.classList.remove("shake-it");
      state.currentIndex++;
      renderQuestion();
    }, 450);
  }
}

// Mode UI Setup: Multiple Choice
function setupMultipleChoiceMode(wordItem, direction) {
  const container = document.getElementById("multiple-mode-section");
  container.style.display = "block";
  
  const qWordText = document.getElementById("mc-question-word");
  const qTrans = document.getElementById("mc-question-trans");
  const qPos = document.getElementById("mc-question-pos");
  const ttsBtn = document.getElementById("mc-tts-btn");
  const optionsBox = document.getElementById("mc-options-box");
  optionsBox.innerHTML = "";
  
  qTrans.innerText = "";
  qPos.style.display = "none";
  
  // Show / hide speaker helper depending on question direction
  if (direction === "en-uz") {
    qWordText.innerText = wordItem.en;
    if (wordItem.tr) {
      qTrans.innerText = wordItem.tr;
    }
    if (wordItem.pos) {
      qPos.innerText = wordItem.pos;
      qPos.style.display = "inline-block";
    }
    ttsBtn.style.display = "inline-flex";
    ttsBtn.onclick = () => speakWord(wordItem.en);
    
    // Speak automatically on load
    setTimeout(() => speakWord(wordItem.en), 200);
  } else {
    qWordText.innerText = wordItem.uz;
    ttsBtn.style.display = "none";
  }
  
  // Distractor Pool Collection
  // Collect words from active units or fallback to total dictionary
  let distractorPool = [];
  state.selectedUnits.forEach(compositeKey => {
    const [book, unit] = compositeKey.split("|||");
    if (dictionaryData[book] && dictionaryData[book][unit]) {
      dictionaryData[book][unit].forEach(w => {
        distractorPool.push(w);
      });
    }
  });
  
  // Fallback to entire library if selection pool is too small (< 4 words)
  if (distractorPool.length < 4) {
    Object.keys(dictionaryData).forEach(book => {
      Object.keys(dictionaryData[book]).forEach(unit => {
        dictionaryData[book][unit].forEach(w => {
          distractorPool.push(w);
        });
      });
    });
  }
  
  const targetField = direction === "en-uz" ? "uz" : "en";
  const correctAnswer = wordItem[targetField];
  
  // Gather unique distractor strings
  let distractors = distractorPool
    .map(w => w[targetField])
    .filter(val => val !== correctAnswer);
  
  // Deduplicate
  distractors = [...new Set(distractors)];
  
  // Shuffle distractors and pick 3
  distractors = shuffleArray(distractors).slice(0, 3);
  
  // Combine choices
  let choices = [correctAnswer, ...distractors];
  choices = shuffleArray(choices);
  
  // Output Choice Buttons
  choices.forEach(optionText => {
    const btn = document.createElement("button");
    btn.className = "option-choice-btn";
    btn.innerHTML = `<span>${optionText}</span>`;
    
    btn.addEventListener("click", () => {
      handleMultipleChoiceSelection(btn, optionText, correctAnswer);
    });
    
    optionsBox.appendChild(btn);
  });
}

function handleMultipleChoiceSelection(selectedBtn, selectedVal, correctVal) {
  // Disable all options
  document.querySelectorAll("#mc-options-box .option-choice-btn").forEach(btn => {
    btn.disabled = true;
  });
  
  const currentWord = state.questions[state.currentIndex];
  const qCard = document.getElementById("mc-word-card");
  
  const isCorrect = selectedVal === correctVal;
  
  if (isCorrect) {
    playSound("correct");
    selectedBtn.classList.add("correct");
    selectedBtn.classList.add("pop-it");
    state.correctCount++;
    state.streak++;
    state.maxStreak = Math.max(state.streak, state.maxStreak);
    
    // Read English option aloud (if UZ->EN direction)
    if (currentWord.activeDirection === "uz-en") {
      speakWord(correctVal, () => {
        state.autoAdvanceTimeout = setTimeout(() => {
          if (qCard) qCard.classList.remove("shake-it");
          nextQuestion();
        }, 800);
      });
      
      const nextBtn = document.getElementById("next-question-btn");
      if (nextBtn) {
        nextBtn.classList.add("answered");
        const btnText = document.getElementById("next-btn-text");
        if (btnText) {
          btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
        }
      }
      return;
    }
  } else {
    playSound("incorrect");
    selectedBtn.classList.add("incorrect");
    qCard.classList.add("shake-it");
    state.incorrectCount++;
    state.streak = 0;
    state.mistakes.push({ word: currentWord, userAnswer: selectedVal });
    
    // Highlight the correct option
    document.querySelectorAll("#mc-options-box .option-choice-btn").forEach(btn => {
      if (btn.innerText.trim() === correctVal) {
        btn.classList.add("correct");
      }
    });
  }
  
  // Auto-advance in 1.2 seconds, or display "Next" immediately
  const nextBtn = document.getElementById("next-question-btn");
  if (nextBtn) {
    nextBtn.classList.add("answered");
    const btnText = document.getElementById("next-btn-text");
    if (btnText) {
      btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
    }
  }
  
  state.autoAdvanceTimeout = setTimeout(() => {
    if (qCard) qCard.classList.remove("shake-it");
    nextQuestion();
  }, 1200);
}

// ============================================================
// Mode UI Setup: Word Search (Qidiruv mashqi)
// ============================================================
let wsTargetWord = "";
let wsSelectedCells = [];

function setupWordSearchMode(wordItem, direction) {
  const container = document.getElementById("wordsearch-mode-section");
  container.style.display = "block";
  
  const targetLabel = document.getElementById("ws-target-uz");
  const selectedTextEl = document.getElementById("ws-selected-text");
  const gridEl = document.getElementById("ws-grid");
  if (gridEl) gridEl.style.pointerEvents = "auto";
  
  targetLabel.innerText = wordItem.uz;
  selectedTextEl.innerText = "-";
  gridEl.innerHTML = "";
  
  wsTargetWord = wordItem.en.toUpperCase().replace(/[^A-Z]/g, ""); // Only letters
  wsSelectedCells = [];
  
  const wordLen = wsTargetWord.length;
  const rows = Math.max(8, wordLen);
  const cols = Math.max(8, wordLen);
  
  gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  
  const grid = Array.from({ length: rows }, () => Array(cols).fill(""));
  
  // Choose random orientation: 0 = horizontal, 1 = vertical
  const isHorizontal = Math.random() < 0.5;
  let startR = 0;
  let startC = 0;
  
  if (isHorizontal) {
    startR = Math.floor(Math.random() * rows);
    startC = Math.floor(Math.random() * (cols - wordLen + 1));
    for (let i = 0; i < wordLen; i++) {
      grid[startR][startC + i] = wsTargetWord[i];
    }
  } else {
    startR = Math.floor(Math.random() * (rows - wordLen + 1));
    startC = Math.floor(Math.random() * cols);
    for (let i = 0; i < wordLen; i++) {
      grid[startR + i][startC] = wsTargetWord[i];
    }
  }
  
  // Fill empty cells
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === "") {
        grid[r][c] = alphabet[Math.floor(Math.random() * alphabet.length)];
      }
    }
  }
  
  // Render grid
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement("div");
      cell.className = "ws-cell";
      cell.innerText = grid[r][c];
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.dataset.char = grid[r][c];
      
      cell.addEventListener("click", () => {
        // Toggle selection
        const index = wsSelectedCells.findIndex(item => item.el === cell);
        if (index !== -1) {
          // Deselect and remove from selection
          cell.classList.remove("ws-selected");
          wsSelectedCells.splice(index, 1);
        } else {
          // Select cell
          cell.classList.add("ws-selected");
          wsSelectedCells.push({ el: cell, char: grid[r][c], r, c });
        }
        
        // Update selection UI
        const currentSpelling = wsSelectedCells.map(item => item.char).join("");
        selectedTextEl.innerText = currentSpelling || "-";
        
        // Check if spelling matches target
        if (currentSpelling === wsTargetWord) {
          // Success!
          wsSelectedCells.forEach(item => {
            item.el.classList.remove("ws-selected");
            item.el.classList.add("ws-correct");
          });
          
          state.correctCount++;
          state.streak++;
          state.maxStreak = Math.max(state.streak, state.maxStreak);
          
          // Disable grid clicks
          gridEl.style.pointerEvents = "none";
          speakWord(wordItem.en);
          
          // Auto advance
          const nextBtn = document.getElementById("next-question-btn");
          if (nextBtn) {
            nextBtn.classList.add("answered");
            const btnText = document.getElementById("next-btn-text");
            if (btnText) {
              btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
            }
          }
          
          state.autoAdvanceTimeout = setTimeout(() => {
            gridEl.style.pointerEvents = "auto";
            nextQuestion();
          }, 1500);
        } else if (currentSpelling.length >= wsTargetWord.length) {
          // Exceeded length but incorrect: flash red / shake
          wsSelectedCells.forEach(item => item.el.classList.add("shake-it"));
          setTimeout(() => {
            clearWordSearchSelection();
          }, 600);
        }
      });
      
      gridEl.appendChild(cell);
    }
  }
}

function clearWordSearchSelection() {
  document.querySelectorAll(".ws-cell.ws-selected").forEach(el => {
    el.classList.remove("ws-selected", "shake-it");
  });
  wsSelectedCells = [];
  const selectedTextEl = document.getElementById("ws-selected-text");
  if (selectedTextEl) selectedTextEl.innerText = "-";
}

// ============================================================
// Mode UI Setup: Audio Spelling (Eshitib yig'ish mashqi)
// ============================================================
let asTargetWord = "";
let asSelectedLetters = [];
let asAttempts = 0;

function setupAudioSpellingMode(wordItem, direction) {
  const container = document.getElementById("audiospelling-mode-section");
  container.style.display = "block";
  
  const slotsContainer = document.getElementById("as-slots-container");
  const poolContainer = document.getElementById("as-pool-container");
  const playBtn = document.getElementById("as-play-btn");
  const hintBtn = document.getElementById("as-hint-btn");
  const hintText = document.getElementById("as-translation-hint");
  
  if (hintBtn) hintBtn.style.display = "inline-block";
  if (hintText) {
    hintText.style.display = "none";
    hintText.innerText = wordItem.uz;
  }
  
  slotsContainer.innerHTML = "";
  poolContainer.innerHTML = "";
  
  asTargetWord = wordItem.en.toUpperCase().replace(/[^A-Z]/g, ""); // target word letters
  asSelectedLetters = Array(asTargetWord.length).fill(null);
  asAttempts = 0;
  
  // Shuffled pool
  let letterPool = asTargetWord.split("").map((char, index) => ({ char, id: index }));
  letterPool = shuffleArray(letterPool);
  
  // Play TTS
  playBtn.onclick = () => speakWord(wordItem.en);
  speakWord(wordItem.en);
  
  // Render slots
  for (let i = 0; i < asTargetWord.length; i++) {
    const slot = document.createElement("div");
    slot.className = "as-slot";
    slot.dataset.index = i;
    
    slot.addEventListener("click", () => {
      if (asSelectedLetters[i] !== null) {
        // Return letter to pool
        const item = asSelectedLetters[i];
        const chip = document.getElementById(`as-chip-${item.id}`);
        if (chip) chip.classList.remove("hidden");
        
        slot.innerText = "";
        asSelectedLetters[i] = null;
        updateActiveSlotHighlight();
      }
    });
    
    slotsContainer.appendChild(slot);
  }
  
  // Render letter pool chips
  letterPool.forEach(item => {
    const chip = document.createElement("div");
    chip.className = "as-letter-chip";
    chip.id = `as-chip-${item.id}`;
    chip.innerText = item.char;
    
    chip.addEventListener("click", () => {
      // Find first empty slot
      const emptyIdx = asSelectedLetters.indexOf(null);
      if (emptyIdx !== -1) {
        asSelectedLetters[emptyIdx] = item;
        chip.classList.add("hidden");
        
        const slot = slotsContainer.children[emptyIdx];
        slot.innerText = item.char;
        
        updateActiveSlotHighlight();
        checkSpellingCompletion(wordItem);
      }
    });
    
    poolContainer.appendChild(chip);
  });
  
  updateActiveSlotHighlight();
}

function updateActiveSlotHighlight() {
  const slotsContainer = document.getElementById("as-slots-container");
  if (!slotsContainer) return;
  
  const emptyIdx = asSelectedLetters.indexOf(null);
  Array.from(slotsContainer.children).forEach((slot, index) => {
    slot.classList.toggle("active", index === emptyIdx);
  });
}

function checkSpellingCompletion(wordItem) {
  const emptyIdx = asSelectedLetters.indexOf(null);
  if (emptyIdx === -1) {
    // All slots filled! Let's check correctness
    const currentSpelling = asSelectedLetters.map(item => item.char).join("");
    const slots = document.querySelectorAll(".as-slot");
    
    if (currentSpelling === asTargetWord) {
      // Correct!
      slots.forEach(slot => {
        slot.style.borderBottomColor = "var(--success)";
        slot.style.color = "var(--success)";
      });
      
      state.correctCount++;
      state.streak++;
      state.maxStreak = Math.max(state.streak, state.maxStreak);
      
      speakWord(wordItem.en);
      
      const nextBtn = document.getElementById("next-question-btn");
      if (nextBtn) {
        nextBtn.classList.add("answered");
        const btnText = document.getElementById("next-btn-text");
        if (btnText) {
          btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
        }
      }
      
      state.autoAdvanceTimeout = setTimeout(() => {
        nextQuestion();
      }, 1500);
    } else {
      // Incorrect! Shake slots
      asAttempts++;
      slots.forEach(slot => {
        slot.classList.add("shake-it");
        slot.style.borderBottomColor = "var(--danger)";
        slot.style.color = "var(--danger)";
      });

      if (asAttempts >= 2) {
        // Out of attempts: reveal the correct spelling and move on
        state.incorrectCount++;
        state.streak = 0;
        state.mistakes.push({ word: wordItem, userAnswer: "Noto'g'ri yozildi" });

        setTimeout(() => {
          slots.forEach((slot, i) => {
            slot.classList.remove("shake-it");
            slot.innerText = asTargetWord[i];
          });
        }, 400);

        const nextBtn = document.getElementById("next-question-btn");
        if (nextBtn) {
          nextBtn.classList.add("answered");
          const btnText = document.getElementById("next-btn-text");
          if (btnText) {
            btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
          }
        }

        state.autoAdvanceTimeout = setTimeout(() => {
          nextQuestion();
        }, 1800);
        return;
      }

      setTimeout(() => {
        // Reset spelling slots for the next attempt
        slots.forEach(slot => {
          slot.classList.remove("shake-it");
          slot.style.borderBottomColor = "";
          slot.style.color = "";
          slot.innerText = "";
        });
        asSelectedLetters = Array(asTargetWord.length).fill(null);
        document.querySelectorAll(".as-letter-chip.hidden").forEach(chip => {
          chip.classList.remove("hidden");
        });
        updateActiveSlotHighlight();
      }, 1000);
    }
  }
}

function toggleAudioSpellingHint() {
  const hintBtn = document.getElementById("as-hint-btn");
  const hintText = document.getElementById("as-translation-hint");
  if (hintBtn) hintBtn.style.display = "none";
  if (hintText) hintText.style.display = "block";
}

// ============================================================
// Mode UI Setup: Audio Writing (Eshitib yozish mashqi)
// ============================================================
let awTargetWord = "";
let awAttempts = 0;

function setupAudioWriteMode(wordItem, direction) {
  const container = document.getElementById("audiowrite-mode-section");
  container.style.display = "block";
  
  const slotsContainer = document.getElementById("aw-slots-container");
  const playBtn = document.getElementById("aw-play-btn");
  const hintBtn = document.getElementById("aw-hint-btn");
  const hintText = document.getElementById("aw-translation-hint");
  const inputEl = document.getElementById("aw-input");
  
  if (hintBtn) hintBtn.style.display = "inline-block";
  if (hintText) {
    hintText.style.display = "none";
    hintText.innerText = wordItem.uz;
  }
  
  slotsContainer.innerHTML = "";
  
  awTargetWord = wordItem.en.toUpperCase().replace(/[^A-Z]/g, ""); // target word letters
  awAttempts = 0;

  // Reset input field
  if (inputEl) {
    inputEl.value = "";
    inputEl.classList.remove("success", "error");
    inputEl.maxLength = awTargetWord.length;
    inputEl.disabled = false;
  }
  
  // Play pronunciation
  playBtn.onclick = () => speakWord(wordItem.en);
  speakWord(wordItem.en);
  
  // Render letter slots
  for (let i = 0; i < awTargetWord.length; i++) {
    const slot = document.createElement("div");
    slot.className = "as-slot";
    slot.dataset.index = i;
    slotsContainer.appendChild(slot);
  }
  
  updateAudioWriteSlots("");
  
  // Event listeners for keyboard typing
  if (inputEl) {
    // Focus the input field on start
    setTimeout(() => {
      inputEl.focus();
    }, 150);
    
    // Clicking anywhere on slots focuses the input
    slotsContainer.onclick = () => inputEl.focus();
    
    inputEl.oninput = (e) => {
      let val = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
      e.target.value = val;
      updateAudioWriteSlots(val);
      checkAudioWriteCompletion(val, wordItem);
    };
  }
}

function updateAudioWriteSlots(val) {
  const slotsContainer = document.getElementById("aw-slots-container");
  if (!slotsContainer) return;
  
  const slots = slotsContainer.children;
  for (let i = 0; i < slots.length; i++) {
    const char = val[i] || "";
    slots[i].innerText = char;
    
    // Toggle active typing cursor highlight
    if (i === val.length) {
      slots[i].classList.add("active");
    } else {
      slots[i].classList.remove("active");
    }
  }
}

function checkAudioWriteCompletion(val, wordItem) {
  const inputEl = document.getElementById("aw-input");
  const slotsContainer = document.getElementById("aw-slots-container");
  if (!slotsContainer) return;
  const slots = slotsContainer.querySelectorAll(".as-slot");
  
  if (val.length === awTargetWord.length) {
    if (val === awTargetWord) {
      // Correct spelling!
      if (inputEl) {
        inputEl.classList.add("success");
        inputEl.disabled = true;
      }
      slots.forEach(slot => {
        slot.style.borderBottomColor = "var(--success)";
        slot.style.color = "var(--success)";
      });
      
      state.correctCount++;
      state.streak++;
      state.maxStreak = Math.max(state.streak, state.maxStreak);
      
      speakWord(wordItem.en);
      
      const nextBtn = document.getElementById("next-question-btn");
      if (nextBtn) {
        nextBtn.classList.add("answered");
        const btnText = document.getElementById("next-btn-text");
        if (btnText) {
          btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
        }
      }
      
      state.autoAdvanceTimeout = setTimeout(() => {
        nextQuestion();
      }, 1500);
    } else {
      // Incorrect spelling! Shake input and slots
      awAttempts++;
      if (inputEl) {
        inputEl.classList.add("error");
        inputEl.disabled = true;
      }
      slots.forEach(slot => {
        slot.classList.add("shake-it");
        slot.style.borderBottomColor = "var(--danger)";
        slot.style.color = "var(--danger)";
      });

      if (awAttempts >= 2) {
        // Out of attempts: reveal the correct spelling and move on
        state.incorrectCount++;
        state.streak = 0;
        state.mistakes.push({ word: wordItem, userAnswer: "Noto'g'ri yozildi" });

        setTimeout(() => {
          slots.forEach((slot, i) => {
            slot.classList.remove("shake-it");
            slot.innerText = awTargetWord[i];
          });
          if (inputEl) inputEl.value = awTargetWord;
        }, 400);

        const nextBtn = document.getElementById("next-question-btn");
        if (nextBtn) {
          nextBtn.classList.add("answered");
          const btnText = document.getElementById("next-btn-text");
          if (btnText) {
            btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
          }
        }

        state.autoAdvanceTimeout = setTimeout(() => {
          nextQuestion();
        }, 1800);
        return;
      }

      setTimeout(() => {
        if (inputEl) {
          inputEl.classList.remove("error");
          inputEl.value = "";
          inputEl.disabled = false;
          inputEl.focus();
        }
        slots.forEach(slot => {
          slot.classList.remove("shake-it");
          slot.style.borderBottomColor = "";
          slot.style.color = "";
          slot.innerText = "";
        });
        updateAudioWriteSlots("");
      }, 1200);
    }
  }
}

function toggleAudioWriteHint() {
  const hintBtn = document.getElementById("aw-hint-btn");
  const hintText = document.getElementById("aw-translation-hint");
  if (hintBtn) hintBtn.style.display = "none";
  if (hintText) hintText.style.display = "block";
}

// ============================================================
// Mode UI Setup: Balloon Pop (Pufakchalar mashqi)
// ============================================================
function setupBalloonPopMode(wordItem, direction) {
  const container = document.getElementById("balloon-mode-section");
  container.style.display = "block";
  
  const targetLabel = document.getElementById("bp-target-word");
  const driftZone = document.getElementById("bp-drift-zone");
  
  targetLabel.innerText = wordItem.uz;
  driftZone.innerHTML = "";
  
  // Clear any old loop
  if (state.balloonAnimationId) {
    cancelAnimationFrame(state.balloonAnimationId);
    state.balloonAnimationId = null;
  }
  
  // Gather distractors
  const distractors = [];
  const pool = state.questions.filter(w => w.en !== wordItem.en);
  const shuffledPool = shuffleArray(pool);
  for (let i = 0; i < Math.min(3, shuffledPool.length); i++) {
    distractors.push(shuffledPool[i]);
  }
  // If not enough distractors, fill from general dictionary data
  const fallbackList = ["agree", "angry", "afraid", "clever", "cruel", "happy", "brave", "simple"];
  let fallbackIdx = 0;
  while (distractors.length < 3) {
    const val = fallbackList[fallbackIdx % fallbackList.length];
    if (val !== wordItem.en && !distractors.some(d => d.en === val)) {
      distractors.push({ en: val, uz: "" });
    }
    fallbackIdx++;
  }
  
  const options = [
    { text: wordItem.en, isCorrect: true },
    ...distractors.map(d => ({ text: d.en, isCorrect: false }))
  ];
  const shuffledOptions = shuffleArray(options);
  
  const balloons = [];
  const colors = [
    "linear-gradient(135deg, #ec4899 0%, #be185d 100%)", // pink
    "linear-gradient(135deg, #6366f1 0%, #4338ca 100%)", // indigo
    "linear-gradient(135deg, #06b6d4 0%, #0e7490 100%)", // cyan
    "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)", // amber
    "linear-gradient(135deg, #10b981 0%, #047857 100%)", // green
    "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)"  // purple
  ];
  const shuffledColors = shuffleArray(colors);
  
  const zoneWidth = driftZone.clientWidth || 320;
  const zoneHeight = 240;
  
  // Quadrants to guarantee non-overlapping spawn positions
  const quadrants = [0, 1, 2, 3];
  const shuffledQuadrants = shuffleArray(quadrants);
  
  // Pop particle generator
  function createPopParticles(bx, by, color, parentEl) {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "bp-pop-particle";
      p.style.left = `${bx + 36}px`;
      p.style.top = `${by + 36}px`;
      p.style.background = color;
      
      const angle = Math.random() * Math.PI * 2;
      const dist = 32 + Math.random() * 48;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;
      
      p.style.setProperty("--tx", `${tx}px`);
      p.style.setProperty("--ty", `${ty}px`);
      
      parentEl.appendChild(p);
      setTimeout(() => p.remove(), 500);
    }
  }
  
  shuffledOptions.forEach((opt, idx) => {
    const bEl = document.createElement("div");
    bEl.className = "bp-balloon";
    bEl.innerText = opt.text;
    bEl.style.background = shuffledColors[idx % shuffledColors.length];
    
    // Dynamic font size adjustment based on text length to prevent overflow/ugly wrap
    let fontSize = "0.8rem";
    if (opt.text.length > 11) {
      fontSize = "0.55rem";
    } else if (opt.text.length > 8) {
      fontSize = "0.66rem";
    }
    bEl.style.fontSize = fontSize;
    
    // Spawn positions restricted to separate quadrants to prevent initial overlap
    const quad = shuffledQuadrants[idx];
    const bSize = 72;
    const padding = 10; // boundary safety margin
    
    let minX, maxX, minY, maxY;
    if (quad === 0) { // Top-Left
      minX = padding;
      maxX = zoneWidth / 2 - bSize - padding;
      minY = padding;
      maxY = zoneHeight / 2 - bSize - padding;
    } else if (quad === 1) { // Top-Right
      minX = zoneWidth / 2 + padding;
      maxX = zoneWidth - bSize - padding;
      minY = padding;
      maxY = zoneHeight / 2 - bSize - padding;
    } else if (quad === 2) { // Bottom-Left
      minX = padding;
      maxX = zoneWidth / 2 - bSize - padding;
      minY = zoneHeight / 2 + padding;
      maxY = zoneHeight - bSize - padding;
    } else { // Bottom-Right
      minX = zoneWidth / 2 + padding;
      maxX = zoneWidth - bSize - padding;
      minY = zoneHeight / 2 + padding;
      maxY = zoneHeight - bSize - padding;
    }
    
    // Safety fallback
    if (maxX < minX) maxX = minX;
    if (maxY < minY) maxY = minY;
    
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    
    // Velocities
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 0.7; // gentle drift speed
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    
    bEl.style.left = `${x}px`;
    bEl.style.top = `${y}px`;
    
    driftZone.appendChild(bEl);
    
    const balloonObj = {
      el: bEl,
      x,
      y,
      vx,
      vy,
      width: bSize,
      height: bSize,
      isCorrect: opt.isCorrect,
      isPopped: false
    };
    
    bEl.addEventListener("click", () => {
      if (balloonObj.isPopped) return;
      balloonObj.isPopped = true;
      bEl.classList.add("pop-animation");
      
      // Trigger pop burst particles
      createPopParticles(balloonObj.x, balloonObj.y, bEl.style.background || "var(--primary)", driftZone);
      
      if (opt.isCorrect) {
        state.correctCount++;
        state.streak++;
        state.maxStreak = Math.max(state.streak, state.maxStreak);
        
        speakWord(wordItem.en);
        
        // Play success on next btn
        const nextBtn = document.getElementById("next-question-btn");
        if (nextBtn) {
          nextBtn.classList.add("answered");
          const btnText = document.getElementById("next-btn-text");
          if (btnText) {
            btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
          }
        }
        
        // Stop drift of this balloon
        balloonObj.vx = 0;
        balloonObj.vy = 0;
        
        state.autoAdvanceTimeout = setTimeout(() => {
          nextQuestion();
        }, 1200);
      } else {
        // Wrong pop! Flash red, show correct one
        bEl.style.background = "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)";
        state.incorrectCount++;
        state.streak = 0;
        state.mistakes.push({ word: wordItem, userAnswer: opt.text });

        speakWord(wordItem.en);

        // Find correct balloon and highlight it: a pulsing glow + checkmark
        // badge reads much clearer at a glance than a thin static ring.
        balloons.forEach(b => {
          if (b.isCorrect) {
            b.el.classList.add("bp-correct-reveal");
            const badge = document.createElement("span");
            badge.className = "bp-correct-badge";
            badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            b.el.appendChild(badge);
          }
        });
        
        const nextBtn = document.getElementById("next-question-btn");
        if (nextBtn) {
          nextBtn.classList.add("answered");
          const btnText = document.getElementById("next-btn-text");
          if (btnText) {
            btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
          }
        }
        
        state.autoAdvanceTimeout = setTimeout(() => {
          nextQuestion();
        }, 1800);
      }
    });
    
    balloons.push(balloonObj);
  });
  
  // Drift loop animation
  function updateDrift() {
    const currentWidth = driftZone.clientWidth || 320;
    
    // 1. Move active balloons
    balloons.forEach(b => {
      if (b.isPopped) return;
      b.x += b.vx;
      b.y += b.vy;
    });
    
    // 2. Perform 2D circle elastic collision detection and resolution
    for (let i = 0; i < balloons.length; i++) {
      for (let j = i + 1; j < balloons.length; j++) {
        const b1 = balloons[i];
        const b2 = balloons[j];
        if (b1.isPopped || b2.isPopped) continue;
        
        const c1x = b1.x + b1.width / 2;
        const c1y = b1.y + b1.height / 2;
        const c2x = b2.x + b2.width / 2;
        const c2y = b2.y + b2.height / 2;
        
        const dx = c2x - c1x;
        const dy = c2y - c1y;
        const dist = Math.hypot(dx, dy);
        const minDist = (b1.width + b2.width) / 2; // 72px
        
        if (dist < minDist) {
          // Resolve overlap
          const overlap = minDist - dist;
          const nx = dx / (dist || 1);
          const ny = dy / (dist || 1);
          
          // Displace balloons by half overlap each
          b1.x -= nx * overlap * 0.5;
          b1.y -= ny * overlap * 0.5;
          b2.x += nx * overlap * 0.5;
          b2.y += ny * overlap * 0.5;
          
          // Swap normal velocities
          const rvx = b2.vx - b1.vx;
          const rvy = b2.vy - b1.vy;
          const velAlongNormal = rvx * nx + rvy * ny;
          
          if (velAlongNormal < 0) {
            const impulse = -velAlongNormal; // mass = 1
            b1.vx -= impulse * nx;
            b1.vy -= impulse * ny;
            b2.vx += impulse * nx;
            b2.vy += impulse * ny;
          }
        }
      }
    }
    
    // 3. Resolve wall boundaries and render
    balloons.forEach(b => {
      if (b.isPopped) return;
      
      // Collision with wall x
      if (b.x <= 0) {
        b.x = 0;
        b.vx = Math.abs(b.vx);
      } else if (b.x >= currentWidth - b.width) {
        b.x = currentWidth - b.width;
        b.vx = -Math.abs(b.vx);
      }
      
      // Collision with wall y
      if (b.y <= 0) {
        b.y = 0;
        b.vy = Math.abs(b.vy);
      } else if (b.y >= zoneHeight - b.height) {
        b.y = zoneHeight - b.height;
        b.vy = -Math.abs(b.vy);
      }
      
      b.el.style.left = `${b.x}px`;
      b.el.style.top = `${b.y}px`;
    });
    
    state.balloonAnimationId = requestAnimationFrame(updateDrift);
  }
  
  state.balloonAnimationId = requestAnimationFrame(updateDrift);
}

// ============================================================
// Mode UI Setup: Neon Tank (Tank shooter o'yini)
// ============================================================
function setupTankMode(wordItem, direction) {
  const container = document.getElementById("tank-mode-section");
  if (!container) return;
  container.style.display = "block";
  
  const targetLabel = document.getElementById("tank-target-word");
  const clueLabel = document.getElementById("tank-clue-label");
  const battlefield = document.getElementById("tank-battlefield");
  const tankWrapper = document.getElementById("tank-wrapper-el");
  const barrel = document.getElementById("tank-barrel-assembly-el");
  const laser = document.getElementById("tank-laser-el");
  const feedbackBanner = document.getElementById("tank-feedback-banner");

  if (!battlefield) return;
  battlefield.style.pointerEvents = "auto";

  // 1. Determine direction (Uzbek clue -> English targets, or vice versa)
  const isUzClue = (direction === "uz-en");

  if (targetLabel) {
    targetLabel.innerText = isUzClue ? wordItem.uz : wordItem.en;
  }
  if (clueLabel) {
    clueLabel.innerText = isUzClue
      ? "Mos inglizcha so'z yozilgan nishonni oting:"
      : "Mos o'zbekcha tarjimasi yozilgan nishonni oting:";
  }

  // Clean previous battlefield elements (excluding tank-base)
  battlefield.querySelectorAll(".tank-target, .tank-bullet, .bullet-particle, .tank-hit-ring").forEach(el => el.remove());
  battlefield.classList.remove("shake-active");
  if (feedbackBanner) {
    feedbackBanner.className = "tank-feedback-banner";
    feedbackBanner.innerText = "";
  }

  // Reset barrel and laser rotation
  if (barrel) barrel.style.transform = "rotate(0deg)";
  if (laser) laser.style.transform = "rotate(0deg)";

  // Punchy impact feedback: brief camera shake + expanding ring, plus a
  // banner on correct hits only — a wrong hit already gets a red border/glow
  // on the target itself (hit-incorrect class), so a redundant "Xato" banner
  // is skipped.
  function triggerImpactFeedback(isCorrect, tX, tY) {
    if (feedbackBanner && isCorrect) {
      feedbackBanner.classList.remove("show-correct", "show-incorrect");
      void feedbackBanner.offsetWidth; // restart animation
      feedbackBanner.innerText = "✓ To'g'ri!";
      feedbackBanner.classList.add("show-correct");
    }
    battlefield.classList.remove("shake-active");
    void battlefield.offsetWidth; // restart animation
    battlefield.classList.add("shake-active");

    const ring = document.createElement("div");
    ring.className = "tank-hit-ring";
    ring.style.left = `${tX}px`;
    ring.style.top = `${tY}px`;
    ring.style.color = isCorrect ? "#10b981" : "#f43f5e";
    battlefield.appendChild(ring);
    setTimeout(() => ring.remove(), 520);
  }
  
  if (state.balloonAnimationId) {
    cancelAnimationFrame(state.balloonAnimationId);
    state.balloonAnimationId = null;
  }
  
  // 2. Gather distractors
  const distractors = [];
  const pool = state.questions.filter(w => w.en !== wordItem.en);
  const shuffledPool = shuffleArray(pool);
  for (let i = 0; i < Math.min(3, shuffledPool.length); i++) {
    distractors.push(shuffledPool[i]);
  }
  
  const fallbackList = ["agree", "angry", "afraid", "clever", "cruel", "happy", "brave", "simple"];
  let fallbackIdx = 0;
  while (distractors.length < 3) {
    const val = fallbackList[fallbackIdx % fallbackList.length];
    if (val !== wordItem.en && !distractors.some(d => d.en === val)) {
      distractors.push({ en: val, uz: "" });
    }
    fallbackIdx++;
  }
  
  // Populate options based on direction
  const options = [
    { 
      text: isUzClue ? wordItem.en : wordItem.uz, 
      isCorrect: true 
    },
    ...distractors.map(d => ({ 
      text: isUzClue ? d.en : (d.uz || d.en), 
      isCorrect: false 
    }))
  ];
  const shuffledOptions = shuffleArray(options);
  
  const battlefieldWidth = battlefield.clientWidth || 320;
  const battlefieldHeight = 250;

  const targets = [];

  // Fixed row Y-bands (with a comfortable gap between them) so targets from
  // different rows can never touch vertically, no matter how they drift.
  const rowYBands = [
    { min: 22, max: 40 },
    { min: 100, max: 118 }
  ];

  // 3. Spawn target saucers in a 2-column x 2-row grid (jittered) so no two
  // targets ever start on top of each other; horizontal collisions between
  // same-row targets are also resolved continuously during drift (see
  // resolveRowCollisions below).
  shuffledOptions.forEach((opt, idx) => {
    const tEl = document.createElement("div");
    tEl.className = "tank-target";
    tEl.innerText = opt.text;

    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const band = rowYBands[row] || rowYBands[rowYBands.length - 1];

    const colWidth = (battlefieldWidth - 20) / 2;
    const x = 10 + (col * colWidth) + Math.random() * Math.max(10, colWidth - 100);
    const y = band.min + Math.random() * (band.max - band.min);

    // Horizontal drift speed
    const vx = (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.3);

    // Position via transform (GPU-composited) instead of left/top so the
    // per-frame drift/bob updates never trigger layout reflow.
    tEl.style.left = "0px";
    tEl.style.top = `${y}px`;
    tEl.style.transform = `translate3d(${x}px, 0, 0)`;
    battlefield.appendChild(tEl);

    const targetObj = {
      el: tEl,
      x,
      y,
      vx,
      row,
      bobSeed: Math.random() * Math.PI * 2,
      hovered: false,
      width: tEl.offsetWidth || 80,
      height: tEl.offsetHeight || 34,
      isCorrect: opt.isCorrect,
      isHit: false
    };

    tEl.addEventListener("mouseenter", () => { targetObj.hovered = true; });
    tEl.addEventListener("mouseleave", () => { targetObj.hovered = false; });

    tEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (targetObj.isHit) return;
      
      // Prevent rapid fire
      battlefield.style.pointerEvents = "none";
      
      // Center of this target relative to battlefield
      const tX = targetObj.x + (tEl.offsetWidth || 80) / 2;
      const tY = targetObj.y + (tEl.offsetHeight || 34) / 2;
      
      // Center of the tank
      const tankX = battlefieldWidth / 2;
      const tankY = battlefieldHeight - 15;
      
      // Calculate rotation angle
      const dx = tX - tankX;
      const dy = tY - tankY;
      const angleRad = Math.atan2(dy, dx);
      const angleDeg = angleRad * (180 / Math.PI) + 90;
      
      // Snap barrel and laser instantly to target
      if (barrel) barrel.style.transform = `rotate(${angleDeg}deg)`;
      if (laser) laser.style.transform = `rotate(${angleDeg}deg)`;
      
      // Trigger muzzle flash and recoil styling animations
      if (tankWrapper) {
        tankWrapper.classList.remove("tank-recoil-active", "muzzle-flash-active");
        void tankWrapper.offsetWidth; // Force reflow
        tankWrapper.classList.add("tank-recoil-active", "muzzle-flash-active");
        setTimeout(() => {
          tankWrapper.classList.remove("muzzle-flash-active");
        }, 150);
      }
      
      // Create Bullet
      const bullet = document.createElement("div");
      bullet.className = "tank-bullet";
      bullet.style.left = `${tankX - 4}px`;
      bullet.style.top = `${tankY - 14}px`;
      battlefield.appendChild(bullet);
      
      // Shoot animation via CSS transition
      setTimeout(() => {
        bullet.style.transition = "all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        bullet.style.left = `${tX - 4}px`;
        bullet.style.top = `${tY - 4}px`;
      }, 20);
      
      // Bullet Impact
      // `left` and `top` both animate here, so a plain listener would fire
      // twice per shot (once per CSS property) and double-count the score.
      bullet.addEventListener("transitionend", () => {
        bullet.remove();
        targetObj.isHit = true;
        triggerImpactFeedback(opt.isCorrect, tX, tY);

        // Spawn sparks explosion
        const colors = opt.isCorrect ? ["#10b981", "#34d399", "#ffffff"] : ["#f43f5e", "#fda4af", "#ffffff"];
        for (let i = 0; i < 15; i++) {
          const spark = document.createElement("div");
          spark.className = "bullet-particle";
          spark.style.background = colors[Math.floor(Math.random() * colors.length)];
          spark.style.left = `${tX}px`;
          spark.style.top = `${tY}px`;
          battlefield.appendChild(spark);
          
          const angle = Math.random() * Math.PI * 2;
          const dist = 25 + Math.random() * 35;
          const px = Math.cos(angle) * dist;
          const py = Math.sin(angle) * dist;
          
          setTimeout(() => {
            spark.style.transition = "all 0.45s ease-out";
            spark.style.transform = `translate(${px}px, ${py}px) scale(0)`;
            spark.style.opacity = "0";
          }, 10);
          
          setTimeout(() => spark.remove(), 480);
        }
        
        if (opt.isCorrect) {
          tEl.classList.add("hit-correct");
          state.correctCount++;
          state.streak++;
          state.maxStreak = Math.max(state.streak, state.maxStreak);
          
          speakWord(wordItem.en);
          
          const nextBtn = document.getElementById("next-question-btn");
          if (nextBtn) {
            nextBtn.classList.add("answered");
            const btnText = document.getElementById("next-btn-text");
            if (btnText) {
              btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
            }
          }
          
          state.autoAdvanceTimeout = setTimeout(() => {
            battlefield.style.pointerEvents = "auto";
            nextQuestion();
          }, 550);
        } else {
          tEl.classList.add("hit-incorrect");
          state.incorrectCount++;
          state.streak = 0;
          state.mistakes.push({ word: wordItem, userAnswer: opt.text });

          speakWord(wordItem.en);

          // Show correct target (freeze it in place so the reveal styling sticks)
          targets.forEach(t => {
            if (t.isCorrect) {
              t.isHit = true;
              t.el.style.boxShadow = "0 0 20px #10b981, 0 0 10px rgba(16, 185, 129, 0.4)";
              t.el.style.borderColor = "#10b981";
              t.el.style.zIndex = "11";
              t.el.style.transform = `translate3d(${t.x}px, 0px, 0) scale(1.06)`;
            }
          });

          const nextBtn = document.getElementById("next-question-btn");
          if (nextBtn) {
            nextBtn.classList.add("answered");
            const btnText = document.getElementById("next-btn-text");
            if (btnText) {
              btnText.innerText = (state.currentIndex === state.questions.length - 1) ? "Yakunlash" : "Keyingisi";
            }
          }
          
          state.autoAdvanceTimeout = setTimeout(() => {
            battlefield.style.pointerEvents = "auto";
            nextQuestion();
          }, 850);
        }
      }, { once: true });
    });

    targets.push(targetObj);
  });

  // Resolve any accidental overlap from the initial jittered placement
  // before the first frame paints (resolveRowCollisions is hoisted below).
  resolveRowCollisions();
  targets.forEach(t => {
    t.el.style.transform = `translate3d(${t.x}px, 0, 0)`;
  });

  // 4. Real-time Aiming tracking (re-aim cannon dynamically towards mouse pointer)
  function handleAimTracking(clientX, clientY) {
    const rect = battlefield.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    const tankX = rect.width / 2;
    const tankY = battlefieldHeight - 15;
    
    const dx = x - tankX;
    const dy = y - tankY;
    const angleRad = Math.atan2(dy, dx);
    const angleDeg = angleRad * (180 / Math.PI) + 90;
    
    // Constrain aiming limits so tank doesn't shoot backwards
    if (angleDeg >= -85 && angleDeg <= 85) {
      if (barrel) barrel.style.transform = `rotate(${angleDeg}deg)`;
      if (laser) laser.style.transform = `rotate(${angleDeg}deg)`;
    }
  }
  
  battlefield.addEventListener("mousemove", (e) => {
    handleAimTracking(e.clientX, e.clientY);
  });
  
  battlefield.addEventListener("touchmove", (e) => {
    if (e.touches.length > 0) {
      handleAimTracking(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });
  
  // Push apart any same-row targets that have drifted into each other,
  // and bounce their velocities so they visually deflect instead of
  // overlapping (targets in different rows are already far enough apart
  // vertically to never collide).
  function resolveRowCollisions() {
    // Extra margin (beyond visual touching) so the correct-answer "reveal"
    // scale-up after a wrong guess never visually crowds its row neighbor.
    const gap = 24;
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i];
      if (a.isHit) continue;
      for (let j = i + 1; j < targets.length; j++) {
        const b = targets[j];
        if (b.isHit || a.row !== b.row) continue;

        const overlap = gap + Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        if (overlap > 0) {
          const shift = overlap / 2;
          if (a.x < b.x) {
            a.x -= shift;
            b.x += shift;
          } else {
            a.x += shift;
            b.x -= shift;
          }
          const tempVx = a.vx;
          a.vx = b.vx;
          b.vx = tempVx;
        }
      }
    }
  }

  // 5. Drift loop animation (positions/bob applied via transform only —
  // GPU-composited, no layout reflow — so movement stays smooth).
  function updateDrift() {
    const currentWidth = battlefield.clientWidth || 320;
    const now = performance.now() / 1000;

    targets.forEach(t => {
      if (t.isHit) return;

      // Update actual rendered width dynamically
      t.width = t.el.offsetWidth || 80;
      t.height = t.el.offsetHeight || 34;

      t.x += t.vx;

      // Collision with wall
      if (t.x <= 5) {
        t.x = 5;
        t.vx *= -1;
      } else if (t.x >= currentWidth - t.width - 5) {
        t.x = currentWidth - t.width - 5;
        t.vx *= -1;
      }
    });

    resolveRowCollisions();

    targets.forEach(t => {
      if (t.isHit) return;
      // Re-clamp in case collision resolution pushed a target past a wall
      if (t.x < 5) t.x = 5;
      if (t.x > currentWidth - t.width - 5) t.x = currentWidth - t.width - 5;

      const bobY = Math.sin(now * (Math.PI * 2 / 3) + t.bobSeed) * 6;
      const scale = t.hovered ? 1.08 : 1;
      t.el.style.transform = `translate3d(${t.x}px, ${bobY}px, 0) scale(${scale})`;
    });

    state.balloonAnimationId = requestAnimationFrame(updateDrift);
  }

  state.balloonAnimationId = requestAnimationFrame(updateDrift);
}







// Mode UI Setup: Matching (Juftlashtirish)
function setupMatchMode() {
  const container = document.getElementById("match-mode-section");
  container.style.display = "block";
  
  const nextBtn = document.getElementById("next-question-btn");
  nextBtn.classList.remove("visible");
  
  const startIdx = state.currentIndex;
  const endIdx = Math.min(startIdx + 4, state.questions.length);
  state.matchRoundWords = state.questions.slice(startIdx, endIdx);
  state.matchedPairsCount = 0;
  state.selectedMatchCard = null;
  
  // Update header tracker specifically for matching rounds
  document.getElementById("q-count").innerText = `Juftlash: ${startIdx + 1}-${endIdx}/${state.questions.length}`;
  
  const gridContainer = document.getElementById("match-grid-container");
  gridContainer.innerHTML = "";
  
  // Separate and shuffle left/right indices
  const count = state.matchRoundWords.length;
  let leftIndices = Array.from({ length: count }, (_, i) => i);
  let rightIndices = Array.from({ length: count }, (_, i) => i);
  
  leftIndices = shuffleArray(leftIndices);
  
  // Reshuffle right indices until no matching pairs reside on the same row index
  let attempts = 0;
  while (attempts < 100) {
    rightIndices = shuffleArray(rightIndices);
    let overlap = false;
    for (let i = 0; i < count; i++) {
      if (leftIndices[i] === rightIndices[i]) {
        overlap = true;
        break;
      }
    }
    if (!overlap) {
      break;
    }
    attempts++;
  }
  
  // Interleave left and right cards for 2-column rendering
  const isEnLeft = (state.direction === "en-uz");
  const cards = [];
  
  for (let i = 0; i < count; i++) {
    const leftIdx = leftIndices[i];
    const rightIdx = rightIndices[i];
    
    const leftWord = state.matchRoundWords[leftIdx];
    const rightWord = state.matchRoundWords[rightIdx];
    
    if (isEnLeft) {
      // Left: English, Right: Uzbek
      cards.push({
        id: `en-${leftIdx}`,
        type: "en",
        text: leftWord.en,
        wordObj: leftWord
      });
      cards.push({
        id: `uz-${rightIdx}`,
        type: "uz",
        text: rightWord.uz,
        wordObj: rightWord
      });
    } else {
      // Left: Uzbek, Right: English
      cards.push({
        id: `uz-${leftIdx}`,
        type: "uz",
        text: leftWord.uz,
        wordObj: leftWord
      });
      cards.push({
        id: `en-${rightIdx}`,
        type: "en",
        text: rightWord.en,
        wordObj: rightWord
      });
    }
  }
  
  cards.forEach(card => {
    const cardEl = document.createElement("div");
    cardEl.className = "match-card";
    cardEl.innerText = card.text;
    
    cardEl.addEventListener("click", () => {
      handleMatchCardClick(cardEl, card);
    });
    
    gridContainer.appendChild(cardEl);
  });
}

function handleMatchCardClick(cardEl, card) {
  if (cardEl.classList.contains("correct") || cardEl.classList.contains("disabled") || cardEl.classList.contains("incorrect")) return;
  
  if (card.type === "en") {
    speakWord(card.text);
  }
  
  const activeSelection = state.selectedMatchCard;
  
  if (!activeSelection) {
    state.selectedMatchCard = { el: cardEl, data: card };
    cardEl.classList.add("selected");
  } else {
    if (activeSelection.el === cardEl) {
      cardEl.classList.remove("selected");
      state.selectedMatchCard = null;
      return;
    }
    
    if (activeSelection.data.type === card.type) {
      activeSelection.el.classList.remove("selected");
      cardEl.classList.add("selected");
      state.selectedMatchCard = { el: cardEl, data: card };
      return;
    }
    
    const isMatch = activeSelection.data.wordObj.en === card.wordObj.en;
    
    if (isMatch) {
      activeSelection.el.classList.remove("selected");
      activeSelection.el.classList.add("correct");
      cardEl.classList.add("correct");
      
      state.correctCount++;
      state.streak++;
      state.maxStreak = Math.max(state.streak, state.maxStreak);
      document.getElementById("streak-val").innerText = state.streak;
      document.getElementById("streak-block").style.display = "flex";
      
      state.matchedPairsCount++;
      state.selectedMatchCard = null;
      
      if (state.matchedPairsCount === state.matchRoundWords.length) {
        state.modeTimeout = setTimeout(() => {
          state.modeTimeout = null;
          state.currentIndex += state.matchRoundWords.length;
          if (state.questions.length === 0) return;
          if (state.currentIndex >= state.questions.length) {
            finishQuiz();
          } else {
            setupMatchMode();
          }
        }, 1000);
      }
    } else {
      cardEl.classList.add("incorrect", "shake-it");
      activeSelection.el.classList.add("incorrect", "shake-it");
      
      state.incorrectCount++;
      state.streak = 0;
      document.getElementById("streak-val").innerText = 0;
      document.getElementById("streak-block").style.display = "none";
      
      state.mistakes.push({ word: card.wordObj, userAnswer: "Moslashtirishda xato" });
      
      setTimeout(() => {
        cardEl.classList.remove("incorrect", "shake-it");
        activeSelection.el.classList.remove("incorrect", "selected", "shake-it");
        state.selectedMatchCard = null;
      }, 800);
    }
  }
}

function nextQuestion() {
  if (state.autoAdvanceTimeout) {
    clearTimeout(state.autoAdvanceTimeout);
    state.autoAdvanceTimeout = null;
  }
  if (state.questionTimer) {
    clearInterval(state.questionTimer);
    state.questionTimer = null;
  }
  if (state.balloonAnimationId) {
    cancelAnimationFrame(state.balloonAnimationId);
    state.balloonAnimationId = null;
  }
  
  // Cancel active speech when manually moving to the next question
  if (state.speechSynth) {
    state.speechSynth.cancel();
  }
  
  if (state.mode === "cover") {
    // Finish these modes immediately since all items are shown on scroll
    state.correctCount = state.questions.length;
    finishQuiz();
    return;
  }
  
  // Check if they are skipping
  const nextBtn = document.getElementById("next-question-btn");
  const isAnswered = nextBtn && nextBtn.classList.contains("answered");
  
  if (!isAnswered && state.currentIndex < state.questions.length) {
    const currentWord = state.questions[state.currentIndex];
    
    // For match and linematch, we skip the round size
    if (state.mode === "match" && state.matchRoundWords) {
      state.matchRoundWords.forEach(w => {
        state.incorrectCount++;
        state.mistakes.push({ word: w, userAnswer: "O'tkazib yuborildi ⏭" });
      });
      state.currentIndex += state.matchRoundWords.length;
      state.streak = 0;
    } else if (state.mode === "linematch" && state.lineMatchRoundWords) {
      state.lineMatchRoundWords.forEach(w => {
        state.incorrectCount++;
        state.mistakes.push({ word: w, userAnswer: "O'tkazib yuborildi ⏭" });
      });
      state.currentIndex += state.lineMatchRoundWords.length;
      state.streak = 0;
    } else {
      state.incorrectCount++;
      state.streak = 0;
      state.mistakes.push({ word: currentWord, userAnswer: "O'tkazib yuborildi ⏭" });
      state.currentIndex++;
    }
  } else {
    state.currentIndex++;
  }
  
  renderQuestion();
}

function quitQuiz() {
  showAppConfirm(
    "Testdan chiqasizmi?",
    "Haqiqatan ham testdan chiqmoqchimisiz? Hozirgi natijalar saqlanmaydi.",
    () => {
      cleanupQuiz();
      showScreen("setup-screen");
      // Land back on the exercise-type step, not the book/unit step —
      // that's what someone exiting a quiz usually wants to change next.
      showWizardStep(2);
    }
  );
}

// 9. Result & Review dashboard

// Map accuracy -> letter grade, colour theme class and motivational message
function getResultGrade(accuracy) {
  if (accuracy >= 100) return { letter: "S", cls: "grade-s", msg: "Mukammal! 🏆" };
  if (accuracy >= 90)  return { letter: "A", cls: "grade-a", msg: "Ajoyib natija!" };
  if (accuracy >= 75)  return { letter: "B", cls: "grade-b", msg: "Yaxshi natija" };
  if (accuracy >= 60)  return { letter: "C", cls: "grade-c", msg: "Yomon emas, davom eting" };
  if (accuracy >= 40)  return { letter: "D", cls: "grade-d", msg: "Mashq qilish kerak" };
  return { letter: "F", cls: "grade-f", msg: "Qayta urinib ko'ring" };
}

// Theme the hero card by grade and replay the stamp reveal animation
function applyResultGrade(accuracy) {
  const hero = document.getElementById("res-hero");
  const badge = document.getElementById("res-grade-badge");
  const g = getResultGrade(accuracy);
  hero.classList.remove("grade-s", "grade-a", "grade-b", "grade-c", "grade-d", "grade-f");
  hero.classList.add(g.cls);
  document.getElementById("res-grade").innerText = g.letter;
  document.getElementById("res-grade-msg").innerText = g.msg;
  badge.classList.remove("reveal");
  void badge.offsetWidth; // force reflow so the animation restarts
  badge.classList.add("reveal");
}

// Fill the XP-style bar to `accuracy`% while counting the percentage up
function animateScoreBar(accuracy) {
  const bar = document.getElementById("res-bar-fill");
  const pct = document.getElementById("res-accuracy");
  bar.style.width = "0%";
  pct.innerText = "0%";
  const dur = 1100;
  let start = null;
  function step(now) {
    if (start === null) start = now;
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    pct.innerText = Math.round(eased * accuracy) + "%";
    if (t < 1) requestAnimationFrame(step);
    else pct.innerText = accuracy + "%";
  }
  requestAnimationFrame(() => {
    bar.style.width = accuracy + "%";
    requestAnimationFrame(step);
  });
}

function finishQuiz() {
  // Reset CTA button text in next button
  const nextBtn = document.getElementById("next-question-btn");
  nextBtn.querySelector("span") ? (nextBtn.querySelector("span").innerText = "Keyingisi") : null;

  // Calculate accuracy
  const total = state.questions.length;
  const accuracy = total > 0 ? Math.round((state.correctCount / total) * 100) : 0;

  if (accuracy >= 80) {
    triggerConfetti();
  }
  
  // Set Text Metrics
  document.getElementById("res-fraction").innerText = `${state.correctCount} / ${total}`;
  document.getElementById("metric-total").innerText = total;
  document.getElementById("metric-correct").innerText = state.correctCount;
  document.getElementById("metric-incorrect").innerText = state.incorrectCount;
  document.getElementById("metric-streak").innerText = state.maxStreak;

  // Grade badge + animated XP score bar
  applyResultGrade(accuracy);
  animateScoreBar(accuracy);

  // Reset the status slot on every render (prevents duplicate congrats cards)
  const statusSlot = document.getElementById("res-status-slot");
  statusSlot.innerHTML = "";

  // Render Mistakes Report
  const mistakesBlock = document.getElementById("res-mistakes-block");
  const mistakesList = document.getElementById("res-mistakes-list");
  const retryMistakesBtn = document.getElementById("res-retry-mistakes-btn");
  mistakesList.innerHTML = "";
  
  if (state.mistakes.length === 0) {
    mistakesBlock.style.display = "none";
    retryMistakesBtn.style.display = "none";

    // Celebratory status card (rendered into the cleared status slot)
    statusSlot.innerHTML = `
      <div class="res-status-card success">
        <div class="rs-title">Ajoyib natija! 🎉</div>
        <div class="rs-sub">Barcha savollarga to'g'ri javob berdingiz.</div>
      </div>`;
  } else {
    mistakesBlock.style.display = "block";
    retryMistakesBtn.style.display = "flex";
    document.getElementById("res-mistakes-count").innerText = state.mistakes.length;

    state.mistakes.forEach(mistake => {
      const w = mistake.word;
      const mItem = document.createElement("div");
      mItem.className = "mistake-card-item";
      
      const trHtml = w.tr ? `<span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500; margin-left: 6px;">${w.tr}</span>` : '';
      const posHtml = w.pos ? `<span style="font-size: 0.62rem; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; background: var(--primary-glow); padding: 1px 4px; border-radius: 3px; margin-left: 6px;">${w.pos}</span>` : '';
      const defHtml = w.def ? `<div style="font-size: 0.68rem; color: var(--text-muted); font-style: italic; margin-top: 1px; line-height: 1.25;">Izoh: ${w.def}</div>` : '';
      const exHtml = w.ex ? `<div class="mistake-card-ex">Misol: ${w.ex}</div>` : '';

      mItem.innerHTML = `
        <div class="mistake-card-header">
          <span class="mistake-card-en">
            ${w.en}
            ${trHtml}
            ${posHtml}
            <button class="tts-inline-btn" title="Eshitish">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            </button>
          </span>
          <span class="mistake-card-uz">${w.uz}</span>
        </div>
        <div class="mistake-comparison">
          <span class="label">Sizning javobingiz:</span>
          <span class="mistake-answer-user">${mistake.userAnswer}</span>
        </div>
        ${defHtml}
        ${exHtml}
      `;
      
      // Bind inline TTS button click
      mItem.querySelector(".tts-inline-btn").onclick = (e) => {
        e.stopPropagation();
        speakWord(w.en);
      };
      
      mistakesList.appendChild(mItem);
    });
  }
  
  // Clear active questions pool since it is completed
  state.questions = [];

  if (window.trackEvent) {
    window.trackEvent("quiz_result", {
      book: state.selectedBooks && state.selectedBooks.length ? state.selectedBooks.join(", ") : null,
      units: state.selectedUnits,
      mode: state.mode,
      correct_count: state.correctCount,
      total_questions: state.correctCount + state.incorrectCount,
    });
  }

  showScreen("result-screen");
}

function initResultEmptyState() {
  const isNoData = state.correctCount === 0 && state.incorrectCount === 0;
  if (!isNoData) return;

  document.getElementById("res-fraction").innerText = "0 / 0";
  document.getElementById("metric-total").innerText = 0;
  document.getElementById("metric-correct").innerText = 0;
  document.getElementById("metric-incorrect").innerText = 0;
  document.getElementById("metric-streak").innerText = 0;

  // Neutral hero with an empty score bar
  applyResultGrade(0);
  document.getElementById("res-bar-fill").style.width = "0%";
  document.getElementById("res-accuracy").innerText = "0%";
  document.getElementById("res-grade-msg").innerText = "Hali test topshirilmadi";

  document.getElementById("res-mistakes-block").style.display = "none";
  document.getElementById("res-retry-mistakes-btn").style.display = "none";

  // Render empty state into the status slot (fully replaced each time)
  document.getElementById("res-status-slot").innerHTML = `
    <div class="res-status-card">
      <div class="rs-title">Test topshirilmadi</div>
      <div class="rs-sub">Testni boshlash uchun Sozlash bo'limiga o'ting.</div>
    </div>`;
}

// ============================================================
// Mode UI Setup: Cover (Bir tarafni yopish mashqi)
// ============================================================
function setupCoverMode() {
  const container = document.getElementById("cover-mode-section");
  container.style.display = "block";

  // Sync toggle buttons
  document.getElementById("cover-hide-uz").classList.toggle("active", state.coverTarget === "uz");
  document.getElementById("cover-hide-en").classList.toggle("active", state.coverTarget === "en");

  const tableEl = document.getElementById("cover-table-container");
  tableEl.innerHTML = "";

  state.questions.forEach((wordItem, idx) => {
    const row = document.createElement("div");
    row.className = "cover-row";
    row.dataset.idx = idx;

    const enHidden = state.coverTarget === "en";
    const uzHidden = state.coverTarget === "uz";

    const safeEn = wordItem.en.replace(/'/g, "\\'");
    const trSpan = wordItem.tr
      ? `<span class="cover-tr">${wordItem.tr}</span>`
      : "";
    const posSpan = wordItem.pos
      ? `<span class="cover-pos">${wordItem.pos}</span>`
      : "";

    const defContent = wordItem.def ? `<div><strong>Izoh:</strong> ${wordItem.def}</div>` : "";
    const exContent = wordItem.ex ? `<div style="margin-top: 4px; color: var(--primary);"><strong>Gap:</strong> ${wordItem.ex}</div>` : "";

    row.innerHTML = `
      <div class="cover-cells-wrapper">
      <div class="cover-cell cover-cell-en ${enHidden ? "cover-hidden" : ""}" id="cover-en-${idx}">
        <div class="cover-cell-content">
          <div class="cover-word" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
            <strong style="font-size: 0.8rem; color: var(--text-main); font-weight: 700;">${wordItem.en}</strong>
            <button class="tts-inline-btn cover-tts" title="Talaffuz" onclick="event.stopPropagation(); speakWord('${safeEn}')" style="margin-left: 2px;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            </button>
            ${trSpan}
            ${posSpan}
          </div>
        </div>
        <div class="cover-reveal-btn">Ko'rsat 👁</div>
      </div>
      <div class="cover-cell cover-cell-uz ${uzHidden ? "cover-hidden" : ""}" id="cover-uz-${idx}">
        <div class="cover-cell-content">
          <div class="cover-uz-word" style="font-size: 0.78rem; font-weight: 600; color: var(--success);">${wordItem.uz}</div>
        </div>
        <div class="cover-reveal-btn">Ko'rsat 👁</div>
      </div>
      </div>
      <div class="cover-details" id="cover-details-${idx}" style="display:none;">
        ${defContent}
        ${exContent}
      </div>
    `;

    // Reveal button logic
    const enCell = row.querySelector(".cover-cell-en");
    const uzCell = row.querySelector(".cover-cell-uz");
    const detailsBar = row.querySelector(`#cover-details-${idx}`);

    enCell.querySelector(".cover-reveal-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      enCell.classList.remove("cover-hidden");
      checkCoverReveal(enCell, uzCell, detailsBar);
    });
    uzCell.querySelector(".cover-reveal-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      uzCell.classList.remove("cover-hidden");
      checkCoverReveal(enCell, uzCell, detailsBar);
    });
    enCell.querySelector(".cover-cell-content").addEventListener("click", () => {
      if (enCell.classList.contains("cover-hidden")) {
        enCell.classList.remove("cover-hidden");
        checkCoverReveal(enCell, uzCell, detailsBar);
      } else {
        toggleDetails(detailsBar);
      }
    });
    uzCell.querySelector(".cover-cell-content").addEventListener("click", () => {
      if (uzCell.classList.contains("cover-hidden")) {
        uzCell.classList.remove("cover-hidden");
        checkCoverReveal(enCell, uzCell, detailsBar);
      } else {
        toggleDetails(detailsBar);
      }
    });

    tableEl.appendChild(row);
  });
}

function toggleDetails(detailsBar) {
  if (detailsBar) {
    detailsBar.style.display = detailsBar.style.display === "none" ? "flex" : "none";
  }
}

function checkCoverReveal(enCell, uzCell, detailsBar) {
  const bothVisible = !enCell.classList.contains("cover-hidden") &&
                      !uzCell.classList.contains("cover-hidden");
  if (bothVisible && detailsBar) {
    detailsBar.style.display = "flex";
  }
}

function setCoverTarget(target) {
  state.coverTarget = target;
  setupCoverMode();
}

function revealAllCover() {
  document.querySelectorAll(".cover-cell.cover-hidden").forEach(el => {
    el.classList.remove("cover-hidden");
  });
  // Keep details hidden by default so that the list remains compact and more words are visible.
  // The user can still tap any row to expand its details.
  document.querySelectorAll(".cover-details").forEach(el => {
    el.style.display = "none";
  });
}

// ============================================================
// Mode UI Setup: LineMatch (Chizib ulash mashqi)
// ============================================================
function setupLineMatchMode() {
  const container = document.getElementById("linematch-mode-section");
  container.style.display = "block";

  const ROUND_SIZE = 6;
  const startIdx = state.currentIndex;
  const endIdx = Math.min(startIdx + ROUND_SIZE, state.questions.length);
  state.lineMatchRoundWords = state.questions.slice(startIdx, endIdx);
  state.lineMatchSelectedLeft = null;
  state.lineMatchConnections = [];
  state.lineMatchMatchedCount = 0;

  document.getElementById("q-count").innerText = `Ulash: ${startIdx + 1}-${endIdx}/${state.questions.length}`;

  const svg = document.getElementById("linematch-svg");
  const leftCol = document.getElementById("linematch-left-col");
  const rightCol = document.getElementById("linematch-right-col");
  svg.innerHTML = "";
  leftCol.innerHTML = "";
  rightCol.innerHTML = "";

  // Left: EN words in order
  state.lineMatchRoundWords.forEach((w, i) => {
    const item = document.createElement("div");
    item.className = "lm-item lm-item-left";
    item.dataset.idx = i;
    item.dataset.side = "left";
    item.innerHTML = `<span>${w.en}</span>`;
    item.addEventListener("click", () => handleLMLeftClick(item, i));
    leftCol.appendChild(item);
  });

  // Right: UZ words shuffled
  const shuffledRight = shuffleArray(state.lineMatchRoundWords.map((w, i) => ({ uz: w.uz, origIdx: i })));
  shuffledRight.forEach((entry, ri) => {
    const item = document.createElement("div");
    item.className = "lm-item lm-item-right";
    item.dataset.origIdx = entry.origIdx;
    item.dataset.rightIdx = ri;
    item.innerHTML = `<span>${entry.uz}</span>`;
    item.addEventListener("click", () => handleLMRightClick(item, entry.origIdx));
    rightCol.appendChild(item);
  });

  const nextBtn = document.getElementById("next-question-btn");
  nextBtn.classList.remove("visible");
}

function handleLMLeftClick(itemEl, leftIdx) {
  if (itemEl.classList.contains("lm-matched") || itemEl.classList.contains("lm-wrong")) return;

  // Deselect any previous selection
  document.querySelectorAll(".lm-item-left.lm-selected").forEach(el => el.classList.remove("lm-selected"));
  
  state.lineMatchSelectedLeft = { el: itemEl, idx: leftIdx };
  itemEl.classList.add("lm-selected");
  speakWord(state.lineMatchRoundWords[leftIdx].en);
}

function handleLMRightClick(itemEl, origIdx) {
  if (!state.lineMatchSelectedLeft) return;
  if (itemEl.classList.contains("lm-matched") || itemEl.classList.contains("lm-wrong")) return;

  const leftSel = state.lineMatchSelectedLeft;
  state.lineMatchSelectedLeft = null;
  leftSel.el.classList.remove("lm-selected");

  const isCorrect = leftSel.idx === origIdx;

  if (isCorrect) {
    leftSel.el.classList.add("lm-matched");
    itemEl.classList.add("lm-matched");
    state.correctCount++;
    state.streak++;
    state.maxStreak = Math.max(state.streak, state.maxStreak);
    document.getElementById("streak-val").innerText = state.streak;
    if (state.streak > 0) document.getElementById("streak-block").style.display = "flex";

    drawLMLine(leftSel.el, itemEl, true);

    state.lineMatchMatchedCount++;
    if (state.lineMatchMatchedCount === state.lineMatchRoundWords.length) {
      state.modeTimeout = setTimeout(() => {
        state.modeTimeout = null;
        state.currentIndex += state.lineMatchRoundWords.length;
        if (state.questions.length === 0) return;
        if (state.currentIndex >= state.questions.length) {
          finishQuiz();
        } else {
          setupLineMatchMode();
        }
      }, 900);
    }
  } else {
    leftSel.el.classList.add("lm-wrong");
    itemEl.classList.add("lm-wrong");
    state.incorrectCount++;
    state.streak = 0;
    document.getElementById("streak-val").innerText = 0;
    document.getElementById("streak-block").style.display = "none";
    state.mistakes.push({ word: state.lineMatchRoundWords[leftSel.idx], userAnswer: "Noto'g'ri ulanish" });

    drawLMLine(leftSel.el, itemEl, false);

    setTimeout(() => {
      leftSel.el.classList.remove("lm-wrong");
      itemEl.classList.remove("lm-wrong");
      // Remove the wrong line
      const wrongLines = document.querySelectorAll(".lm-line-wrong");
      wrongLines.forEach(l => l.remove());
    }, 700);
  }
}

function drawLMLine(leftEl, rightEl, isCorrect) {
  const svg = document.getElementById("linematch-svg");
  const svgRect = svg.getBoundingClientRect();
  const leftRect = leftEl.getBoundingClientRect();
  const rightRect = rightEl.getBoundingClientRect();

  const x1 = leftRect.right - svgRect.left;
  const y1 = leftRect.top + leftRect.height / 2 - svgRect.top;
  const x2 = rightRect.left - svgRect.left;
  const y2 = rightRect.top + rightRect.height / 2 - svgRect.top;

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("stroke", isCorrect ? "var(--success)" : "var(--danger)");
  line.setAttribute("stroke-width", "2.5");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("class", isCorrect ? "lm-line-correct" : "lm-line-wrong");
  svg.appendChild(line);
}

// 10. Theme Management (Light / Dark Mode)
function initTheme() {
  const themeToggle = document.getElementById("theme-toggle");
  const currentTheme = localStorage.getItem("vocab_theme") || "neon-night";
  
  applyTheme(currentTheme);
  
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const activeTheme = document.documentElement.getAttribute("data-theme");
      const newTheme = activeTheme === "vibrant-day" ? "neon-night" : "vibrant-day";
      applyTheme(newTheme);
    });
  }
}

function updateThemeIcon(theme) {
  const toggleBtn = document.getElementById("theme-toggle");
  if (!toggleBtn) return;
  if (theme === "dark") {
    // Sun icon for toggling to light mode
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
      </svg>
    `;
  } else {
    // Moon icon for toggling to dark mode
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
      </svg>
    `;
  }
}

// ============================================================
// ============================================================
// Book Viewer Logic (Essential book representation)
// ============================================================
function showLibraryPhase(phase) {
  const selectionPhase = document.getElementById("library-selection-phase");
  const readingPhase = document.getElementById("library-reading-phase");
  if (!selectionPhase || !readingPhase) return;

  selectionPhase.style.display = phase === "selection" ? "block" : "none";
  readingPhase.style.display = phase === "reading" ? "block" : "none";

  // Only the actual reading moment is worth logging — book/unit browsing
  // on the selection dashboard is noise, this is the signal (which book
  // and unit someone is actually reading).
  if (phase === "reading") {
    trackScreenView("book-screen/reading", {
      book: state.activeBookViewBook || null,
      unit: state.activeBookViewUnit || null,
    });
  }
}

function renderLibrarySelectionPhase() {
  const bookRow = document.getElementById("library-book-row");
  const unitGrid = document.getElementById("library-unit-grid");
  if (!bookRow || !unitGrid) return;

  // Books row
  bookRow.innerHTML = "";
  const books = Object.keys(dictionaryData);

  // Ensure active book exists
  if (!state.activeBookViewBook || !dictionaryData[state.activeBookViewBook]) {
    state.activeBookViewBook = books[0] || "";
  }

  books.forEach((bookName) => {
    const card = document.createElement("button");
    card.type = "button";
    const isActive = bookName === state.activeBookViewBook;
    card.className = `library-book-card ${isActive ? "active" : ""} ${bookName === CUSTOM_BOOK_NAME ? "custom-book-tab" : ""}`;
    card.innerHTML = `<span class="book-title">${bookName}</span>`;
    card.addEventListener("click", () => {
      state.activeBookViewBook = bookName;
      localStorage.setItem("vocab_active_book", bookName);
      // Reset to first unit of the selected book
      const firstUnit = Object.keys(dictionaryData[bookName] || {})[0];
      if (firstUnit) {
        state.activeBookViewUnit = firstUnit;
        localStorage.setItem("vocab_active_unit", firstUnit);
      }
      renderLibrarySelectionPhase();
    });
    bookRow.appendChild(card);
  });

  // Dynamic Unit grid
  const activeBookUnits = dictionaryData[state.activeBookViewBook] || {};
  const unitNames = Object.keys(activeBookUnits);
  unitGrid.innerHTML = "";

  if (unitNames.length === 0) {
    unitGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 24px; font-size: 0.88rem;">Ushbu bo'limda darslar mavjud emas</div>`;
    return;
  }

  // Ensure active unit exists in current book
  if (!unitNames.includes(state.activeBookViewUnit)) {
    state.activeBookViewUnit = unitNames[0];
  }

  unitNames.forEach((unitName, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const wordCount = (activeBookUnits[unitName] || []).length;
    const isActive = unitName === state.activeBookViewUnit;
    btn.className = `library-unit-btn ${isActive ? "active" : ""}`;

    // Clean display title
    let displayTitle = unitName.replace(/^📁\s*/, "");
    if (unitName.includes("→")) {
      const [src, tgt] = unitName.split("→");
      const srcMeta = LANG_META[src] || { flag: "🌐", name: src };
      const tgtMeta = LANG_META[tgt] || { flag: "🌐", name: tgt };
      displayTitle = `${srcMeta.flag} ${srcMeta.code || srcMeta.name || src} → ${tgtMeta.flag}`;
    }

    const isLong = displayTitle.length > 4;
    const fontSz = isLong ? (displayTitle.length > 7 ? "0.52rem" : "0.60rem") : "0.85rem";

    btn.innerHTML = `
      <span class="library-unit-num" style="font-size: ${fontSz}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 96%; display: block; line-height: 1.1;">${escapeHTML(displayTitle)}</span>
      <span class="library-unit-count">${wordCount} so'z</span>
    `;
    btn.addEventListener("click", () => {
      state.activeBookViewUnit = unitName;
      localStorage.setItem("vocab_active_unit", unitName);
      renderLibrarySelectionPhase();
    });
    unitGrid.appendChild(btn);
  });
}

function initBookViewer() {
  // Load memorized words, active book and active unit from localStorage
  try {
    const saved = localStorage.getItem("vocab_memorized_words");
    state.memorizedWords = saved ? JSON.parse(saved) : [];
  } catch (e) {
    state.memorizedWords = [];
  }

  const savedBook = localStorage.getItem("vocab_active_book");
  if (savedBook && dictionaryData[savedBook]) {
    state.activeBookViewBook = savedBook;
  }
  const savedUnit = localStorage.getItem("vocab_active_unit");
  if (savedUnit) {
    state.activeBookViewUnit = savedUnit;
  }

  // Set default book page
  state.activeBookViewPage = 1;

  const openBookBtn = document.getElementById("library-open-book-btn");
  const backBtn = document.getElementById("library-back-btn");
  const pageSheet = document.getElementById("book-page-sheet");

  if (openBookBtn) {
    openBookBtn.addEventListener("click", () => {
      state.activeBookViewPage = 1;
      renderActiveBookView();
      showLibraryPhase("reading");
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      showLibraryPhase("selection");
    });
  }

  // Touch swipe gesture support for page sheet
  let touchstartX = 0;
  let touchendX = 0;

  if (pageSheet) {
    pageSheet.addEventListener("touchstart", (e) => {
      touchstartX = e.changedTouches[0].screenX;
    }, { passive: true });

    pageSheet.addEventListener("touchend", (e) => {
      touchendX = e.changedTouches[0].screenX;
      const swipeDistance = touchstartX - touchendX;

      if (Math.abs(swipeDistance) > 60) {
        if (swipeDistance > 0) {
          changeBookPage(1); // Swipe left -> Go to next page
        } else {
          changeBookPage(-1); // Swipe right -> Go to prev page
        }
      }
    }, { passive: true });
  }

  // Trigger initial render
  renderLibrarySelectionPhase();
  showLibraryPhase("selection");
}

function renderActiveBookView() {
  const wordsListEl = document.getElementById("book-words-list-el");
  const headerContainer = document.getElementById("book-page-header-container");
  const prevBtn = document.getElementById("book-prev-page-btn");
  const nextBtn = document.getElementById("book-next-page-btn");

  if (!wordsListEl || !headerContainer) return;

  const book = state.activeBookViewBook;
  const unit = state.activeBookViewUnit;
  let activePage = state.activeBookViewPage || 1;

  wordsListEl.innerHTML = "";
  headerContainer.innerHTML = "";

  if (!dictionaryData[book] || !dictionaryData[book][unit]) return;

  const words = dictionaryData[book][unit];

  // Dynamic total pages calculation (10 words per page)
  const totalPages = Math.max(1, Math.ceil(words.length / 10));
  if (activePage > totalPages) activePage = 1;
  state.activeBookViewPage = activePage;

  // 1. Render Header Area
  if (activePage === 1) {
    let unitLabelText = unit;
    if (unit.includes("→")) {
      const [src, tgt] = unit.split("→");
      const srcMeta = LANG_META[src] || { flag: "🌐", name: src };
      const tgtMeta = LANG_META[tgt] || { flag: "🌐", name: tgt };
      unitLabelText = `${srcMeta.flag} → ${tgtMeta.flag}`;
    }
    headerContainer.innerHTML = `
      <div class="book-unit-badge-container">
        <div class="book-unit-circle" style="width: auto; padding: 4px 14px; border-radius: 20px;">
          <span class="unit-lbl">${unitLabelText}</span>
        </div>
        <div class="book-wordlist-ribbon">Word List (${words.length})</div>
      </div>
    `;
  } else {
    headerContainer.innerHTML = `<div class="right-page-header-spacer"></div>`;
  }

  // 2. Update the top-bar title (Book • Unit)
  const topBarTitle = document.getElementById("library-top-bar-title");
  if (topBarTitle) {
    topBarTitle.innerText = `${book} • ${unit}`;
  }

  // 3. Slice words list for current page (10 words per page)
  const pageWords = words.slice((activePage - 1) * 10, activePage * 10);
  const startIndex = (activePage - 1) * 10 + 1;

  function createWordDOM(wordItem, absoluteIndex) {
    const spelling = wordItem.en;
    const translation = wordItem.uz;
    const transcription = wordItem.tr || "";
    const pos = wordItem.pos || "";
    const definition = wordItem.def || "";
    const example = wordItem.ex || "";
    const compositeKey = `${book}|||${unit}|||${spelling}`;
    const isChecked = state.memorizedWords.includes(compositeKey);

    const wordEl = document.createElement("div");
    wordEl.className = "book-word-item";

    let boldedExample = example;
    if (example) {
      boldedExample = example.replace(new RegExp('\\b(' + spelling + '\\w*)\\b', 'gi'), '<strong>$1</strong>');
    }

    const cleanTranscription = transcription
      ? (transcription.startsWith("[") && transcription.endsWith("]") ? transcription : `[${transcription}]`)
      : "";

    wordEl.innerHTML = `
      <div class="book-word-visual">
        <div class="word-book-avatar">${absoluteIndex}</div>
      </div>
      <div class="book-word-details">
        <div class="book-word-header">
          <div class="word-checkbox-container">
            <div class="word-checkbox ${isChecked ? "checked" : ""}" data-key="${compositeKey}"></div>
          </div>
          <span class="book-word-spelling">${escapeHTML(spelling)}</span>
          <button type="button" class="word-audio-btn" aria-label="Talaffuz">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </button>
          ${cleanTranscription ? `<span class="book-word-transcription">${escapeHTML(cleanTranscription)}</span>` : ""}
          ${pos ? `<span class="book-word-pos">${escapeHTML(pos)}</span>` : ""}
          <span class="book-word-translation">${escapeHTML(translation)}</span>
        </div>
        ${definition ? `<div class="book-word-definition">${escapeHTML(definition)}</div>` : ""}
        ${example ? `
        <div class="book-word-example">
          <span class="example-arrow">→</span>
          <span class="example-text">${boldedExample}</span>
        </div>
        ` : ''}
      </div>
    `;

    // Checkbox toggle listener
    const checkbox = wordEl.querySelector(".word-checkbox");
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      const active = checkbox.classList.toggle("checked");
      if (active) {
        if (!state.memorizedWords.includes(compositeKey)) {
          state.memorizedWords.push(compositeKey);
        }
      } else {
        state.memorizedWords = state.memorizedWords.filter(k => k !== compositeKey);
      }
      localStorage.setItem("vocab_memorized_words", JSON.stringify(state.memorizedWords));
    });

    // Row click listener for TTS Audio (uses multi-language voice)
    wordEl.addEventListener("click", (e) => {
      if (e.target.closest(".word-checkbox-container") || e.target.classList.contains("word-checkbox")) {
        return;
      }
      speakWordInLang(spelling, wordItem._srcLang || "en");
    });

    return wordEl;
  }

  // Render page words
  pageWords.forEach((word, idx) => {
    wordsListEl.appendChild(createWordDOM(word, startIndex + idx));
  });

  // 4. Update Prev / Next buttons state
  if (prevBtn) prevBtn.disabled = (activePage === 1);
  if (nextBtn) nextBtn.disabled = (activePage === totalPages);

  // 5. Dynamic Segmented Control Buttons (1-10, 11-20, etc.)
  const segmentedSwitcher = document.getElementById("book-segmented-switcher");
  if (segmentedSwitcher) {
    segmentedSwitcher.innerHTML = "";
    for (let p = 1; p <= totalPages; p++) {
      const start = (p - 1) * 10 + 1;
      const end = Math.min(p * 10, words.length);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `page-segment-btn ${p === activePage ? "active" : ""}`;
      btn.textContent = `${start}-${end}`;
      btn.addEventListener("click", () => changeBookPageDirect(p));
      segmentedSwitcher.appendChild(btn);
    }
  }
}


function changeBookPage(direction) {
  const newPage = (state.activeBookViewPage || 1) + direction;
  if (newPage >= 1 && newPage <= 2) {
    state.activeBookViewPage = newPage;
    renderActiveBookView();
    
    // Scroll book sheet slightly into view on mobile
    const sheet = document.getElementById("book-page-sheet");
    if (sheet) {
      sheet.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
}

function changeBookPageDirect(pageNum) {
  if (pageNum >= 1 && pageNum <= 2) {
    state.activeBookViewPage = pageNum;
    renderActiveBookView();
    
    // Scroll book sheet slightly into view on mobile
    const sheet = document.getElementById("book-page-sheet");
    if (sheet) {
      sheet.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
}

// Bind page change actions to window
window.changeBookPage = changeBookPage;
window.changeBookPageDirect = changeBookPageDirect;

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSetupScreen();
  setupConfigChips();
  initNavigation();
  initSettingsScreen();
  initResultEmptyState();
  initBookViewer();
  initWizardNavigation();
  initAppAlert();
  initCustomWords(); // Custom words module

  // Copy / Context menu prevention to protect dictionary content
  document.addEventListener("copy", (e) => {
    e.preventDefault();
  });
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
  
  // Start Test click trigger
  document.getElementById("start-test-btn").addEventListener("click", () => {
    startQuiz(false);
  });
  
  // Manual next click
  document.getElementById("next-question-btn").addEventListener("click", () => {
    nextQuestion();
  });
  
  // Results: Go back to Amaliyot (practice setup)
  document.getElementById("res-home-btn").addEventListener("click", () => {
    showScreen("setup-screen");
  });
  
  // Results: Retry with mistakes
  document.getElementById("res-retry-mistakes-btn").addEventListener("click", () => {
    startQuiz(true);
  });
});

/* ==========================================================
   CUSTOM WORDS MODULE — Mening Lug'atim
   Foydalanuvchi o'zi so'z kiritishi va tillarni tanlashi
   ========================================================== */

const CUSTOM_WORDS_KEY = "vocab_custom_words";
const CUSTOM_BOOK_NAME = "🖊️ Mening Lug'atim";

// Language metadata map
const LANG_META = {
  en: { code: "en", name: "Ingliz", flag: "🇬🇧", bcp: "en-US" },
  de: { code: "de", name: "Nemis",  flag: "🇩🇪", bcp: "de-DE" },
  fr: { code: "fr", name: "Fransuz",flag: "🇫🇷", bcp: "fr-FR" },
  ru: { code: "ru", name: "Rus",    flag: "🇷🇺", bcp: "ru-RU" },
  es: { code: "es", name: "Ispan",  flag: "🇪🇸", bcp: "es-ES" },
  tr: { code: "tr", name: "Turk",   flag: "🇹🇷", bcp: "tr-TR" },
  ar: { code: "ar", name: "Arab",   flag: "🇸🇦", bcp: "ar-SA" },
  ko: { code: "ko", name: "Koreys", flag: "🇰🇷", bcp: "ko-KR" },
  zh: { code: "zh", name: "Xitoy",  flag: "🇨🇳", bcp: "zh-CN" },
  it: { code: "it", name: "Italyan",flag: "🇮🇹", bcp: "it-IT" },
  ja: { code: "ja", name: "Yapon",  flag: "🇯🇵", bcp: "ja-JP" },
  pt: { code: "pt", name: "Portugiz",flag: "🇧🇷", bcp: "pt-BR" },
  uz: { code: "uz", name: "O'zbek", flag: "🇺🇿", bcp: "uz-UZ" },
};

// ---- In-memory words cache (No localStorage storage for words) ----
let customWordsCache = [];

function loadCustomWords() {
  return customWordsCache;
}

function saveCustomWords(words) {
  customWordsCache = Array.isArray(words) ? words : [];
  try { localStorage.removeItem(CUSTOM_WORDS_KEY); } catch (e) {}
  syncCustomWordsToDictionary();
  saveCustomWordsToServer(customWordsCache);
}

function getOrCreateDeviceId() {
  let devId = null;
  try {
    devId = localStorage.getItem("words_client_device_id");
    if (!devId) {
      devId = "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("words_client_device_id", devId);
    }
  } catch (e) {
    devId = "dev_anon";
  }
  return devId;
}

async function saveCustomWordsToServer(words) {
  try {
    await fetch('/api/words', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getOrCreateDeviceId(),
      },
      body: JSON.stringify({ words, device_id: getOrCreateDeviceId() }),
    });
  } catch (e) {}
}

async function deleteCustomWordFromServer(wordId) {
  try {
    await fetch(`/api/words/${encodeURIComponent(wordId)}`, {
      method: 'DELETE',
      headers: {
        'X-Device-Id': getOrCreateDeviceId(),
      },
    });
  } catch (e) {}
}

async function syncCustomWordsWithServer() {
  try {
    try { localStorage.removeItem(CUSTOM_WORDS_KEY); } catch (e) {}
    const res = await fetch(`/api/words?device_id=${encodeURIComponent(getOrCreateDeviceId())}`, {
      headers: {
        'X-Device-Id': getOrCreateDeviceId(),
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.words)) {
        customWordsCache = data.words;
        syncCustomWordsToDictionary();
        if (typeof renderCustomWordsScreen === "function") renderCustomWordsScreen();
      }
    }
  } catch (e) {}
}

function generateCustomWordId() {
  return "cw_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
}

// ---- Sync custom words into dictionaryData for quiz & library usage ----
function syncCustomWordsToDictionary() {
  const words = loadCustomWords();

  // Reset custom books in dictionaryData
  Object.keys(dictionaryData).forEach(key => {
    if (key === CUSTOM_BOOK_NAME || key.startsWith("📁 ") || key.includes(" - ") || key.startsWith("📖 ")) {
      delete dictionaryData[key];
    }
  });

  if (words.length === 0) {
    if (typeof initSetupScreen === "function") initSetupScreen();
    if (typeof renderLibrarySelectionPhase === "function") renderLibrarySelectionPhase();
    return;
  }

  // Sort words newest first (by createdAt / created_at or timestamp in ID)
  const sortedWords = [...words].sort((a, b) => {
    const timeA = a.createdAt || (a.created_at ? new Date(a.created_at).getTime() : 0) || (a.id && parseInt(a.id.split('_')[1])) || 0;
    const timeB = b.createdAt || (b.created_at ? new Date(b.created_at).getTime() : 0) || (b.id && parseInt(b.id.split('_')[1])) || 0;
    return timeB - timeA;
  });

  // Group words by collection or create standalone Language Pair Books
  sortedWords.forEach(w => {
    const src = w.srcLang || "en";
    const tgt = w.tgtLang || "uz";
    const srcMeta = LANG_META[src] || { flag: "🌐", name: src };
    const tgtMeta = LANG_META[tgt] || { flag: "🌐", name: tgt };

    const item = {
      en: w.source,
      uz: w.target,
      tr: w.transcription || "",
      pos: "",
      def: w.definition || "",
      ex: w.example || "",
      _customId: w.id,
      _srcLang: src,
      _tgtLang: tgt,
      _collection: w.collection || "",
    };

    // Top-level book is ALWAYS Language Pair (e.g. 🇬🇧 Ingliz - 🇺🇿 O'zbek)
    const langBookName = `${srcMeta.flag} ${srcMeta.name} - ${tgtMeta.flag} ${tgtMeta.name}`;
    if (!dictionaryData[langBookName]) dictionaryData[langBookName] = {};

    // Unit key inside the language book: Collection name or default "📁 Aralash"
    const unitKey = w.collection ? `📁 ${w.collection}` : `📁 Aralash`;
    if (!dictionaryData[langBookName][unitKey]) dictionaryData[langBookName][unitKey] = [];
    dictionaryData[langBookName][unitKey].push(item);
  });

  if (typeof initSetupScreen === "function") initSetupScreen();
  if (typeof renderLibrarySelectionPhase === "function") renderLibrarySelectionPhase();
}

// ---- Render word cards on custom-screen ----
function renderCustomWordsScreen(filterText, filterLang) {
  const words = loadCustomWords();
  const list = document.getElementById("custom-words-list");
  const emptyState = document.getElementById("custom-empty-state");
  const bulkBar = document.getElementById("custom-bulk-bar");
  const totalEl = document.getElementById("cstat-total");
  const langsEl = document.getElementById("cstat-langs");
  const collEl = document.getElementById("cstat-collections");

  // Sort words newest first
  const sortedWords = [...words].sort((a, b) => {
    const timeA = a.createdAt || (a.created_at ? new Date(a.created_at).getTime() : 0) || (a.id && parseInt(a.id.split('_')[1])) || 0;
    const timeB = b.createdAt || (b.created_at ? new Date(b.created_at).getTime() : 0) || (b.id && parseInt(b.id.split('_')[1])) || 0;
    return timeB - timeA;
  });

  // Update stats
  const langPairs = new Set(sortedWords.map(w => `${w.srcLang}→${w.tgtLang}`));
  const collections = new Set(sortedWords.filter(w => w.collection).map(w => w.collection));
  if (totalEl) totalEl.textContent = sortedWords.length;
  if (langsEl) langsEl.textContent = langPairs.size;
  if (collEl) collEl.textContent = collections.size;

  // Apply filters
  let filtered = sortedWords;
  const q = (filterText || "").trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(w =>
      w.source.toLowerCase().includes(q) ||
      w.target.toLowerCase().includes(q) ||
      (w.collection || "").toLowerCase().includes(q)
    );
  }
  if (filterLang && filterLang !== "all") {
    filtered = filtered.filter(w => w.srcLang === filterLang || w.tgtLang === filterLang);
  }

  // Update lang filter dropdown
  const langFilterEl = document.getElementById("custom-lang-filter");
  if (langFilterEl) {
    const currentVal = langFilterEl.value;
    langFilterEl.innerHTML = `<option value="all">Barcha tillar</option>`;
    langPairs.forEach(pair => {
      const [src, tgt] = pair.split("→");
      const srcMeta = LANG_META[src] || { flag: "🌐", name: src };
      const tgtMeta = LANG_META[tgt] || { flag: "🌐", name: tgt };
      const opt = document.createElement("option");
      opt.value = src;
      opt.textContent = `${srcMeta.flag} ${srcMeta.name}`;
      langFilterEl.appendChild(opt);
    });
    langFilterEl.value = currentVal;
  }

  // Render Top Collections Bar
  const collBar = document.getElementById("custom-collections-bar");
  if (collBar) {
    collBar.innerHTML = "";
    if (collections.size > 0) {
      collBar.style.display = "flex";
      collections.forEach(collName => {
        const collWordsCount = sortedWords.filter(x => x.collection === collName).length;
        const chip = document.createElement("div");
        chip.className = "custom-coll-chip";
        chip.title = `'${collName}' to'plami va uning barcha so'zlarini tahrirlash`;
        chip.innerHTML = `<span>📁 ${escapeHTML(collName)}</span><span style="opacity:0.75; font-size:0.75rem;">(${collWordsCount} so'z)</span> <span class="edit-icon">✏️</span>`;
        chip.addEventListener("click", () => {
          openEditCollectionModal(collName);
        });
        collBar.appendChild(chip);
      });
    } else {
      collBar.style.display = "none";
    }
  }

  // Empty state handling
  if (words.length === 0) {
    if (emptyState) emptyState.style.display = "flex";
    if (list) list.style.display = "none";
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  if (list) list.style.display = "flex";

  if (!list) return;
  list.innerHTML = "";

  filtered.forEach(w => {
    const srcMeta = LANG_META[w.srcLang] || { flag: "🌐", name: w.srcLang };
    const tgtMeta = LANG_META[w.tgtLang] || { flag: "🌐", name: w.tgtLang };
    const langLabel = `${srcMeta.flag} ${srcMeta.name} → ${tgtMeta.flag} ${tgtMeta.name}`;

    const card = document.createElement("div");
    card.className = "custom-word-card";
    card.innerHTML = `
      <div class="custom-word-card-header">
        <div class="custom-word-card-words">
          <span class="custom-word-source">${escapeHTML(w.source)}</span>
          ${w.transcription ? `<span class="custom-word-transcription">${escapeHTML(w.transcription)}</span>` : ""}
          <span class="custom-word-target">${escapeHTML(w.target)}</span>
          ${w.definition ? `<div class="custom-word-def">${escapeHTML(w.definition)}</div>` : ""}
          ${w.example ? `<div class="custom-word-ex">→ ${escapeHTML(w.example)}</div>` : ""}
        </div>
        <div class="custom-word-card-actions">
          <button type="button" class="custom-word-action-btn audio" aria-label="Talaffuz">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
          </button>
          <button type="button" class="custom-word-action-btn edit" aria-label="Tahrirlash">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button type="button" class="custom-word-action-btn delete" aria-label="O'chirish">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </div>
      <div class="custom-word-card-footer">
        <span class="custom-lang-badge">${langLabel}</span>
        ${w.collection ? `<span class="custom-collection-badge coll-tag-clickable" style="cursor:pointer;" title="To'plamni tahrirlash">📁 ${escapeHTML(w.collection)} ✏️</span>` : ""}
      </div>
    `;

    // Click on collection tag -> open Edit Collection modal
    const collBadge = card.querySelector(".custom-collection-badge");
    if (collBadge && w.collection) {
      collBadge.addEventListener("click", () => {
        openEditCollectionModal(w.collection);
      });
    }

    // Audio
    card.querySelector(".custom-word-action-btn.audio").addEventListener("click", () => {
      speakWordInLang(w.source, w.srcLang);
    });

    // Edit
    card.querySelector(".custom-word-action-btn.edit").addEventListener("click", () => {
      openCustomWordModal(w.id);
    });

    // Delete
    card.querySelector(".custom-word-action-btn.delete").addEventListener("click", () => {
      showAppConfirm(
        "So'zni o'chirish",
        `"${w.source}" so'zini o'chirib tashlamoqchimisiz?`,
        () => {
          const words2 = loadCustomWords().filter(x => x.id !== w.id);
          saveCustomWords(words2);
          deleteCustomWordFromServer(w.id);
          renderCustomWordsScreen(
            document.getElementById("custom-search-input")?.value || "",
            document.getElementById("custom-lang-filter")?.value || "all"
          );
        }
      );
    });

    list.appendChild(card);
  });
}

// ---- HTML escape helper ----
function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Multi-language TTS ----
function speakWordInLang(text, langCode) {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.TelegramWebviewProxy;
  const meta = LANG_META[langCode] || { bcp: "en-US" };

  // For English fallback to existing speakWord (Youdao TTS, best quality for EN)
  if (langCode === "en" && isMobile) {
    speakWord(text);
    return;
  }

  // Other languages: use Web Speech API
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = meta.bcp;
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  } else {
    // Fallback to existing speakWord
    speakWord(text);
  }
}

// ---- Dynamic Word Rows & Per-Word Optional Accordion ----
function resetWordRowsContainer() {
  const container = document.getElementById("cw-words-container");
  if (container) container.innerHTML = "";
}

function addWordRowToModal(sourceVal = "", targetVal = "", transVal = "", defVal = "", exVal = "") {
  const container = document.getElementById("cw-words-container");
  if (!container) return;

  const srcLang = document.getElementById("cw-source-lang")?.value || "en";
  const tgtLang = document.getElementById("cw-target-lang")?.value || "uz";
  const srcMeta = LANG_META[srcLang] || { name: "So'z" };
  const tgtMeta = LANG_META[tgtLang] || { name: "Tarjima" };

  const rowIndex = container.querySelectorAll(".cw-word-row-card").length + 1;
  const hasOptionalData = !!(transVal || defVal || exVal);

  const card = document.createElement("div");
  card.className = "cw-word-row-card";
  card.innerHTML = `
    <div class="cw-word-row-main">
      <div class="cw-word-row-inputs">
        <div class="cw-field">
          <label class="cw-label row-src-lbl">${rowIndex}-so'z (${srcMeta.name})</label>
          <input type="text" class="cw-input row-src-input" placeholder="e.g. apple" value="${escapeHTML(sourceVal)}" autocomplete="off" spellcheck="false">
        </div>
        <div class="cw-field">
          <label class="cw-label row-tgt-lbl">Tarjima (${tgtMeta.name})</label>
          <input type="text" class="cw-input row-tgt-input" placeholder="e.g. olma" value="${escapeHTML(targetVal)}" autocomplete="off">
        </div>
      </div>
      <div class="cw-word-row-actions">
        <button type="button" class="cw-row-opt-toggle-btn ${hasOptionalData ? 'active' : ''}" title="Qo'shimcha ma'lumotlar (Transkripsiya, Izoh, Misol...)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83 2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <button type="button" class="cw-row-remove-btn" title="Qatorni o'chirish" style="display: ${rowIndex > 1 ? 'flex' : 'none'};">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="cw-word-row-optional" style="display: ${hasOptionalData ? 'flex' : 'none'};">
      <div class="cw-field">
        <label class="cw-label">Transkripsiya <span class="cw-optional">(opsional)</span></label>
        <input type="text" class="cw-input row-trans-input" placeholder="e.g. [ǽpl]" value="${escapeHTML(transVal)}" autocomplete="off" spellcheck="false">
      </div>
      <div class="cw-field">
        <label class="cw-label">Izoh / Ta'rif <span class="cw-optional">(opsional)</span></label>
        <textarea class="cw-textarea row-def-input" placeholder="So'zning izohi..." rows="2">${escapeHTML(defVal)}</textarea>
      </div>
      <div class="cw-field">
        <label class="cw-label">Misol gap <span class="cw-optional">(opsional)</span></label>
        <textarea class="cw-textarea row-ex-input" placeholder="So'zni ishlatgan misol gap..." rows="2">${escapeHTML(exVal)}</textarea>
      </div>
    </div>
  `;

  // Toggle optional fields for this row
  const optToggleBtn = card.querySelector(".cw-row-opt-toggle-btn");
  const optBody = card.querySelector(".cw-word-row-optional");
  optToggleBtn.addEventListener("click", () => {
    const isOpen = optBody.style.display !== "none";
    optBody.style.display = isOpen ? "none" : "flex";
    optToggleBtn.classList.toggle("active", !isOpen);
  });

  // Remove row listener
  card.querySelector(".cw-row-remove-btn").addEventListener("click", () => {
    card.remove();
    updateRowIndicesAndLabels();
  });

  container.appendChild(card);
  updateRowIndicesAndLabels();

  // Auto focus newly added source input if not initial render
  const newInputs = card.querySelectorAll(".row-src-input");
  if (newInputs.length > 0 && container.querySelectorAll(".cw-word-row-card").length > 1) {
    newInputs[0].focus();
  }
}

function updateRowIndicesAndLabels() {
  const container = document.getElementById("cw-words-container");
  if (!container) return;
  const cards = container.querySelectorAll(".cw-word-row-card");
  const srcLang = document.getElementById("cw-source-lang")?.value || "en";
  const tgtLang = document.getElementById("cw-target-lang")?.value || "uz";
  const srcMeta = LANG_META[srcLang] || { name: "So'z" };
  const tgtMeta = LANG_META[tgtLang] || { name: "Tarjima" };

  cards.forEach((card, idx) => {
    const srcLbl = card.querySelector(".row-src-lbl");
    const tgtLbl = card.querySelector(".row-tgt-lbl");
    const removeBtn = card.querySelector(".cw-row-remove-btn");
    if (srcLbl) srcLbl.textContent = cards.length > 1 ? `${idx + 1}-so'z (${srcMeta.name})` : `So'z (${srcMeta.name})`;
    if (tgtLbl) tgtLbl.textContent = `Tarjima (${tgtMeta.name})`;
    if (removeBtn) removeBtn.style.display = cards.length > 1 ? "flex" : "none";
  });
}

function getWordRowsFromModal() {
  const container = document.getElementById("cw-words-container");
  if (!container) return [];
  const cards = container.querySelectorAll(".cw-word-row-card");
  const result = [];
  cards.forEach(card => {
    const src = (card.querySelector(".row-src-input")?.value || "").trim();
    const tgt = (card.querySelector(".row-tgt-input")?.value || "").trim();
    const trans = (card.querySelector(".row-trans-input")?.value || "").trim();
    const def = (card.querySelector(".row-def-input")?.value || "").trim();
    const ex = (card.querySelector(".row-ex-input")?.value || "").trim();

    if (src && tgt) {
      result.push({
        source: src,
        target: tgt,
        transcription: trans,
        definition: def,
        example: ex,
      });
    }
  });
  return result;
}

// ---- Modal open/close ----
function openCustomWordModal(editId) {
  const overlay = document.getElementById("custom-word-modal-overlay");
  const titleEl = document.getElementById("cw-modal-title");
  const editIdInput = document.getElementById("cw-edit-id");
  const srcLangSel = document.getElementById("cw-source-lang");
  const tgtLangSel = document.getElementById("cw-target-lang");
  const collInput = document.getElementById("cw-collection");
  const addRowBtn = document.getElementById("cw-add-row-btn");

  updateCollectionDatalist("cw-collection-datalist");
  resetWordRowsContainer();

  if (editId) {
    const words = loadCustomWords();
    const word = words.find(w => w.id === editId);
    if (!word) return;
    if (titleEl) titleEl.textContent = "So'zni tahrirlash";
    if (editIdInput) editIdInput.value = editId;
    if (srcLangSel) srcLangSel.value = word.srcLang || "en";
    if (tgtLangSel) tgtLangSel.value = word.tgtLang || "uz";
    if (collInput) collInput.value = word.collection || "";

    // Load single word row with its optional fields
    addWordRowToModal(
      word.source || "",
      word.target || "",
      word.transcription || "",
      word.definition || "",
      word.example || ""
    );
    if (addRowBtn) addRowBtn.style.display = "none";
  } else {
    if (titleEl) titleEl.textContent = "Yangi so'z qo'shish";
    if (editIdInput) editIdInput.value = "";

    // Pre-select the last used language pair and collection name
    const words = loadCustomWords();
    const lastWord = words.length > 0
      ? [...words].sort((a, b) => {
          const timeA = a.createdAt || (a.created_at ? new Date(a.created_at).getTime() : 0) || (a.id && parseInt(a.id.split('_')[1])) || 0;
          const timeB = b.createdAt || (b.created_at ? new Date(b.created_at).getTime() : 0) || (b.id && parseInt(b.id.split('_')[1])) || 0;
          return timeB - timeA;
        })[0]
      : null;

    const defaultSrc = lastWord?.srcLang || localStorage.getItem("vocab_last_srclang") || "en";
    const defaultTgt = lastWord?.tgtLang || localStorage.getItem("vocab_last_tgtlang") || "uz";
    const defaultColl = lastWord?.collection !== undefined ? lastWord.collection : (localStorage.getItem("vocab_last_collection") || "");

    if (srcLangSel) srcLangSel.value = defaultSrc;
    if (tgtLangSel) tgtLangSel.value = defaultTgt;
    if (collInput) collInput.value = defaultColl;

    // 1 empty row
    addWordRowToModal("", "", "", "", "");
    if (addRowBtn) addRowBtn.style.display = "flex";
  }

  // Ensure Bittalab kiritish tab is active by default
  const tabSingle = document.getElementById("cw-mode-tab-single");
  const tabBulk = document.getElementById("cw-mode-tab-bulk");
  if (tabSingle) tabSingle.classList.add("active");
  if (tabBulk) tabBulk.classList.remove("active");

  updateModalLangLabels();
  if (overlay) overlay.style.display = "flex";

  const firstInput = document.querySelector(".row-src-input");
  if (firstInput) firstInput.focus();
}

function closeCustomWordModal() {
  const overlay = document.getElementById("custom-word-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

function updateModalLangLabels() {
  updateRowIndicesAndLabels();
}

function saveCustomWordFromModal() {
  const editId = document.getElementById("cw-edit-id")?.value || "";
  const srcLang = document.getElementById("cw-source-lang")?.value || "en";
  const tgtLang = document.getElementById("cw-target-lang")?.value || "uz";
  const collection = (document.getElementById("cw-collection")?.value || "").trim();

  if (srcLang === tgtLang) {
    showAppAlert("Bir xil tillar", "Manba tili va tarjima tili bir xil bo'lmasligi kerak!");
    return;
  }

  const wordPairs = getWordRowsFromModal();
  if (wordPairs.length === 0) {
    showAppAlert("Maydon to'ldirilmagan", "Iltimos, kamida bitta so'z va uning tarjimasini kiriting!");
    return;
  }

  // Save last used selections for next time
  try {
    localStorage.setItem("vocab_last_srclang", srcLang);
    localStorage.setItem("vocab_last_tgtlang", tgtLang);
    localStorage.setItem("vocab_last_collection", collection);
  } catch (e) {}

  const words = loadCustomWords();

  if (editId) {
    const idx = words.findIndex(w => w.id === editId);
    if (idx > -1) {
      words[idx] = {
        ...words[idx],
        srcLang,
        tgtLang,
        source: wordPairs[0].source,
        target: wordPairs[0].target,
        transcription: wordPairs[0].transcription,
        collection,
        definition: wordPairs[0].definition,
        example: wordPairs[0].example,
      };
    }
  } else {
    wordPairs.forEach(pair => {
      words.push({
        id: generateCustomWordId(),
        srcLang,
        tgtLang,
        source: pair.source,
        target: pair.target,
        transcription: pair.transcription,
        collection,
        definition: pair.definition,
        example: pair.example,
        createdAt: Date.now(),
      });
    });
  }

  saveCustomWords(words);
  closeCustomWordModal();
  renderCustomWordsScreen(
    document.getElementById("custom-search-input")?.value || "",
    document.getElementById("custom-lang-filter")?.value || "all"
  );

  if (!editId && wordPairs.length > 1) {
    showAppAlert("✅ Saqlandi", `${wordPairs.length} ta so'z muvaffaqiyatli qo'shildi!`);
  }
}

// ---- Collection Batch Edit Modal ----
function openEditCollectionModal(collName) {
  const overlay = document.getElementById("collection-modal-overlay");
  const origNameInput = document.getElementById("coll-original-name");
  const editNameInput = document.getElementById("coll-edit-name");
  const titleEl = document.getElementById("coll-modal-title");
  const countSpan = document.getElementById("coll-words-count");
  const container = document.getElementById("coll-words-container");
  const srcSel = document.getElementById("coll-source-lang");
  const tgtSel = document.getElementById("coll-target-lang");

  if (!overlay || !container) return;

  const words = loadCustomWords().filter(w => w.collection === collName);
  if (words.length === 0) return;

  if (origNameInput) origNameInput.value = collName;
  if (editNameInput) editNameInput.value = collName;
  if (titleEl) titleEl.textContent = `'${collName}' to'plamini tahrirlash`;
  if (countSpan) countSpan.textContent = words.length;

  if (srcSel && words[0]?.srcLang) srcSel.value = words[0].srcLang;
  if (tgtSel && words[0]?.tgtLang) tgtSel.value = words[0].tgtLang;

  container.innerHTML = "";
  words.forEach(w => {
    addCollectionWordRow(container, w);
  });

  overlay.style.display = "flex";
}

function closeCollectionModal() {
  const overlay = document.getElementById("collection-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

function addCollectionWordRow(container, wordObj = null) {
  const src = wordObj ? wordObj.source : "";
  const tgt = wordObj ? wordObj.target : "";
  const trans = wordObj ? (wordObj.transcription || "") : "";
  const def = wordObj ? (wordObj.definition || "") : "";
  const ex = wordObj ? (wordObj.example || "") : "";
  const id = wordObj ? wordObj.id : generateCustomWordId();
  const srcLang = wordObj ? wordObj.srcLang : (document.getElementById("coll-source-lang")?.value || "en");
  const tgtLang = wordObj ? wordObj.tgtLang : (document.getElementById("coll-target-lang")?.value || "uz");
  const hasOptionalData = !!(trans || def || ex);

  const card = document.createElement("div");
  card.className = "cw-word-row-card coll-word-item";
  card.dataset.wordId = id;

  card.innerHTML = `
    <div class="cw-word-row-main">
      <div class="cw-word-row-inputs">
        <div class="cw-field">
          <input type="text" class="cw-input coll-src-input" placeholder="So'z" value="${escapeHTML(src)}" autocomplete="off">
        </div>
        <div class="cw-field">
          <input type="text" class="cw-input coll-tgt-input" placeholder="Tarjima" value="${escapeHTML(tgt)}" autocomplete="off">
        </div>
      </div>
      <div class="cw-word-row-actions">
        <button type="button" class="cw-row-opt-toggle-btn ${hasOptionalData ? 'active' : ''}" title="Qo'shimcha ma'lumotlar (Transkripsiya, Izoh, Misol...)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83 2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <button type="button" class="cw-row-remove-btn coll-row-del-btn" title="So'zni o'chirish" style="display: flex;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="cw-word-row-optional" style="display: ${hasOptionalData ? 'flex' : 'none'}; flex-direction: column; gap: 8px; padding-top: 8px;">
      <div class="cw-field">
        <label class="cw-label">Transkripsiya <span class="cw-optional">(opsional)</span></label>
        <input type="text" class="cw-input coll-trans-input" placeholder="e.g. [ǽpl]" value="${escapeHTML(trans)}" autocomplete="off" spellcheck="false">
      </div>
      <div class="cw-field">
        <label class="cw-label">Izoh / Ta'rif <span class="cw-optional">(opsional)</span></label>
        <textarea class="cw-textarea coll-def-input" placeholder="So'zning izohi..." rows="2">${escapeHTML(def)}</textarea>
      </div>
      <div class="cw-field">
        <label class="cw-label">Misol gap <span class="cw-optional">(opsional)</span></label>
        <textarea class="cw-textarea coll-ex-input" placeholder="So'zni ishlatgan misol gap..." rows="2">${escapeHTML(ex)}</textarea>
      </div>
    </div>
  `;

  const optToggleBtn = card.querySelector(".cw-row-opt-toggle-btn");
  const optBody = card.querySelector(".cw-word-row-optional");
  optToggleBtn.addEventListener("click", () => {
    const isOpen = optBody.style.display !== "none";
    optBody.style.display = isOpen ? "none" : "flex";
    optToggleBtn.classList.toggle("active", !isOpen);
  });

  card.querySelector(".coll-row-del-btn").addEventListener("click", () => {
    card.remove();
    updateCollWordsCount();
  });

  container.appendChild(card);
  updateCollWordsCount();
}

function updateCollWordsCount() {
  const container = document.getElementById("coll-words-container");
  const countSpan = document.getElementById("coll-words-count");
  if (container && countSpan) {
    const items = container.querySelectorAll(".coll-word-item");
    countSpan.textContent = items.length;
  }
}

async function saveCollectionEditModal() {
  const origName = document.getElementById("coll-original-name")?.value || "";
  const newName = (document.getElementById("coll-edit-name")?.value || "").trim();
  const srcLang = document.getElementById("coll-source-lang")?.value || "en";
  const tgtLang = document.getElementById("coll-target-lang")?.value || "uz";
  const container = document.getElementById("coll-words-container");
  if (!container) return;

  if (srcLang === tgtLang) {
    showAppAlert("Bir xil tillar", "Manba tili va tarjima tili bir xil bo'lmasligi kerak!");
    return;
  }

  if (!newName) {
    showAppAlert("To'plam nomi bo'sh", "Iltimos, to'plam nomini kiriting!");
    return;
  }

  const items = container.querySelectorAll(".coll-word-item");
  const updatedRows = [];
  const activeIds = new Set();

  items.forEach(card => {
    const wordId = card.dataset.wordId;
    const src = (card.querySelector(".coll-src-input")?.value || "").trim();
    const tgt = (card.querySelector(".coll-tgt-input")?.value || "").trim();
    const trans = (card.querySelector(".coll-trans-input")?.value || "").trim();
    const def = (card.querySelector(".coll-def-input")?.value || "").trim();
    const ex = (card.querySelector(".coll-ex-input")?.value || "").trim();

    if (src && tgt) {
      activeIds.add(wordId);
      updatedRows.push({
        id: wordId,
        srcLang,
        tgtLang,
        source: src,
        target: tgt,
        transcription: trans,
        definition: def,
        example: ex,
        collection: newName,
        createdAt: Date.now(),
      });
    }
  });

  if (updatedRows.length === 0) {
    showAppAlert("So'zlar yo'q", "Iltimos, kamida bitta so'z va uning tarjimasini kiriting!");
    return;
  }

  let words = loadCustomWords();

  // Find removed words from this collection and delete them from server
  const origWordsInColl = words.filter(w => w.collection === origName);
  origWordsInColl.forEach(w => {
    if (!activeIds.has(w.id)) {
      deleteCustomWordFromServer(w.id);
    }
  });

  // Remove old words of this collection from local cache array
  words = words.filter(w => w.collection !== origName);

  // Add/Update updated rows
  updatedRows.forEach(row => {
    const existingIdx = words.findIndex(w => w.id === row.id);
    if (existingIdx > -1) {
      words[existingIdx] = { ...words[existingIdx], ...row };
    } else {
      words.push(row);
    }
  });

  saveCustomWords(words);
  closeCollectionModal();
  renderCustomWordsScreen(
    document.getElementById("custom-search-input")?.value || "",
    document.getElementById("custom-lang-filter")?.value || "all"
  );
  showAppAlert("✅ Saqlandi", `'${newName}' to'plami va uning ${updatedRows.length} ta so'zi muvaffaqiyatli yangilandi!`);
}

function deleteCollectionModal() {
  const origName = document.getElementById("coll-original-name")?.value || "";
  if (!origName) return;

  showAppConfirm(
    "To'plamni o'chirish",
    `Haqiqatan ham '${origName}' to'plami va uning barcha so'zlarini o'chirib tashlamoqchimisiz?`,
    async () => {
      let words = loadCustomWords();
      const toDelete = words.filter(w => w.collection === origName);
      toDelete.forEach(w => deleteCustomWordFromServer(w.id));
      words = words.filter(w => w.collection !== origName);
      saveCustomWords(words);
      closeCollectionModal();
      renderCustomWordsScreen();
    }
  );
}

// ---- Bulk Import ----
function openBulkModal() {
  const overlay = document.getElementById("bulk-modal-overlay");
  const input = document.getElementById("bulk-words-input");
  updateCollectionDatalist("bulk-collection-datalist");
  if (input) input.value = "";
  const preview = document.getElementById("bulk-parse-preview");
  if (preview) preview.style.display = "none";
  if (overlay) overlay.style.display = "flex";
}

function closeBulkModal() {
  const overlay = document.getElementById("bulk-modal-overlay");
  if (overlay) overlay.style.display = "none";
}

function parseBulkWords(rawText, srcLang, tgtLang, collection) {
  const lines = rawText.split("\n");
  const parsed = [];
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let wordPart = trimmed;
    let trans = "", def = "", ex = "";

    if (trimmed.includes("|")) {
      const parts = trimmed.split("|").map(p => p.trim());
      wordPart = parts[0];
      if (parts[1]) trans = parts[1];
      if (parts[2]) def = parts[2];
      if (parts[3]) ex = parts[3];
    }

    let src = "", tgt = "";
    const separators = [" - ", " – ", "\t", " = "];
    for (const sep of separators) {
      const idx = wordPart.indexOf(sep);
      if (idx > 0) {
        src = wordPart.slice(0, idx).trim();
        tgt = wordPart.slice(idx + sep.length).trim();
        break;
      }
    }

    if (src && tgt) {
      parsed.push({
        id: generateCustomWordId(),
        srcLang,
        tgtLang,
        source: src,
        target: tgt,
        transcription: trans,
        collection,
        definition: def,
        example: ex,
        createdAt: Date.now(),
      });
    }
  });
  return parsed;
}

function saveBulkWords() {
  const srcLang = document.getElementById("bulk-source-lang")?.value || "en";
  const tgtLang = document.getElementById("bulk-target-lang")?.value || "uz";
  const collection = (document.getElementById("bulk-collection")?.value || "").trim();
  const rawText = document.getElementById("bulk-words-input")?.value || "";

  if (srcLang === tgtLang) {
    showAppAlert("Bir xil tillar", "Manba tili va tarjima tili bir xil bo'lmasligi kerak!");
    return;
  }

  const parsed = parseBulkWords(rawText, srcLang, tgtLang, collection);
  if (parsed.length === 0) {
    showAppAlert("So'z topilmadi", "Hech qanday so'z aniqlanmadi. Format: so'z - tarjima (har bir qatorda)");
    return;
  }

  const existing = loadCustomWords();
  const merged = [...existing, ...parsed];
  saveCustomWords(merged);
  closeBulkModal();
  renderCustomWordsScreen(
    document.getElementById("custom-search-input")?.value || "",
    document.getElementById("custom-lang-filter")?.value || "all"
  );
  showAppAlert("✅ Saqlandi", `${parsed.length} ta so'z muvaffaqiyatli qo'shildi!`);
}

// ---- Collection datalist update ----
function updateCollectionDatalist(datalistId) {
  const datalist = document.getElementById(datalistId);
  if (!datalist) return;
  const words = loadCustomWords();
  const collections = [...new Set(words.filter(w => w.collection).map(w => w.collection))];
  datalist.innerHTML = "";
  collections.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    datalist.appendChild(opt);
  });
}

// ---- Practice screen shortcut from custom-screen ----
function goToPracticeWithCustomWords() {
  const words = loadCustomWords();
  if (words.length === 0) {
    showAppAlert("So'zlar yo'q", "Avval Lug'atim bo'limiga so'z qo'shing!");
    return;
  }
  // Auto-select all custom units in setup wizard
  const customBookUnits = dictionaryData[CUSTOM_BOOK_NAME];
  if (!customBookUnits) return;
  
  // Clear previous selections and select all custom units
  state.selectedUnits = Object.keys(customBookUnits).map(unit => `${CUSTOM_BOOK_NAME}|||${unit}`);
  state.activeSetupBook = CUSTOM_BOOK_NAME;
  
  showScreen("setup-screen");
}

// ---- Main init ----
function initCustomWords() {
  // Initial sync
  syncCustomWordsToDictionary();
  syncCustomWordsWithServer();

  // Render initial state
  renderCustomWordsScreen("", "all");

  // ---- Add Word Buttons (topbar +, empty state, etc) ----
  const addBtn = document.getElementById("custom-open-add-modal-btn");
  if (addBtn) {
    addBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openCustomWordModal(null);
    });
  }

  const emptyAddBtn = document.getElementById("custom-empty-add-btn");
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openCustomWordModal(null);
    });
  }

  // Document-level fallback delegation for add word buttons
  document.addEventListener("click", (e) => {
    const targetAddBtn = e.target.closest("#custom-open-add-modal-btn, .custom-topbar-add-btn, #custom-empty-add-btn");
    if (targetAddBtn) {
      e.preventDefault();
      openCustomWordModal(null);
    }
  });

  // ---- Search ----
  const searchInput = document.getElementById("custom-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderCustomWordsScreen(searchInput.value, document.getElementById("custom-lang-filter")?.value || "all");
    });
  }

  // ---- Lang filter ----
  const langFilter = document.getElementById("custom-lang-filter");
  if (langFilter) {
    langFilter.addEventListener("change", () => {
      renderCustomWordsScreen(document.getElementById("custom-search-input")?.value || "", langFilter.value);
    });
  }

  // ---- Bulk Import open ----
  const bulkOpenBtn = document.getElementById("custom-open-bulk-modal-btn");
  if (bulkOpenBtn) bulkOpenBtn.addEventListener("click", openBulkModal);

  const emptyBulkBtn = document.getElementById("custom-empty-bulk-btn");
  if (emptyBulkBtn) emptyBulkBtn.addEventListener("click", openBulkModal);

  // ---- Practice button from custom screen ----
  const practiceBtn = document.getElementById("custom-practice-btn");
  if (practiceBtn) practiceBtn.addEventListener("click", goToPracticeWithCustomWords);

  // ---- Word Modal: language change -> update labels ----
  const srcLangSel = document.getElementById("cw-source-lang");
  const tgtLangSel = document.getElementById("cw-target-lang");
  if (srcLangSel) srcLangSel.addEventListener("change", updateModalLangLabels);
  if (tgtLangSel) tgtLangSel.addEventListener("change", updateModalLangLabels);

  // ---- Word Modal: close/cancel ----
  const closeBtn = document.getElementById("cw-modal-close-btn");
  const cancelBtn = document.getElementById("cw-cancel-btn");
  if (closeBtn) closeBtn.addEventListener("click", closeCustomWordModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeCustomWordModal);

  // Close on overlay click
  const wordModalOverlay = document.getElementById("custom-word-modal-overlay");
  if (wordModalOverlay) {
    wordModalOverlay.addEventListener("click", (e) => {
      if (e.target === wordModalOverlay) closeCustomWordModal();
    });
  }

  // ---- Word Modal: save ----
  const saveBtn = document.getElementById("cw-save-btn");
  if (saveBtn) saveBtn.addEventListener("click", saveCustomWordFromModal);

  // ---- Bulk Modal: close/cancel ----
  const bulkCloseBtn = document.getElementById("bulk-modal-close-btn");
  const bulkCancelBtn = document.getElementById("bulk-cancel-btn");
  if (bulkCloseBtn) bulkCloseBtn.addEventListener("click", closeBulkModal);
  if (bulkCancelBtn) bulkCancelBtn.addEventListener("click", closeBulkModal);

  const bulkModalOverlay = document.getElementById("bulk-modal-overlay");
  if (bulkModalOverlay) {
    bulkModalOverlay.addEventListener("click", (e) => {
      if (e.target === bulkModalOverlay) closeBulkModal();
    });
  }

  // ---- Bulk Modal: live parse preview ----
  const bulkInput = document.getElementById("bulk-words-input");
  const bulkPreviewEl = document.getElementById("bulk-parse-preview");
  const bulkCountEl = document.getElementById("bulk-preview-count");
  if (bulkInput) {
    bulkInput.addEventListener("input", () => {
      const srcL = document.getElementById("bulk-source-lang")?.value || "en";
      const tgtL = document.getElementById("bulk-target-lang")?.value || "uz";
      const parsed = parseBulkWords(bulkInput.value, srcL, tgtL, "");
      if (bulkPreviewEl && bulkCountEl) {
        if (parsed.length > 0) {
          bulkPreviewEl.style.display = "block";
          bulkCountEl.textContent = `${parsed.length} ta so'z aniqlandi`;
        } else {
          bulkPreviewEl.style.display = "none";
        }
      }
    });
  }

  // ---- Word Modal: Mode Switcher Tabs (Bittalab vs Ko'plab) & Add Row ----
  const tabSingle = document.getElementById("cw-mode-tab-single");
  const tabBulk = document.getElementById("cw-mode-tab-bulk");
  if (tabSingle) {
    tabSingle.addEventListener("click", () => {
      if (tabSingle) tabSingle.classList.add("active");
      if (tabBulk) tabBulk.classList.remove("active");
    });
  }
  if (tabBulk) {
    tabBulk.addEventListener("click", () => {
      closeCustomWordModal();
      openBulkModal();
    });
  }

  const addRowBtn = document.getElementById("cw-add-row-btn");
  if (addRowBtn) {
    addRowBtn.addEventListener("click", () => {
      addWordRowToModal("", "", "", "", "");
    });
  }

  // ---- Bulk Modal: save ----
  const bulkSaveBtn = document.getElementById("bulk-save-btn");
  if (bulkSaveBtn) bulkSaveBtn.addEventListener("click", saveBulkWords);

  // ---- Collection Modal: listeners ----
  const collCloseBtn = document.getElementById("coll-modal-close-btn");
  const collCancelBtn = document.getElementById("coll-cancel-btn");
  if (collCloseBtn) collCloseBtn.addEventListener("click", closeCollectionModal);
  if (collCancelBtn) collCancelBtn.addEventListener("click", closeCollectionModal);

  const collSaveBtn = document.getElementById("coll-save-btn");
  if (collSaveBtn) collSaveBtn.addEventListener("click", saveCollectionEditModal);

  const collDeleteBtn = document.getElementById("coll-delete-btn");
  if (collDeleteBtn) collDeleteBtn.addEventListener("click", deleteCollectionModal);

  const collAddWordBtn = document.getElementById("coll-add-word-btn");
  if (collAddWordBtn) {
    collAddWordBtn.addEventListener("click", () => {
      const container = document.getElementById("coll-words-container");
      if (container) addCollectionWordRow(container, null);
    });
  }

  const collOverlay = document.getElementById("collection-modal-overlay");
  if (collOverlay) {
    collOverlay.addEventListener("click", (e) => {
      if (e.target === collOverlay) closeCollectionModal();
    });
  }
}





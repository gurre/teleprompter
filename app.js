// App wires the editor and prompter screens to the keyboard,
// speech recognition and the scroll loop.
//
// The prompter follows the presenter's voice: a word position projected from
// what they say, which the text glides to (Pace.offset). A faint pace line
// shows where they would be at the optimal pace, the pace that ends on the
// target length (or OPTIMAL_WPM without one). Where voice cannot work, the
// text scrolls at that optimal pace instead.
(() => {
  const STORE_KEY = 'teleprompter';
  const SESSION_KEY = 'teleprompter.session';
  const DEFAULTS = { script: '', fontSize: 64, width: 70, lang: 'en-US', target: 0, recall: false, recallPercent: 30 };
  const RANGES = { fontSize: 'font-size', width: 'width', recallPercent: 'recall-percent' };
  const UNITS = { fontSize: 'px', width: '%', recallPercent: '%' };
  const LIMITS = { fontSize: [24, 160] };
  const OPTIMAL_WPM = 140; // a comfortable presenting pace
  const LINE_HEIGHT = 1.5; // matches #text line-height
  const SESSION_FRESH_MS = 30 * 60000; // older sessions are offered, not assumed
  const CONFIRM_MS = 1500; // second press window for T (restart timer)
  const ON_TIME_MS = 5000; // schedule readout step
  const PAUSE_FOR_ONSET = 0.5; // s of silence before speech counts as resuming
  const REPEATABLE = new Set(['+', '=', '-']);

  const $ = (id) => document.getElementById(id);
  const ui = {
    editor: $('editor'), input: $('script'), stats: $('stats'), lang: $('lang'),
    hint: $('voice-hint'), start: $('start'), restart: $('restart'), target: $('target'),
    recall: $('recall'), recallAmount: $('recall-amount'),
    prompter: $('prompter'), text: $('text'), paceLine: $('pace-line'), progress: $('progress'), status: $('status'),
    clock: $('clock'), elapsed: $('elapsed'), left: $('left'),
  };

  // Settings and the script are what the user chose; the session is where
  // they were and when they started. Everything else is derived. They are
  // stored apart so the per-word session save never rewrites the script
  // (another tab may be editing it).
  let settings = read(STORE_KEY, DEFAULTS);

  function read(key, defaults) {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || 'null');
      return defaults ? { ...defaults, ...stored } : stored;
    } catch (err) {
      console.error(`teleprompter: stored ${key} is unreadable, ignoring it`, err);
      return defaults ? { ...defaults } : null;
    }
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  }

  // ---- Editor ---------------------------------------------------------------

  ui.input.addEventListener('input', () => {
    settings.script = ui.input.value;
    localStorage.removeItem(SESSION_KEY); // positions refer to the old text
    save();
    renderEditor();
  });

  for (const [key, id] of Object.entries(RANGES)) {
    $(id).addEventListener('input', () => {
      settings[key] = Number($(id).value);
      save();
      renderRange(key);
    });
  }

  function renderRange(key) {
    $(RANGES[key]).value = settings[key];
    $(RANGES[key] + '-out').textContent = settings[key] + UNITS[key];
  }

  ui.target.addEventListener('input', () => {
    const ms = Timing.parseTarget(ui.target.value);
    ui.target.classList.toggle('invalid', Number.isNaN(ms));
    if (Number.isNaN(ms)) return;
    settings.target = ms;
    save();
    renderEditor();
  });
  ui.recall.addEventListener('change', () => {
    settings.recall = ui.recall.checked;
    save();
    renderRecall();
  });

  function renderRecall() {
    ui.recall.checked = settings.recall;
    ui.recallAmount.classList.toggle('off', !settings.recall);
  }

  ui.lang.addEventListener('input', () => {
    settings.lang = ui.lang.value.trim() || DEFAULTS.lang;
    save();
  });

  ui.hint.textContent = !Voice.supported()
    ? 'This browser cannot follow your voice (use Chrome or Safari); the text will scroll at the optimal pace.'
    : location.protocol === 'file:'
      ? 'Voice-follow works best served from localhost (see README); opened as a file the browser may ask for the microphone every time.'
      : 'Voice-follow uses the browser’s speech service. In Chrome it needs internet.';

  // fillEditor shows the stored settings in the editor's fields.
  function fillEditor() {
    ui.input.value = settings.script;
    for (const key of Object.keys(RANGES)) renderRange(key);
    ui.target.value = settings.target ? Timing.format(settings.target) : '';
    ui.lang.value = settings.lang;
    renderRecall();
    renderEditor();
  }

  // offer decides what Start does. A recent session is resumed; an old one
  // (yesterday's rehearsal) is only offered, so Start begins at the top.
  let offer = { primary: null, secondary: null };

  function renderEditor() {
    const parsed = Script.parse(settings.script);
    const words = parsed.words.length;
    let text = `${words} words · `;
    text += settings.target && words
      ? `optimal pace ${Math.round(words / (settings.target / 60000))} wpm to end at ${Timing.format(settings.target)}`
      : `~${Timing.format((words / OPTIMAL_WPM) * 60000)} at the optimal ${OPTIMAL_WPM} wpm`;
    ui.stats.textContent = text;

    const session = read(SESSION_KEY);
    const resume = session && { ...session, percent: Math.round((session.word / Math.max(words, 1)) * 100) };
    const fresh = resume && Date.now() - resume.savedAt < SESSION_FRESH_MS;
    offer = fresh ? { primary: resume, secondary: 'top' } : { primary: 'top', secondary: resume };
    ui.start.firstChild.textContent = fresh ? `Resume at ${resume.percent}% ` : 'Start ';
    ui.restart.hidden = !resume;
    if (resume) {
      const when = new Date(resume.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ui.restart.textContent = fresh ? 'Start from the top' : `Resume at ${resume.percent}% (left at ${when})`;
    }
  }

  function startOffered(which) {
    const choice = offer[which];
    if (choice === 'top') return enter(null);
    // An old session keeps its place but not its timer.
    const fresh = Date.now() - choice.savedAt < SESSION_FRESH_MS;
    enter(fresh ? choice : { ...choice, startedAt: null });
  }

  ui.start.addEventListener('click', () => startOffered('primary'));
  ui.restart.addEventListener('click', () => startOffered('secondary'));

  // Another tab changed the script or settings: show them, unless presenting.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY || active) return;
    settings = read(STORE_KEY, DEFAULTS);
    fillEditor();
  });

  fillEditor();

  // ---- Prompter state -------------------------------------------------------

  let active = false;
  let doc = { words: [], paragraphs: [] };
  let norms = []; // normalized words for the follower
  let spans = []; // word index → element
  let boxes = []; // word index → { top, left, width, bottom } in px within #text
  let tops = []; // word index → offset in px, relative to word 0
  let lines = []; // [{ start, top }] per visual line, plus a closing sentinel
  let scroll = { position: 0, target: 0, max: 0 };

  // Voice follow
  let voice = null; // recognizer, unless this browser has none
  let listening = false;
  let voiceError = ''; // sticky until speech is heard again
  let voiceFailed = false; // voice cannot work here: scroll at the optimal pace
  let follow = { cursor: -1, pending: null }; // see Follower.step
  let pace = Pace.create();
  let spoken = null; // fractional word index being said; only ever increases
  let meter = null; // microphone level meter for voice activity
  let meterWarning = '';
  let detector = Vad.createDetector();
  const voicedLog = Vad.createLog(); // when the presenter was audibly speaking
  let usedOnset = null; // speech onset already used to calibrate latency
  let speechClock = 0; // seconds the presenter has been audibly speaking
  let loudNow = false; // the presenter is making sound this very frame
  let highlighted = -1;
  let highlightedAt = 0; // s, when the highlight last stepped

  // Recall practice
  let hidden = []; // word index → hidden behind a gray box
  let revealedUpTo = -1; // hidden words up to here have been passed and shown
  let heardOk = new Set(); // words the presenter was heard saying

  // Scrolling at the optimal pace, where voice cannot work
  let playing = false;
  let autoF = 0; // fractional word position reached

  // Time
  let timer = { startedAt: null, startWord: 0 }; // speech timer
  let timerConfirm = 0; // when T was first pressed
  let readout = { elapsed: null, left: null, slack: null }; // what the HUD shows
  let hold = Infinity; // pace that ends on target (see holdPace)
  let hudText = '';
  let shownStatus = '';
  let savedWord = -1;
  let paceWord = -1; // word the pace line is under
  let cue = { word: -1, kind: '' }; // the ready / not ready underline

  // Screen
  let wakeLock = null;
  let wakeWarning = '';
  let screenWarning = '';
  let frameId = 0;
  let lastFrame = 0;
  let flashText = '';
  let flashTimer = 0;

  function enter(session) {
    if (active) return;
    doc = Script.parse(settings.script);
    if (!doc.words.length) {
      ui.input.focus();
      ui.stats.textContent = 'Paste a script first.';
      return;
    }
    active = true;
    norms = doc.words.map((w) => w.norm);
    ui.editor.hidden = true;
    ui.prompter.hidden = false;
    render();
    const word = Scroller.clamp(session?.word ?? 0, 0, spans.length - 1);
    scroll = { position: tops[word], target: tops[word], max: scroll.max };
    autoF = Pace.indexAt(lines, scroll.target);
    playing = false;
    timer = session?.startedAt ? { startedAt: session.startedAt, startWord: session.startWord ?? 0 } : { startedAt: null, startWord: word };
    readout = { elapsed: null, left: null, slack: null };
    savedWord = paceWord = -1;
    cue = { word: -1, kind: '' };
    wakeWarning = screenWarning = '';
    startVoice();
    goFullscreen();
    lockScreen();
    lastFrame = 0;
    frameId = requestAnimationFrame(frame);
    renderStatus();
  }

  function exit() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(frameId);
    stopVoice();
    wakeLock?.release();
    wakeLock = null;
    if (document.fullscreenElement) document.exitFullscreen();
    ui.prompter.hidden = true;
    ui.editor.hidden = false;
    renderEditor();
    ui.input.focus();
  }

  function goFullscreen() {
    if (document.fullscreenElement) return;
    if (!document.documentElement.requestFullscreen) {
      screenWarning = 'fullscreen unavailable';
      return renderStatus();
    }
    document.documentElement
      .requestFullscreen()
      .then(() => {
        if (!active) document.exitFullscreen(); // left the prompter while waiting
      })
      .catch((err) => {
        screenWarning = `not fullscreen (${err.message}) · F to retry`;
        renderStatus();
      });
  }

  // ---- Layout ---------------------------------------------------------------

  function render() {
    ui.text.replaceChildren(ui.paceLine);
    spans = [];
    for (const para of doc.paragraphs) {
      const p = document.createElement('p');
      for (let i = para.start; i < para.end; i++) {
        const w = doc.words[i];
        if (w.lineBreak) p.append(document.createElement('br'));
        else if (i > para.start && !w.joined) p.append(' ');
        const span = document.createElement('span');
        span.textContent = w.text;
        p.append(span);
        spans.push(span);
      }
      ui.text.append(p);
    }
    hidden = settings.recall ? Recall.hide(doc.words, settings.recallPercent) : [];
    revealedUpTo = -1;
    heardOk = new Set();
    hidden.forEach((h, i) => h && spans[i].classList.add('recall'));
    applyLayout();
  }

  function applyLayout() {
    ui.prompter.style.setProperty('--font-size', settings.fontSize + 'px');
    ui.prompter.style.setProperty('--width', settings.width + '%');
    measure();
  }

  function lineHeight() {
    return settings.fontSize * LINE_HEIGHT;
  }

  // measure reads every word's box once after layout; everything else works
  // from that cache, so the loop never forces layout and a reflow can be
  // compared against the geometry from before it. Positions are relative to
  // the first word so position 0 shows it on the reading line.
  function measure() {
    boxes = spans.map((s) => ({ top: s.offsetTop, left: s.offsetLeft, width: s.offsetWidth, bottom: s.offsetTop + s.offsetHeight }));
    const origin = boxes[0].top;
    tops = boxes.map((b) => b.top - origin);
    scroll.max = tops[tops.length - 1];
    // Words on one visual line can differ by a pixel or two (fallback fonts).
    lines = [];
    for (let i = 0; i < tops.length; i++) {
      if (!lines.length || tops[i] - lines[lines.length - 1].top > lineHeight() / 2) lines.push({ start: i, top: tops[i] });
    }
    lines.push({ start: tops.length, top: scroll.max + lineHeight() });
    paceWord = -1; // re-place the pace line
  }

  // wordAt returns the first word on or below the reading line.
  function wordAt(position) {
    let lo = 0;
    let hi = tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] < position - 1) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // relayout keeps the reader's place across reflows (font size change,
  // entering fullscreen, window resize).
  function relayout() {
    const word = wordAt(scroll.target); // from the geometry before the reflow
    applyLayout();
    let top = tops[word];
    if (spoken !== null) top = Pace.offset(lines, spoken);
    else if (playing) top = Pace.offset(lines, autoF);
    scroll.position = scroll.target = Scroller.clamp(top, 0, scroll.max);
    if (!playing) autoF = Pace.indexAt(lines, scroll.target);
    restartReadouts();
  }

  // ---- Loop -----------------------------------------------------------------

  function frame(now) {
    const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;
    hold = holdPace();
    if (voiceFailed) {
      if (playing) {
        autoF = Math.min(autoF + optimalRate() * dt, spans.length);
        scroll.target = Pace.offset(lines, autoF);
        reveal(Math.floor(autoF) - 1, false);
        if (autoF >= spans.length) {
          playing = false;
          renderStatus();
        }
      }
    } else {
      listen(now / 1000, dt);
      glide(now / 1000);
    }
    scroll = Scroller.step(scroll, dt);
    ui.text.style.transform = `translateY(${-scroll.position}px)`;
    ui.progress.style.transform = `scaleX(${scroll.max ? scroll.position / scroll.max : 1})`;
    const word = currentWord();
    if (word !== savedWord) saveSession(word);
    renderHud(word);
    renderPaceLine();
    renderCue();
    const shown = statusKey(); // refresh the status line when what it reports changes
    if (shown !== shownStatus) {
      shownStatus = shown;
      renderStatus();
    }
    frameId = requestAnimationFrame(frame);
  }

  // currentWord is the word being read: the one being said, or the one the
  // optimal-pace scroll has reached.
  function currentWord() {
    if (voiceFailed) return Math.min(Math.floor(autoF), spans.length);
    return Math.min(Math.floor(spoken ?? follow.cursor + 1), spans.length);
  }

  // holdPace is the pace (words/s) that ends the talk exactly on its target
  // time from here; Infinity without a target, once it has passed, or at the
  // end of the script.
  function holdPace() {
    const elapsedMs = timer.startedAt === null ? 0 : Date.now() - timer.startedAt;
    const left = spans.length - (voiceFailed ? autoF : follow.cursor + 1);
    return Timing.targetRate({ targetMs: settings.target, elapsedMs, left });
  }

  // optimalRate is the optimal pace from here, in words/s.
  function optimalRate() {
    return Number.isFinite(hold) ? hold : OPTIMAL_WPM / 60;
  }

  // optimalWord is where the presenter would be now had they kept the optimal
  // pace since the timer started: on schedule for the target, or OPTIMAL_WPM.
  function optimalWord() {
    const start = timer.startWord;
    if (timer.startedAt === null) return start;
    const elapsedS = (Date.now() - timer.startedAt) / 1000;
    const rate = settings.target ? (spans.length - start) / (settings.target / 1000) : OPTIMAL_WPM / 60;
    return Math.min(start + rate * elapsedS, spans.length - 1);
  }

  function saveSession(word) {
    savedWord = word;
    const session = { word, startedAt: timer.startedAt, startWord: timer.startWord, savedAt: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  // ---- Hints ----------------------------------------------------------------

  // renderPaceLine puts the faint pace line under the word of optimal pace
  // once the talk has started; CSS glides it from word to word. It appears
  // in place (no glide) after a restart or a reflow (paceWord -1).
  function renderPaceLine() {
    const started = timer.startedAt !== null;
    ui.paceLine.classList.toggle('shown', started);
    const i = Math.floor(optimalWord());
    if (i === paceWord || !started) return;
    ui.paceLine.classList.toggle('instant', paceWord === -1);
    paceWord = i;
    const b = boxes[i];
    ui.paceLine.style.transform = `translate(${b.left}px, ${b.bottom + settings.fontSize * 0.1}px)`;
    ui.paceLine.style.width = `${b.width}px`;
  }

  // renderCue marks the first word before the talk starts: flashing green
  // when the prompter is ready to follow, steady red while something is not.
  function renderCue() {
    const started = timer.startedAt !== null;
    const word = started ? -1 : wordAt(scroll.target);
    const kind = started ? '' : ready() ? 'ready' : 'not-ready';
    if (word === cue.word && kind === cue.kind) return;
    spans[cue.word]?.classList.remove('ready', 'not-ready');
    cue = { word, kind };
    if (kind) spans[word]?.classList.add(kind);
  }

  // ready is true when starting to speak will move the text. Where voice
  // cannot work it stays false; the status line says why and Space scrolls.
  function ready() {
    if (voiceFailed) return false;
    return Boolean(voice) && voice.active() && listening && !voiceError;
  }

  // ---- HUD ------------------------------------------------------------------

  function renderHud(word) {
    const now = Date.now();
    const elapsedMs = timer.startedAt === null ? 0 : now - timer.startedAt;
    const wordsLeft = spans.length - word;
    const left = voiceFailed
      ? Timing.remainingMs({ wordsLeft, rate: optimalRate() })
      : Timing.remainingMs({ wordsLeft, wordsDone: word - timer.startWord, elapsedMs });
    // The readouts only move one way (see Timing.countDown and friends).
    readout.elapsed = Timing.countUp(readout.elapsed, elapsedMs);
    readout.left = Timing.countDown(readout.left, left);
    let schedule = '';
    if (settings.target) {
      readout.slack = Timing.steady(readout.slack, Timing.slackMs(settings.target, elapsedMs, left), ON_TIME_MS);
      const slack = readout.slack;
      schedule = Math.abs(slack) < ON_TIME_MS ? 'on time' : slack > 0 ? `${Timing.format(slack)} early` : `${Timing.format(-slack)} over`;
    }
    const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const leftText = wordsLeft <= 0 ? 'done' : `−${Timing.format(readout.left)} left`;
    const text = `${clock}|${Timing.format(readout.elapsed)}|${leftText}|${schedule}`;
    if (text === hudText) return;
    hudText = text;
    ui.clock.textContent = clock;
    ui.elapsed.textContent = Timing.format(readout.elapsed);
    ui.left.textContent = schedule ? `${leftText} · ${schedule}` : leftText;
    ui.left.classList.toggle('over', schedule.endsWith('over'));
  }

  // restartReadouts lets time left and the schedule move freely once, after
  // something that really changes them; the elapsed timer only on restart.
  function restartReadouts(elapsedToo = false) {
    readout = { elapsed: elapsedToo ? null : readout.elapsed, left: null, slack: null };
  }

  function startTimer() {
    if (timer.startedAt !== null) return;
    timer = { startedAt: Date.now(), startWord: currentWord() };
    paceWord = -1;
    saveSession(savedWord);
  }

  // T restarts the timer only when pressed twice, so a stray press mid-talk
  // cannot wipe it.
  function restartTimer() {
    const now = Date.now();
    if (now - timerConfirm > CONFIRM_MS) {
      timerConfirm = now;
      return flash('press T again to restart the timer');
    }
    timerConfirm = 0;
    timer = { startedAt: now, startWord: currentWord() };
    paceWord = -1;
    restartReadouts(true);
    saveSession(savedWord);
    renderStatus();
  }

  // ---- Voice ----------------------------------------------------------------

  function startVoice() {
    follow = { cursor: wordAt(scroll.target) - 1, pending: null };
    pace = Pace.create();
    spoken = null;
    voiceError = '';
    voiceFailed = !Voice.supported();
    if (voiceFailed) return;
    const v = Voice.create({
      lang: settings.lang,
      normalize: Script.normalize,
      onWords: (heard, fresh) => voice === v && onSpeech(heard, fresh),
      onState: (state, detail) => {
        if (voice !== v) return; // a recognizer we already replaced
        listening = state === 'listening';
        if (state === 'error') voiceError = detail;
        // An error that retrying cannot fix: scroll at the optimal pace.
        if (state === 'error' && !v.active()) failVoice();
        renderStatus();
      },
    });
    voice = v;
    voice.start();
    openMeter(v);
  }

  // failVoice switches to scrolling at the optimal pace from where the text is.
  function failVoice() {
    voiceFailed = true;
    autoF = Pace.indexAt(lines, scroll.target);
    playing = false;
    highlight(-1);
  }

  // openMeter starts the voice activity meter that lets the glide stop when
  // the presenter pauses. Without it the glide still works, but runs up to
  // COAST seconds of words past a pause before it waits.
  async function openMeter(v) {
    try {
      const m = await Vad.open();
      if (voice !== v) return m.close(); // left the prompter meanwhile
      meter = m;
      meterWarning = '';
    } catch (err) {
      if (voice !== v) return;
      meterWarning = `no level meter (${err.message}): pauses may overshoot`;
    }
    renderStatus();
  }

  function stopVoice() {
    voice?.stop();
    voice = null;
    meter?.close();
    meter = null;
    meterWarning = '';
    listening = false;
    spoken = null;
    highlight(-1);
  }

  // onSpeech records where the speaker is. The follower only moves forward
  // and only on words heard since its last decision, so speech never moves
  // the prompter back and the same words never count twice.
  function onSpeech(heard, fresh) {
    if (voiceError) {
      voiceError = '';
      renderStatus();
    }
    const next = Follower.step(follow, norms, heard, fresh);
    if (next.cursor === follow.cursor && next.pending === follow.pending) return;
    voice.consume(); // these words have been used to decide
    const from = follow.cursor;
    const moved = next.cursor !== from;
    follow = next;
    if (!moved) return;
    if (settings.recall) {
      for (const i of Follower.said(norms, Math.max(0, from - 1), follow.cursor, heard)) markSaid(i);
      reveal(follow.cursor);
    }
    startTimer();
    const now = performance.now() / 1000;
    // The first match after the presenter resumes speaking calibrates latency.
    let onset = meterWorks() ? Vad.lastOnset(voicedLog, PAUSE_FOR_ONSET) : null;
    if (onset !== null && (onset <= pace.at || onset === usedOnset)) onset = null;
    if (onset !== null) usedOnset = onset;
    pace = Pace.observe(pace, follow.cursor, now, onset, meterWorks() ? speechClock : now);
    renderStatus();
  }

  function meterWorks() {
    if (meter && !meter.running()) {
      meterWarning = 'level meter stopped: pauses may overshoot';
      meter.close();
      meter = null;
    }
    return Boolean(meter);
  }

  // listen feeds the voice activity log once per frame.
  function listen(t, dt) {
    if (!dt || !meterWorks()) return;
    const r = Vad.detect(detector, meter.level(), t, dt);
    detector = r.state;
    loudNow = r.loud;
    Vad.record(voicedLog, t - dt, t, r.voiced);
    if (r.voiced) speechClock += dt;
  }

  // glide moves the target toward the word being said right now, projected
  // from the last match at the speaker's pace for as long as they have been
  // talking (if the level meter is believable). It never moves back: if the
  // projection overshot, the text holds still until the speaker catches up.
  function glide(t) {
    const voiced = meter && pace.trusted && pace.index !== null ? Vad.voicedBetween(voicedLog, pace.at - pace.latency, t) : undefined;
    const f = Pace.predict(pace, t, voiced, hold);
    if (f === null) return;
    spoken = Math.min(Math.max(spoken ?? f, f), spans.length - 0.001);
    scroll.target = Math.max(scroll.target, Pace.offset(lines, spoken));
    const talking = !meter || loudNow;
    const target = Pace.highlightWord(pace, spoken, spans.length, hold, talking);
    const next = Pace.stepHighlight(highlighted, target, t - highlightedAt, Pace.pace(pace, hold));
    if (next !== highlighted) highlightedAt = t;
    highlight(next);
  }

  function highlight(i) {
    if (i === highlighted) return;
    spans[highlighted]?.classList.remove('here');
    highlighted = i;
    spans[i]?.classList.add('here');
  }

  // moved is called after a manual move of the target. The optimal-pace
  // scroll continues from there; voice follow re-anchors just before it and
  // forgets what was heard, so it cannot pull back. The measured pace carries
  // over.
  function moved() {
    restartReadouts();
    autoF = Pace.indexAt(lines, scroll.target);
    if (voiceFailed) return;
    follow = { cursor: wordAt(scroll.target) - 1, pending: null };
    revealedUpTo = Math.max(revealedUpTo, follow.cursor); // moved past: not attempted
    pace = Pace.create(pace.rate, pace.latency);
    spoken = null;
    highlight(-1);
    voice.reset();
  }

  // ---- Recall practice ------------------------------------------------------

  // reveal shows the hidden words up to word last once the presenter has
  // passed them: green if they were heard saying it, red if not. Without
  // voice (judged false) there is nothing to judge them by.
  function reveal(last, judged = true) {
    for (let i = revealedUpTo + 1; i <= last; i++) show(i, judged ? (heardOk.has(i) ? 'recall-ok' : 'recall-miss') : 'hinted');
    revealedUpTo = Math.max(revealedUpTo, last);
  }

  // markSaid records that word i was heard. A word already shown red turns
  // green: a later, corrected recognition can show it was said after all.
  function markSaid(i) {
    heardOk.add(i);
    spans[i]?.classList.replace('recall-miss', 'recall-ok');
  }

  // hintNext reveals the next hidden word from the highlight on, for when
  // the presenter is stuck. A hint is not a recall: it shows uncoloured.
  function hintNext() {
    if (!settings.recall) return;
    const from = voiceFailed ? currentWord() : Math.max(highlighted, follow.cursor + 1);
    const i = spans.findIndex((s, k) => k >= from && s.classList.contains('recall'));
    if (i === -1) return flash('no hidden words ahead');
    show(i, 'hinted');
  }

  function show(i, kind) {
    spans[i]?.classList.replace('recall', kind);
  }

  // ---- Controls -------------------------------------------------------------

  function setFontSize(delta) {
    settings.fontSize = Scroller.clamp(settings.fontSize + delta, ...LIMITS.fontSize);
    save();
    renderRange('fontSize');
    relayout();
  }

  // togglePlay pauses or resumes listening, or where voice cannot work, the
  // optimal-pace scroll.
  function togglePlay() {
    if (voiceFailed) {
      playing = !playing && autoF < spans.length;
      if (playing) startTimer();
      return renderStatus();
    }
    if (voice.active()) voice.stop();
    else {
      voiceError = '';
      voice.start();
    }
    renderStatus();
  }

  function flash(text) {
    flashText = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashText = '';
      renderStatus();
    }, CONFIRM_MS);
    renderStatus();
  }

  // statusKey is what the status line reports that changes on its own.
  function statusKey() {
    return voiceFailed ? `${playing}|${Math.round(optimalRate() * 60)}` : `${hold < pace.rate}`;
  }

  function renderStatus() {
    let text;
    if (voiceFailed) {
      text = `${playing ? '▶' : '❚❚ Space to start ·'} optimal pace ${Math.round(optimalRate() * 60)} wpm`;
    } else {
      const state = !voice.active() ? 'paused' : listening ? 'listening' : 'starting';
      text = `voice · ${state} · ${Math.round(pace.rate * 60)} wpm · ${pace.latency.toFixed(2)} s delay · lookahead ${Pace.lookahead(pace, hold).toFixed(1)} words`;
      if (hold < pace.rate) text += ' · held to target';
    }
    if (settings.recall) text = `recall ${settings.recallPercent}% hidden · R reveals · ${text}`;
    if (meterWarning) text += ` · ${meterWarning}`;
    const problem = [voiceError, screenWarning, wakeWarning].filter(Boolean).join(' · ');
    ui.status.textContent = [flashText, problem, text].filter(Boolean).join(' · ');
    ui.status.classList.toggle('error', Boolean(problem));
  }

  const KEYS = {
    ' ': togglePlay,
    '+': () => setFontSize(4),
    '=': () => setFontSize(4),
    '-': () => setFontSize(-4),
    t: restartTimer,
    r: hintNext,
    f: goFullscreen,
    Home: () => {
      scroll.target = 0;
      moved();
    },
    // In fullscreen the browser takes Esc to leave fullscreen and the
    // prompter keeps running; Esc again returns to the editor.
    Escape: () => {
      if (!document.fullscreenElement) exit();
    },
  };

  document.addEventListener('keydown', (e) => {
    if (!active) {
      // ⌘↵ starts what Start offers.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        startOffered('primary');
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const action = KEYS[key];
    if (!action) return;
    e.preventDefault();
    if (e.repeat && !REPEATABLE.has(key)) return;
    action();
  });

  // Losing fullscreen (Esc, a notification) keeps the prompter running; F
  // brings it back.
  document.addEventListener('fullscreenchange', () => {
    if (!active) return;
    screenWarning = document.fullscreenElement ? '' : 'not fullscreen · F to restore, Esc for editor';
    renderStatus();
  });

  window.addEventListener('resize', () => {
    if (active) relayout();
  });

  // ---- Wake lock ------------------------------------------------------------

  async function lockScreen() {
    if (!('wakeLock' in navigator)) {
      wakeWarning = 'screen may sleep (no wake lock)';
      return renderStatus();
    }
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!active) return lock.release(); // left the prompter while waiting
      wakeLock = lock;
      wakeWarning = '';
      // The system can drop the lock (low battery, page hidden); take it back.
      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = null;
        if (active && document.visibilityState === 'visible') lockScreen();
      });
    } catch (err) {
      wakeWarning = `screen may sleep (${err.message})`;
    }
    renderStatus();
  }

  document.addEventListener('visibilitychange', () => {
    if (active && !wakeLock && document.visibilityState === 'visible') lockScreen();
  });
})();

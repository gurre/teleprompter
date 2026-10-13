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
  const DEFAULTS = { script: '', fontSize: 64, width: 70, lang: 'en-US', target: 0, recall: false, recallPercent: 30, voicePrompter: false, promptAfter: 1, ear: false, earLead: 4 };
  const RANGES = { fontSize: 'font-size', width: 'width', recallPercent: 'recall-percent', promptAfter: 'prompt-after', earLead: 'ear-lead' };
  const UNITS = { fontSize: 'px', width: '%', recallPercent: '%', promptAfter: ' s', earLead: ' words' };
  const LIMITS = { fontSize: [24, 160] };
  const OPTIMAL_WPM = 140; // a comfortable presenting pace
  const LINE_HEIGHT = 1.5; // matches #text line-height
  const SESSION_FRESH_MS = 30 * 60000; // older sessions are offered, not assumed
  const CONFIRM_MS = 1500; // second press window for T (restart timer)
  const ON_TIME_MS = Timing.ON_TIME_MS; // schedule readout step
  const PAUSE_FOR_ONSET = 0.5; // s of silence before speech counts as resuming
  const END_WORDS = 2; // within this many words of the end, quiet ends the talk
  const END_QUIET = 2.5; // s of quiet near the end that ends the talk
  const SETTLE = 0.3; // s of silence (after the meter's hangover) before the highlight settles
  const REPEATABLE = new Set(['+', '=', '-']);
  const NOTICE_MS = 10000; // how long a missing-permission banner shows
  const MIC_BLOCKED = 'Microphone blocked: allow it in the browser’s site settings to follow your voice.';
  // Voice prompter
  const ECHO = 0.5; // s after a prompt during which sound is the prompt (Bluetooth plays late)
  const SPOKE = 0.3; // s of voice after a prompt that count as the presenter speaking (not a cough)
  const LOST = 4; // s of talking without a match after which where they are is too uncertain to prompt
  const OFF_AFTER = 5; // s recognition is down before "Prompts off" is said
  const RESTART_GAP = 2; // s recognition may restart in without stopping prompts
  const HIDDEN_FOR = 1; // s the page stays hidden before "Prompter hidden" is said

  const $ = (id) => document.getElementById(id);
  const ui = {
    editor: $('editor'), input: $('script'), stats: $('stats'), lang: $('lang'),
    hint: $('voice-hint'), start: $('start'), restart: $('restart'), target: $('target'),
    recall: $('recall'), recallAmount: $('recall-amount'), permissions: $('permissions'),
    voicePrompter: $('voice-prompter'), voicePrompterHint: $('voice-prompter-hint'), voicePrompterOptions: $('voice-prompter-options'), voicePrompterTest: $('voice-prompter-test'),
    ear: $('ear'), earHint: $('ear-hint'), earOptions: $('ear-options'),
    prompter: $('prompter'), notice: $('notice'), end: $('end'), text: $('text'), paceLine: $('pace-line'), progress: $('progress'), status: $('status'),
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

  // Prompts are said in the Samantha voice only; without it the voice
  // prompter cannot be switched on.
  const speaker = VoicePrompter.speaker(() => renderVoicePrompter());

  ui.voicePrompter.addEventListener('change', () => {
    settings.voicePrompter = ui.voicePrompter.checked;
    save();
    renderVoicePrompter();
  });

  // Test says a whole sentence and how the script starts, so the presenter
  // hears where prompts play and how loud before the talk. A single word can
  // be lost entirely while Bluetooth earphones wake up from silence.
  ui.voicePrompterTest.addEventListener('click', () => {
    const { words } = Script.parse(settings.script);
    const start = words.length ? ` Your talk starts: ${VoicePrompter.text(words, VoicePrompter.phrase(words, 0))}` : '';
    speaker.say(`This is how prompts will sound.${start}`);
  });

  function renderVoicePrompter() {
    const ok = speaker.available();
    ui.voicePrompter.checked = settings.voicePrompter;
    ui.voicePrompter.disabled = ui.voicePrompterTest.disabled = !ok;
    ui.voicePrompterHint.textContent = ok
      ? 'when you stall, hear what comes next in your earphones'
      : 'needs the Samantha voice: add it in System Settings → Accessibility → Spoken Content';
    ui.voicePrompterOptions.classList.toggle('off', !settings.voicePrompter || !ok);
    renderPermissions();
  }

  // promptVoice is the prompt voice as a row of the permissions list: it is
  // what a silent Test is explained by.
  function promptVoice() {
    const { kind, detail } = speaker.state();
    if (kind === 'loading') return { state: 'checking', detail: '' };
    if (kind === 'ready') return { state: 'allowed', detail };
    return { state: 'unavailable', detail };
  }

  // Talk in ear reads in the Samantha voice only; without it talk in ear
  // cannot be switched on. It and the voice prompter are never both on: two
  // voices in one ear.
  const earSpeaker = Ear.speaker(() => renderEar());

  ui.ear.addEventListener('change', () => {
    settings.ear = ui.ear.checked;
    if (settings.ear && settings.voicePrompter) {
      settings.voicePrompter = false;
      renderVoicePrompter();
    }
    save();
    renderEar();
  });

  // Ticking the voice prompter unticks talk in ear, as ticking talk in ear
  // unticks the voice prompter.
  ui.voicePrompter.addEventListener('change', () => {
    if (!ui.voicePrompter.checked || !settings.ear) return;
    settings.ear = false;
    save();
    renderEar();
  });

  function renderEar() {
    const { kind } = earSpeaker.state();
    const ok = kind === 'ready';
    ui.ear.checked = settings.ear;
    ui.ear.disabled = !ok;
    ui.earHint.textContent = ok
      ? 'Samantha reads just ahead of you at your pace; you repeat it'
      : kind === 'loading'
        ? 'looking for a voice…'
        : 'needs the Samantha voice: add it in System Settings → Accessibility → Spoken Content';
    ui.earOptions.classList.toggle('off', !settings.ear || !ok);
    renderPermissions();
  }

  // earVoice is the talk-in-ear voice as a row of the permissions list.
  function earVoice() {
    const { kind, detail } = earSpeaker.state();
    if (kind === 'loading') return { state: 'checking', detail: '' };
    if (kind === 'ready') return { state: 'allowed', detail };
    return { state: 'unavailable', detail };
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

  // ---- Permissions -----------------------------------------------------------

  // Everything is asked for here, on the editor: a permission prompt can end
  // up hidden behind the fullscreen prompter. Each permission is checking,
  // asking, allowed, blocked, unavailable or unasked.
  const PERMISSIONS = [
    ['microphone', 'Microphone'],
    ['speech', 'Speech recognition'],
    ['wakeLock', 'Keep screen awake'],
    ['fullscreen', 'Fullscreen'],
  ];
  const PERMISSION_TEXT = {
    checking: 'checking…',
    asking: 'answer the browser’s prompt…',
    allowed: 'allowed ✓',
    blocked: 'blocked',
    unavailable: 'not available',
    unasked: 'not asked yet',
  };
  const perms = {
    microphone: { state: 'checking', detail: '' },
    speech: Voice.supported() ? { state: 'checking', detail: '' } : { state: 'unavailable', detail: 'use Safari or Chrome' },
    wakeLock: 'wakeLock' in navigator ? { state: 'checking', detail: '' } : { state: 'unavailable', detail: 'the screen may sleep' },
    fullscreen: document.fullscreenEnabled ? { state: 'allowed', detail: '' } : { state: 'unavailable', detail: '' },
  };
  let permRequest = null;

  // requestPermissions asks for the microphone, then speech recognition, and
  // tries the wake lock, updating the list as the answers come in.
  function requestPermissions() {
    permRequest ??= (async () => {
      await askMicrophone();
      if (perms.speech.state !== 'unavailable') {
        if (perms.microphone.state === 'allowed') await askSpeech();
        else setPermission('speech', 'unasked', 'needs the microphone');
      }
      await tryWakeLock();
      permRequest = null;
      renderPermissions();
    })();
    return permRequest;
  }

  async function askMicrophone() {
    setPermission('microphone', 'asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermission('microphone', 'allowed');
    } catch (err) {
      setPermission('microphone', err.name === 'NotAllowedError' ? 'blocked' : 'unavailable', err.message);
    }
  }

  async function askSpeech() {
    setPermission('speech', 'asking');
    try {
      await Voice.warmUp(settings.lang);
      setPermission('speech', 'allowed');
    } catch (err) {
      const refused = err.code === 'not-allowed' || err.code === 'service-not-allowed';
      setPermission('speech', refused ? 'blocked' : 'unavailable', err.message);
    }
  }

  // tryWakeLock takes the wake lock and lets go at once, to learn whether the
  // browser will keep the screen awake during the talk.
  async function tryWakeLock() {
    if (perms.wakeLock.state === 'unavailable') return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      await lock.release();
      setPermission('wakeLock', 'allowed');
    } catch (err) {
      setPermission('wakeLock', 'blocked', err.message);
    }
  }

  function setPermission(name, state, detail = '') {
    perms[name] = { state, detail };
    renderPermissions();
  }

  // needsAsking is true while the microphone or speech recognition has not
  // been answered: Start asks first, so the prompt shows here.
  function needsAsking() {
    return ['microphone', 'speech'].some((name) => ['checking', 'asking', 'unasked'].includes(perms[name].state));
  }

  function renderPermissions() {
    const list = document.createElement('ul');
    const rows = PERMISSIONS.map(([name, label]) => [label, perms[name]]);
    if (settings.voicePrompter) rows.push(['Prompt voice', promptVoice()]);
    if (settings.ear) rows.push(['Talk-in-ear voice', earVoice()]);
    for (const [label, { state, detail }] of rows) {
      const item = document.createElement('li');
      item.className = state;
      item.textContent = `${label}: ${PERMISSION_TEXT[state]}${detail && state !== 'allowed' ? ` (${detail})` : ''}`;
      list.append(item);
    }
    const parts = [list];
    const states = Object.values(perms).map((p) => p.state);
    if (states.includes('blocked')) parts.push(Object.assign(document.createElement('p'), { textContent: 'Blocked? Allow it in the browser’s site settings, then ask again.' }));
    if (!permRequest && (states.includes('blocked') || states.includes('unasked'))) {
      const again = document.createElement('button');
      again.textContent = 'Ask again';
      again.addEventListener('click', requestPermissions);
      parts.push(again);
    }
    ui.permissions.replaceChildren(...parts);
  }

  // Ask straight away, unless the browser already says the microphone is
  // blocked; follow changes made in the browser's site settings meanwhile.
  function checkPermissions() {
    if (!navigator.permissions) return requestPermissions();
    navigator.permissions
      .query({ name: 'microphone' })
      .then((status) => {
        status.addEventListener('change', () => {
          if (status.state === 'denied') setPermission('microphone', 'blocked');
          else if (status.state === 'granted' && perms.microphone.state !== 'allowed') requestPermissions();
        });
        if (status.state !== 'denied') return requestPermissions();
        setPermission('microphone', 'blocked');
        if (perms.speech.state !== 'unavailable') setPermission('speech', 'unasked', 'needs the microphone');
        return tryWakeLock();
      })
      // This browser cannot be asked about the microphone: just ask for it.
      .catch(() => requestPermissions());
  }

  renderPermissions();
  checkPermissions();

  // fillEditor shows the stored settings in the editor's fields.
  function fillEditor() {
    ui.input.value = settings.script;
    for (const key of Object.keys(RANGES)) renderRange(key);
    ui.target.value = settings.target ? Timing.format(settings.target) : '';
    ui.lang.value = settings.lang;
    renderRecall();
    renderVoicePrompter();
    renderEar();
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
    // A finished talk is not resumed: Start begins at the top again.
    const fresh = resume && !resume.endedAt && Date.now() - resume.savedAt < SESSION_FRESH_MS;
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
    // An old or finished session keeps its place but not its timer.
    const fresh = !choice.endedAt && Date.now() - choice.savedAt < SESSION_FRESH_MS;
    enter(fresh ? choice : { ...choice, startedAt: null });
  }

  // start waits for unanswered permissions first, so their prompts show here
  // rather than behind the fullscreen prompter. Sound is unlocked before
  // that wait, while the click or key press still allows it.
  async function start(which) {
    if (settings.voicePrompter && speaker.available()) speaker.unlock();
    if (settings.ear) earSpeaker.unlock();
    if (needsAsking()) await requestPermissions();
    startOffered(which);
  }

  ui.start.addEventListener('click', () => start('primary'));
  ui.restart.addEventListener('click', () => start('secondary'));

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
  let deafSince = -Infinity; // s, when recognition last stopped listening
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

  // Voice prompter: a presenter who stalls hears what comes next
  let voicePrompter = false;
  let ladder = VoicePrompter.create(); // see VoicePrompter.step
  let heardAt = -Infinity; // s, when the presenter was last loud (prompts left out)
  let heardSincePrompt = 0; // s of the presenter's voice since the last prompt
  let announced = false; // "Ready" has been said
  let troubleSaid = false; // "Prompts off" has been said
  let hiddenSaid = false; // "Prompter hidden" has been said
  let hiddenTimer = 0;
  let output = { start: '', now: '' }; // where sound plays, when the browser tells (Chrome)

  // Talk in ear: a voice reads just ahead of the presenter
  let earOn = false;
  let ear = Ear.create(); // see Ear.next

  // Scrolling at the optimal pace, where voice cannot work
  let playing = false;
  let autoF = 0; // fractional word position reached

  // Time
  let timer = { startedAt: null, startWord: 0, endedAt: null }; // speech timer
  let timerConfirm = 0; // when T was first pressed
  let readout = { elapsed: null, left: null, slack: null }; // what the HUD shows
  let hold = Infinity; // pace that ends on target (see holdPace)
  let hudText = '';
  let shownStatus = '';
  let savedWord = -1;
  let paceWord = -1; // word the pace line is under
  let cue = { word: -1, kind: '' }; // the ready / not ready underline
  let engaged = false; // the prompter has picked the presenter up since opening
  let anchor = 0; // word the prompter starts or resumes from; the cue sits on it
  let notices = new Map(); // missing permissions on the banner, by kind
  let noticeTimer = 0;

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
    clearNotices();
    voicePrompter = settings.voicePrompter && speaker.available() && Voice.supported();
    if (settings.voicePrompter && !voicePrompter) {
      const why = !Voice.supported()
        ? 'this browser cannot follow your voice'
        : speaker.state().kind === 'loading'
          ? 'the prompt voice was still loading; leave and start again'
          : speaker.state().detail;
      notify('voice-prompter', `Voice prompter is off: ${why}.`);
    }
    enterEar();
    enterVoicePrompter();
    ui.editor.hidden = true;
    ui.prompter.hidden = false;
    render();
    const word = Scroller.clamp(session?.word ?? 0, 0, spans.length - 1);
    // Resuming picks up at the start of the sentence: that is where a
    // presenter naturally starts again.
    anchor = session ? sentenceStart(word) : word;
    ear = Ear.create(anchor - 1);
    scroll = { position: tops[anchor], target: tops[anchor], max: scroll.max };
    autoF = Pace.indexAt(lines, scroll.target);
    playing = false;
    timer = session?.startedAt
      ? { startedAt: session.startedAt, startWord: session.startWord ?? 0, endedAt: session.endedAt ?? null }
      : { startedAt: null, startWord: word, endedAt: null };
    readout = { elapsed: null, left: null, slack: null };
    savedWord = paceWord = -1;
    cue = { word: -1, kind: '' };
    engaged = false;
    checkMicrophone();
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
    clearNotices();
    cancelAnimationFrame(frameId);
    stopVoice();
    speaker.stop();
    leaveEar();
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
        notify('fullscreen', 'Fullscreen was refused: press F to try again.');
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
      if (voicePrompter) promptStall(now / 1000);
      if (earOn) talkInEar(now / 1000);
    }
    scroll = Scroller.step(scroll, dt);
    ui.text.style.transform = `translateY(${-scroll.position}px)`;
    ui.progress.style.transform = `scaleX(${scroll.max ? scroll.position / scroll.max : 1})`;
    const word = currentWord();
    if (timer.startedAt !== null && timer.endedAt === null && finished()) {
      timer.endedAt = Date.now(); // the timer stops on the last word
      saveSession(resumeWord());
    }
    if (resumeWord() !== savedWord) saveSession(resumeWord());
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

  // sentenceStart is the first word of the sentence word i is in.
  function sentenceStart(i) {
    while (i > 0 && !doc.words[i].sentenceStart) i--;
    return i;
  }

  // resumeWord is where to pick up after a break: the next word after the
  // last one recognized (not the projection, which runs a little ahead).
  function resumeWord() {
    if (voiceFailed) return Math.min(Math.floor(autoF), spans.length - 1);
    return Math.min(follow.cursor + 1, spans.length - 1);
  }

  // currentWord is the word being read: the one being said, or the one the
  // optimal-pace scroll has reached.
  function currentWord() {
    if (voiceFailed) return Math.min(Math.floor(autoF), spans.length);
    return Math.min(Math.floor(spoken ?? follow.cursor + 1), spans.length);
  }

  // finished is true once the presenter has reached the last word.
  // It does not need the very last word recognized: a jump to the closing
  // words has no next word to confirm it, and the last word is often lost as
  // the presenter stops. Reaching the last few words, then quiet, ends it too.
  function finished() {
    if (voiceFailed) return autoF >= spans.length;
    const last = spans.length - 1;
    if (follow.cursor >= last) return true;
    if (follow.pending !== null && follow.pending >= last - END_WORDS) return true;
    if (pace.index === null || follow.cursor < last - END_WORDS) return false;
    const now = performance.now() / 1000;
    return now - pace.at >= END_QUIET && (!meter || Vad.voicedBetween(voicedLog, now - END_QUIET, now) === 0);
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
    const session = { word, startedAt: timer.startedAt, startWord: timer.startWord, endedAt: timer.endedAt, savedAt: Date.now() };
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

  // renderCue marks the word to start (or resume) from each time the
  // prompter opens, until it has picked the presenter up: flashing green when
  // it is ready to follow, steady red while something is not.
  function renderCue() {
    const word = engaged ? -1 : anchor;
    const kind = engaged ? '' : ready() ? 'ready' : 'not-ready';
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

  // notify shows a banner about a missing permission for NOTICE_MS, so it is
  // seen without staying in the way; the status line keeps the detail.
  function notify(kind, text) {
    if (notices.get(kind) === text && !ui.notice.hidden) return;
    notices.set(kind, text);
    ui.notice.textContent = [...notices.values()].join('\n');
    ui.notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(clearNotices, NOTICE_MS);
  }

  function clearNotices() {
    clearTimeout(noticeTimer);
    notices = new Map();
    ui.notice.hidden = true;
  }

  // checkMicrophone reports a microphone that is already blocked as soon as
  // the prompter opens, rather than after the first failed attempt.
  function checkMicrophone() {
    if (!Voice.supported() || !navigator.permissions) return;
    navigator.permissions
      .query({ name: 'microphone' })
      .then((p) => {
        if (active && p.state === 'denied') notify('microphone', MIC_BLOCKED);
      })
      // Browsers that cannot be asked about the microphone: the first attempt
      // to use it reports the problem instead.
      .catch(() => {});
  }

  // ---- HUD ------------------------------------------------------------------

  function renderHud(word) {
    const now = Date.now();
    const elapsedMs = timer.startedAt === null ? 0 : (timer.endedAt ?? now) - timer.startedAt;
    const wordsLeft = spans.length - word;
    const left = voiceFailed
      ? Timing.remainingMs({ wordsLeft, rate: optimalRate() })
      : Timing.remainingMs({ wordsLeft, wordsDone: word - timer.startWord, elapsedMs });
    // The readouts only move one way (see Timing.countDown and friends).
    readout.elapsed = Timing.countUp(readout.elapsed, elapsedMs);
    readout.left = Timing.countDown(readout.left, left);
    let schedule = '';
    if (settings.target && timer.endedAt === null) {
      readout.slack = Timing.steady(readout.slack, Timing.slackMs(settings.target, elapsedMs, left), ON_TIME_MS);
      const slack = readout.slack;
      schedule = Math.abs(slack) < ON_TIME_MS ? 'on time' : slack > 0 ? `${Timing.format(slack)} early` : `${Timing.format(-slack)} over`;
    }
    const clock = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const leftText = timer.endedAt !== null ? Timing.endText(settings.target, elapsedMs) : `−${Timing.format(readout.left)} left`;
    const text = `${clock}|${Timing.format(readout.elapsed)}|${leftText}|${schedule}`;
    if (text === hudText) return;
    hudText = text;
    ui.clock.textContent = clock;
    ui.elapsed.textContent = Timing.format(readout.elapsed);
    ui.left.textContent = schedule ? `${leftText} · ${schedule}` : leftText;
    ui.left.classList.toggle('over', schedule.endsWith('over') || leftText.endsWith('over'));
    // The end card: how the talk went, in the middle of the screen.
    ui.end.hidden = timer.endedAt === null;
    if (timer.endedAt !== null) {
      ui.end.firstChild.textContent = leftText;
      ui.end.classList.toggle('over', leftText.endsWith('over'));
    }
  }

  // restartReadouts lets time left and the schedule move freely once, after
  // something that really changes them; the elapsed timer only on restart.
  function restartReadouts(elapsedToo = false) {
    readout = { elapsed: elapsedToo ? null : readout.elapsed, left: null, slack: null };
  }

  function startTimer() {
    if (timer.startedAt !== null) return;
    timer = { startedAt: Date.now(), startWord: currentWord(), endedAt: null };
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
    timer = { startedAt: now, startWord: currentWord(), endedAt: null };
    paceWord = -1;
    restartReadouts(true);
    saveSession(savedWord);
    renderStatus();
  }

  // ---- Voice ----------------------------------------------------------------

  function startVoice() {
    deafSince = -Infinity;
    follow = { cursor: anchor - 1, pending: null };
    pace = Pace.create();
    spoken = null;
    voiceError = '';
    voiceFailed = !Voice.supported();
    if (voiceFailed) return;
    const v = Voice.create({
      lang: settings.lang,
      normalize: Script.normalize,
      onWords: (heard, fresh) => voice === v && onSpeech(heard, fresh),
      onState: (state, detail, code) => {
        if (voice !== v) return; // a recognizer we already replaced
        const was = listening;
        listening = state === 'listening';
        if (was && !listening) deafSince = performance.now() / 1000;
        if (state === 'error') voiceError = detail;
        // An error that retrying cannot fix: scroll at the optimal pace.
        if (state === 'error' && !v.active()) {
          failVoice();
          notify('microphone', code === 'not-allowed' ? MIC_BLOCKED : `Can’t follow your voice: ${detail}.`);
        }
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
    leaveVoicePrompter('Voice lost. Prompts are off.');
    leaveEar('Voice lost. Talk in ear is off.');
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
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') notify('microphone', MIC_BLOCKED);
      leaveVoicePrompter('No level meter. Prompts are off.');
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
    engaged = true;
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
    if (earOn) earHeard(now);
    renderStatus();
  }

  function meterWorks() {
    if (meter && !meter.running()) {
      meterWarning = 'level meter stopped: pauses may overshoot';
      meter.close();
      meter = null;
      leaveVoicePrompter('Level meter stopped. Prompts are off.');
    }
    return Boolean(meter);
  }

  // listen feeds the voice activity log once per frame. The voice prompter
  // does not count sound while a prompt plays, and shortly after, as the
  // presenter: it may be the prompt. The log keeps it, so a presenter who
  // talks through a prompt is still followed as talking.
  function listen(t, dt) {
    if (!dt || !meterWorks()) return;
    const r = Vad.detect(detector, meter.level(), t, dt);
    detector = r.state;
    loudNow = r.loud;
    Vad.record(voicedLog, t - dt, t, r.voiced);
    if (r.voiced) speechClock += dt;
    const w = speaker.window();
    if (t >= w.start && t <= w.end + ECHO) return;
    if (r.voiced) heardSincePrompt += dt;
    if (r.loud) heardAt = t;
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
    // After a moment of silence the mark settles on the next word to say, the
    // one after the last recognized: the small look forward taken while
    // talking may have gone one too far.
    const settled = meter && pace.index !== null && Vad.voicedBetween(voicedLog, t - SETTLE, t) === 0;
    const target = settled ? Math.min(pace.index + 1, spans.length - 1) : Pace.highlightWord(pace, spoken, spans.length, hold, talking);
    if (settled && highlighted > target) {
      highlightedAt = t;
      return highlight(target);
    }
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
    anchor = wordAt(scroll.target);
    follow = { cursor: anchor - 1, pending: null };
    revealedUpTo = Math.max(revealedUpTo, follow.cursor); // moved past: not attempted
    pace = Pace.create(pace.rate, pace.latency);
    spoken = null;
    highlight(-1);
    voice.reset();
    ladder = VoicePrompter.create(); // a new place: prompts start over there
    if (earOn) earJump(anchor);
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

  // hintNext helps a presenter who is stuck (R). With the voice prompter it
  // says the next words; with recall practice it reveals the next hidden
  // word from the highlight on. A hint is not a recall: it shows uncoloured.
  function hintNext() {
    if (voicePrompter) promptNow();
    if (earOn) earRepeat();
    if (!settings.recall) return;
    const from = voiceFailed ? currentWord() : Math.max(highlighted, follow.cursor + 1);
    const i = spans.findIndex((s, k) => k >= from && s.classList.contains('recall'));
    if (i === -1) {
      if (!voicePrompter) flash('no hidden words ahead');
      return;
    }
    show(i, 'hinted');
  }

  function show(i, kind) {
    spans[i]?.classList.replace('recall', kind);
  }

  // ---- Voice prompter -------------------------------------------------------

  // enterVoicePrompter sets the voice prompter up as the prompter opens.
  function enterVoicePrompter() {
    ladder = VoicePrompter.create();
    heardAt = -Infinity;
    heardSincePrompt = 0;
    announced = false;
    troubleSaid = false;
    hiddenSaid = false;
    output = { start: '', now: '' };
    if (voicePrompter) watchOutput();
  }

  // leaveVoicePrompter stops prompting when it cannot work, and says why out
  // loud: the presenter may not be looking at the screen.
  function leaveVoicePrompter(why) {
    if (!voicePrompter) return;
    voicePrompter = false;
    speaker.say(why);
    notify('voice-prompter', why);
  }

  // promptStall prompts a presenter who has gone quiet (see
  // VoicePrompter.step), and says what they would otherwise only see on
  // screen: ready, prompts off.
  function promptStall(t) {
    if (!announced && ready() && meter) {
      announced = true;
      speaker.say('Ready');
    }
    announceTrouble(t);
    const r = VoicePrompter.step(ladder, {
      next: promptable(t) ? resumeWord() : null,
      now: t,
      quietSince: Math.max(heardAt, speaker.window().end + ECHO),
      spoke: heardSincePrompt >= SPOKE,
      words: doc.words,
      after: settings.promptAfter,
    });
    ladder = r.state;
    if (r.say) prompt(r.say);
  }

  // promptable is whether a stall can be prompted now: the talk is under way
  // and followed, the level meter can tell silence, the place is known and
  // the sound still plays where it did. Near the end it stays quiet: the
  // last words are often not recognized, and a prompt would go into the
  // applause.
  function promptable(t) {
    if (!engaged || !hearing(t) || !meterWorks() || finished() || speaker.speaking()) return false;
    if (follow.cursor >= spans.length - 1 - END_WORDS) return false;
    return !soundMoved() && !lost(t);
  }

  // hearing is whether recognition runs, through the restarts it makes on
  // its own in a silence: a gap shorter than RESTART_GAP does not count, or
  // the long wait before a paragraph would never be reached. A recoverable
  // error does not stop prompts: where the presenter is stays known. Paused
  // with Space, it is not hearing.
  function hearing(t) {
    return voice.active() && (listening || t - deafSince < RESTART_GAP);
  }

  // lost is true once the presenter has talked LOST seconds since the last
  // match: an ad-lib, a long skip, or recognition stalled without an error.
  // A prompt then could be a word from minutes ago; silence is better.
  function lost(t) {
    return pace.index !== null && Vad.voicedBetween(voicedLog, pace.at, t) > LOST;
  }

  // announceTrouble says when recognition has been down OFF_AFTER seconds
  // (not when paused with Space), and when it is back. Recognition that
  // fails and restarts quickly over and over never adds up to that; prompts
  // then still come at the known place.
  function announceTrouble(t) {
    const watching = engaged && !finished() && voice.active();
    if (!watching) troubleSaid = false;
    else if (!listening && t - deafSince >= OFF_AFTER) {
      if (!troubleSaid) speaker.say('Prompts off');
      troubleSaid = true;
    } else if (listening && troubleSaid) {
      troubleSaid = false;
      speaker.say('Prompts on');
    }
  }

  // prompt says words [from, to].
  function prompt(range) {
    speaker.say(VoicePrompter.text(doc.words, range));
    heardSincePrompt = 0;
  }

  // promptNow says the cue on request (R). Before the talk it says the
  // words to start from, which also tests where the sound plays in the room,
  // even where prompts are paused because the sound moved. If the presenter
  // stays quiet, the phrase follows as after a stall.
  function promptNow() {
    const i = engaged ? resumeWord() : anchor;
    prompt(VoicePrompter.cue(doc.words, i));
    ladder = { ...ladder, word: i, level: 1 };
  }

  // soundMoved is true when sound no longer plays on the device it played
  // on when the talk started (HDMI plugged in, earphones out): prompts
  // pause rather than play to the hall, and resume when it moves back.
  function soundMoved() {
    return Boolean(output.start) && output.now !== output.start;
  }

  // watchOutput reads where sound plays, where the browser tells. The first
  // device it names is where prompts belong.
  function watchOutput() {
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const label = devices.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default')?.label ?? '';
        output = { start: output.start || label, now: label };
        if (soundMoved()) notify('output', `Sound moved to ${label || 'another device'}: prompts paused until it is back on ${output.start}.`);
        renderStatus();
      })
      .catch((err) => console.error('voice prompter: cannot tell where sound plays', err));
  }

  navigator.mediaDevices?.addEventListener('devicechange', () => {
    if (active && voicePrompter) watchOutput();
  });

  // ---- Talk in ear ----------------------------------------------------------

  // enterEar sets talk in ear up as the prompter opens. When the voice
  // prompter is on too, talk in ear wins: two voices in one ear.
  function enterEar() {
    earOn = settings.ear && earSpeaker.available() && Voice.supported();
    if (settings.ear && !earOn) {
      const why = !Voice.supported()
        ? 'this browser cannot follow your voice'
        : earSpeaker.state().kind === 'loading'
          ? 'the voice was still loading; leave and start again'
          : earSpeaker.state().detail;
      notify('ear', `Talk in ear is off: ${why}.`);
    }
    if (earOn && voicePrompter) {
      voicePrompter = false;
      notify('voice-prompter', 'Voice prompter is off: talk in ear is on.');
    }
  }

  // leaveEar stops the voice. Given a reason, talk in ear is off for the
  // rest of the talk, and says why out loud: the presenter may not be
  // looking at the screen. With talk in ear off it does nothing: stopping
  // cancels all speech, the voice prompter's warnings too.
  function leaveEar(why = '') {
    if (!earOn) return;
    earHalt();
    if (!why) return;
    earOn = false;
    earSpeaker.say(why, 1, { began() {}, ended() {}, halted() {}, failed: (err) => console.error(`talk in ear: ${err}`) });
    notify('ear', why);
  }

  // earHalt stops the voice at once; the words it was saying are said again
  // when it goes on.
  function earHalt() {
    earSpeaker.stop();
    ear = Ear.halt(ear);
  }

  // talkInEar reads the next words when there is room ahead of the presenter
  // (see Ear.next), at their pace, held to the target. It reads only while
  // recognition listens: unfollowed, the voice could not wait for them.
  function talkInEar(t) {
    const r = Ear.check(ear, t);
    ear = r.state;
    if (r.echo) return leaveEar('I can hear myself. Talk in ear is off.');
    if (finished()) {
      if (ear.saying) earHalt();
      return;
    }
    const presenter = earPresenter();
    const saying = ear.saying;
    ear = Ear.overtake(ear, presenter, t);
    if (saying && !ear.saying) earSpeaker.stop(); // they passed it: what it says is behind them
    if (!voice.active() || !listening) return;
    const say = Ear.next(ear, {
      presenter,
      pace: pace.index === null ? optimalRate() : Pace.pace(pace, hold),
      lead: settings.earLead,
      words: doc.words,
    });
    if (!say) return;
    ear = Ear.started(ear, say, t);
    earSpeaker.say(Ear.text(doc.words, say.from, say.to), say.rate, {
      began: (start) => {
        ear = Ear.began(ear, start);
      },
      ended: (start, end) => {
        ear = Ear.ended(ear, start, end);
      },
      // Interrupted by something else (an audio device change): said again.
      halted: () => {
        ear = Ear.halt(ear);
      },
      failed: (why) => leaveEar(`The voice failed: ${why}. Talk in ear is off.`),
    });
  }

  // earPresenter is the word the presenter is on: the highlight, which
  // allows for recognition running behind them. Without a level meter the
  // highlight stays ahead in a pause, so it is the word after the last one
  // recognized. Before they are picked up, the word to start from.
  function earPresenter() {
    if (!engaged) return anchor;
    const next = follow.cursor + 1;
    return meter ? Math.max(highlighted, next) : next;
  }

  // earHeard checks each move of the follower for the voice hearing itself
  // (see Ear.heard). A probe holds the voice still, so the words playing
  // stop.
  function earHeard(now) {
    const probing = ear.probe;
    ear = Ear.heard(ear, follow.cursor, now, pace.latency);
    if (!probing && ear.probe) earSpeaker.stop();
    renderStatus();
  }

  // earJump moves the voice to word after a manual jump.
  function earJump(word) {
    earSpeaker.stop();
    ear = Ear.jump(ear, word);
  }

  // earRepeat reads again from where the presenter is (R): the opening
  // missed while walking on stage, or the words they lost.
  function earRepeat() {
    earJump(earPresenter());
  }

  // earAhead is how many words the voice has read past the presenter.
  function earAhead() {
    return Math.max(0, ear.said + 1 - earPresenter());
  }

  // Hidden, the loop stops but an utterance would play on: stop it. It is
  // said again on return.
  document.addEventListener('visibilitychange', () => {
    if (active && earOn && document.visibilityState === 'hidden') earHalt();
  });

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
      if (playing) engaged = true;
      if (playing) startTimer();
      return renderStatus();
    }
    if (voice.active()) {
      voice.stop();
      if (earOn) earHalt(); // paused: the voice stops at once, not on the next frame
    } else {
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
    if (voiceFailed) return `${playing}|${Math.round(optimalRate() * 60)}`;
    return `${hold < pace.rate}|${voicePrompter}|${voicePrompter && lost(performance.now() / 1000)}|${earOn && `${earAhead()}${Boolean(ear.probe)}`}`;
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
    if (voicePrompter) {
      let about = `voice prompter · prompts after ${settings.promptAfter} s · R says the next words`;
      about += output.now ? ` · sound on ${output.now}` : ' · sound device not watched';
      if (soundMoved()) about += ' · paused: sound moved';
      else if (lost(performance.now() / 1000)) about += ' · lost: prompts wait for your place';
      text = `${about} · ${text}`;
    }
    if (earOn) {
      const about = ear.probe ? 'checking it does not hear itself' : `${earAhead()} of ${settings.earLead} words ahead`;
      text = `talk in ear · ${about} · R reads again · ${text}`;
    }
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
        start('primary');
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
      notify('wake', 'The screen may sleep: the browser would not keep it awake.');
    }
    renderStatus();
  }

  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    const visible = document.visibilityState === 'visible';
    if (visible && !wakeLock) lockScreen();
    // Hidden, the browser stops the loop: on return the first frame must not
    // count the time away as one step, nor the voice prompter take it for a
    // stall.
    if (visible) {
      lastFrame = 0;
      ladder = { ...ladder, armed: false };
    }
    if (!voicePrompter) return;
    // Safari hides the page for a moment while it goes fullscreen: only a
    // page that stays hidden is said to be.
    clearTimeout(hiddenTimer);
    if (!visible) {
      hiddenTimer = setTimeout(() => {
        if (document.visibilityState !== 'hidden') return;
        hiddenSaid = true;
        speaker.say('Prompter hidden. Prompts are off.');
      }, HIDDEN_FOR * 1000);
    } else if (hiddenSaid) {
      hiddenSaid = false;
      speaker.say('Prompts on');
    }
  });
})();

'use strict';

const $ = id => document.getElementById(id);
let docKeyWanted = false; // Doc Louis's: a WAD was just chosen, so show the key step even if one is unpacked
const api = window.launcher;
let current = null;
let page = 'play';
let logOpen = false;

// ---- pages ----
const pageOrder = ['play', 'archipelago', 'controls', 'settings', 'credits'];
function showPage(name) {
  const changed = page !== name;
  page = name;
  for (const p of pageOrder) {
    $(`page-${p}`).classList.toggle('active', p === name);
    $(`nav-${p}`).classList.toggle('active', p === name);
  }
  // The game writes settings too (F10): show the file's current values whenever these pages are opened.
  if (changed && (name === 'settings' || name === 'controls')) sync();
}
function stepPage(delta) {
  const i = pageOrder.indexOf(page);
  showPage(pageOrder[(i + delta + pageOrder.length) % pageOrder.length]);
}
for (const p of pageOrder) $(`nav-${p}`).addEventListener('click', () => showPage(p));

// Lights up the button whose data-value matches in a .segmented[data-setting] group.
function setSegmented(setting, value) {
  const group = document.querySelector(`.segmented[data-setting="${setting}"]`);
  for (const b of group.querySelectorAll('.seg')) b.classList.toggle('active', b.dataset.value === value);
}

// ---- errors / status ----
function setStatus(text) { $('status').textContent = text; }
function showError(err) {
  const message = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  setStatus(message);
  appendLog(`! ${message}`);
}
async function guarded(fn) {
  try { await fn(); } catch (err) { showError(err); } finally { await sync(); }
}

// ---- log ----
function appendLog(line) {
  const log = $('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  log.textContent += line + '\n';
  if (log.textContent.length > 400000) log.textContent = log.textContent.slice(-300000);
  if (atBottom) log.scrollTop = log.scrollHeight;
}
function setLogOpen(open) {
  logOpen = open;
  $('log-drawer').hidden = !open;
  if (open) $('log').scrollTop = $('log').scrollHeight;
}
$('toggle-log').addEventListener('click', () => setLogOpen(!logOpen));
$('log-close').addEventListener('click', () => setLogOpen(false));
$('show-log').addEventListener('click', () => setLogOpen(true));
$('log-copy').addEventListener('click', () => api.copyLog().then(() => setStatus('Log copied')));
$('copy-log').addEventListener('click', () => api.copyLog().then(() => setStatus('Log copied')));

// ---- task progress ----
function renderTask(task) {
  $('progress').hidden = !task;
  if (!task) return;
  $('progress-title').textContent = task.label;
  $('progress-detail').textContent = task.detail || '';
  const fill = $('progress-fill');
  const known = typeof task.percent === 'number';
  fill.classList.toggle('indeterminate', !known);
  fill.style.width = known ? `${Math.max(2, Math.min(100, task.percent))}%` : '';
  setStatus(task.detail ? `${task.label}: ${task.detail}` : task.label);
}

// ---- main render ----
function renderSetup(s) {
  const steps = [1, 2, 3];
  for (const n of steps) {
    const el = $(`step-${n}`);
    const done = s.step === 0 || n < s.step;
    el.classList.toggle('done', done);
    el.classList.toggle('current', n === s.step);
  }
  // Tools.
  const list = $('tool-list');
  list.replaceChildren(...s.tools.results.map(t => {
    const li = document.createElement('li');
    li.textContent = t.ok ? `✓ ${s.tools.managed ? t.need : t.name}` : `✗ ${t.need}`;
    li.classList.toggle('missing', !t.ok);
    return li;
  }));
  $('step-1-state').textContent = s.tools.ok ? 'All found' : `${s.tools.missing.length} missing`;
  $('tool-hint').hidden = !s.tools.hint;
  $('tool-managed').hidden = !s.tools.managed || s.tools.ok;
  // The Steam Deck launcher's tools come with it (the text and button otherwise describe Windows' downloads).
  if (s.tools.managedText) $('tool-managed').textContent = s.tools.managedText;
  if (s.tools.installLabel) $('install-tools').textContent = s.tools.installLabel;
  $('install-tools').hidden = !s.tools.managed || s.tools.ok;
  $('install-tools').disabled = s.busy || s.running;
  $('copy-tool-command').hidden = !s.tools.hint;
  $('tool-command').textContent = s.tools.hint || '';
  // The game's copy: Punch-Out!!'s disc, or Doc Louis's WAD.
  const doc = s.game === 'doclouis';
  $('copy-punchout').hidden = doc;
  $('copy-doclouis').hidden = !doc;
  $('step-2').querySelector('.step-title').textContent = doc ? 'Your copy' : 'Your disc';
  $('build-note').textContent = doc
    ? "Builds the game from your unpacked WAD. The first build takes a while; later ones are quicker."
    : 'Extracts your disc and builds the game. The first build takes a while; later ones are quicker.';
  if (doc) {
    $('doc-path').textContent = s.docWad || (s.extracted ? 'Already unpacked' : 'No WAD chosen');
    $('step-2-state').textContent = s.extracted ? 'Unpacked' : s.docWad ? 'Needs the key' : '';
    // The key is only asked for while the WAD still needs unpacking (choosing the WAD again shows it again).
    $('doc-key').hidden = !s.docWad || (s.extracted && !docKeyWanted);
    for (const id of ['doc-keyfile', 'doc-unpack', 'choose-doc-wad']) $(id).disabled = s.busy || s.running;
  } else {
    $('disc-path').textContent = s.disc || (s.extracted ? 'Already extracted' : 'No disc chosen');
    $('step-2-state').textContent = s.extracted ? 'Extracted' : s.disc ? 'Chosen' : '';
  }
  // Game tiles.
  for (const id of ['punchout', 'doclouis']) {
    const tile = $(`game-${id}`);
    tile.classList.toggle('selected', s.game === id);
    tile.disabled = s.busy || s.running;
  }
  // Build.
  $('step-3-state').textContent = s.build.built ? (s.build.outdated ? 'Update available' : 'Built') : '';
  $('build').textContent = s.build.built ? 'Rebuild' : 'Build';
  $('build').disabled = s.busy || s.running;
  $('setup').hidden = s.step === 0 && !s.build.outdated;
  $('setup-title').textContent = s.build.outdated ? 'An update to the port is ready' : 'Set up POW: Recompiled!!';
  if (s.build.outdated) { $('step-3').classList.add('current'); $('step-3').classList.remove('done'); }
}

function renderLaunch(s) {
  const ready = s.step === 0;
  $('play').disabled = !ready || s.busy || s.running;
  $('play').textContent = s.running ? 'Playing' : 'Play';
  const name = s.games?.[s.game]?.name || 'POW: Recompiled!!';
  $('launch-title').textContent = s.running ? `${name} is running` : ready ? `Ready to play ${name}` : 'Not ready yet';
  $('launch-detail').textContent = s.running ? 'Close the game to come back here.'
    : ready ? (s.build.at ? `Built ${new Date(s.build.at).toLocaleString()}` : '') : 'Finish the setup above.';
  const ap = s.settings.archipelago;
  $('ap-badge').hidden = !ap.enabled || s.game !== 'punchout'; // Archipelago is Punch-Out!!'s only
  $('ap-badge').classList.toggle('connected', Boolean(ap.connected));
  $('ap-badge-text').textContent = ap.connected ? `Archipelago: connected as ${ap.slot}` : `Archipelago: ${ap.slot || 'on'} (connects in the game)`;
  $('stop').hidden = !(s.busy || s.running);
}

let apDirty = false;
function renderArchipelago(s) {
  const ap = s.settings.archipelago;
  const label = $('ap-toggle-label');
  label.classList.toggle('enabled', Boolean(ap.enabled));
  label.classList.toggle('connected', Boolean(ap.enabled && ap.connected));
  $('ap-status').textContent = !ap.enabled ? 'Off' : ap.connected ? `Connected as ${ap.slot}` : s.running ? 'Connecting… (see the game)' : 'On: connects when the game starts';
  if (apDirty) return; // don't overwrite what's being typed
  $('ap-enabled').checked = Boolean(ap.enabled);
  $('ap-server').value = ap.server || '';
  $('ap-slot').value = ap.slot || '';
  $('ap-password').value = ap.password || '';
  $('ap-show-log').checked = ap.showLog !== false;
  $('ap-patch-file').textContent = ap.patchFile || 'None';
}

function renderSettings(s) {
  const set = s.settings;
  const locked = Boolean(set.archipelago.enabled);
  $('difficulty-locked').hidden = !locked;
  $('difficulty-choices').classList.toggle('locked', locked);
  for (const input of document.querySelectorAll('input[name="difficulty"]')) {
    input.checked = (locked ? 'normal' : set.difficulty) === input.value;
    input.disabled = locked;
  }
  $('skip-strap').checked = set.skipStrapScreen !== false;
  const g = set.graphics;
  setSegmented('widescreen', String(g.widescreen));
  setSegmented('resolution', String(g.resolution));
  setSegmented('displayMode', g.displayMode);
  $('force-aspect').checked = g.forceAspect;
  $('native-effects').checked = g.nativeEffects;
  $('graphics-note').textContent = s.running
    ? 'The game is running, so changes here apply the next time it starts. To change them now, press F10 in the game.'
    : "Auto renders at the window's size. Native is the Wii's resolution; higher multiples look sharper but need a stronger graphics card. Aspect ratio changes apply the next time the game starts.";
  $('data-root').textContent = s.dataRoot;
  $('port-source').textContent = s.portSource || 'Not found';
  $('rebuild').disabled = s.busy || s.running || s.step === 1;
}

// Controls: Config.toml [punchout_controls] (the game's punchout_controls.cpp). Each row: two keyboard boxes and two
// controller boxes; the stored values are SDL names, shown with the chosen style's glyphs.
const CONTROL_ROWS = [
  { id: 'up', wii: 'Up', fight: 'Block; with a punch: punch to the face' },
  { id: 'down', wii: 'Down', fight: 'Duck' },
  { id: 'left', wii: 'Left', fight: 'Dodge left' },
  { id: 'right', wii: 'Right', fight: 'Dodge right' },
  { id: 'one', wii: '1', fight: 'Left punch' },
  { id: 'two', wii: '2', fight: 'Right punch' },
  { id: 'a', wii: 'A', fight: 'Star punch' },
  { id: 'b', wii: 'B', fight: "The remote's B" },
  { id: 'plus', wii: '+', fight: 'Pause' },
  { id: 'minus', wii: '−', fight: "The remote's −" },
  { id: 'page_left', wii: '', fight: 'Menus: previous page' },
  { id: 'page_right', wii: '', fight: 'Menus: next page' }
];
// SDL gamepad name → glyph file (or null) and the label per style [Xbox, PlayStation].
const PAD_INFO = {
  a: ['south', 'A', 'Cross'], b: ['east', 'B', 'Circle'], x: ['west', 'X', 'Square'], y: ['north', 'Y', 'Triangle'],
  back: ['back', 'View', 'Share'], start: ['start', 'Menu', 'Options'], guide: ['guide', 'Guide', 'PS'],
  leftstick: ['leftstick', 'LS', 'L3'], rightstick: ['rightstick', 'RS', 'R3'],
  leftshoulder: ['leftshoulder', 'LB', 'L1'], rightshoulder: ['rightshoulder', 'RB', 'R1'],
  lefttrigger: ['lefttrigger', 'LT', 'L2'], righttrigger: ['righttrigger', 'RT', 'R2'],
  dpup: ['dpad_up', 'D-pad up', 'D-pad up'], dpdown: ['dpad_down', 'D-pad down', 'D-pad down'],
  dpleft: ['dpad_left', 'D-pad left', 'D-pad left'], dpright: ['dpad_right', 'D-pad right', 'D-pad right'],
  touchpad: [null, 'Touchpad', 'Touchpad'], misc1: [null, 'Share', 'Mic']
};
// Standard Gamepad API button index → SDL gamepad name.
const PAD_FROM_INDEX = ['a', 'b', 'x', 'y', 'leftshoulder', 'rightshoulder', 'lefttrigger', 'righttrigger', 'back', 'start',
  'leftstick', 'rightstick', 'dpup', 'dpdown', 'dpleft', 'dpright', 'guide', 'touchpad'];
const KEY_LABELS = { Return: 'Enter', 'Left Shift': 'L Shift', 'Right Shift': 'R Shift', 'Left Ctrl': 'L Ctrl', 'Right Ctrl': 'R Ctrl',
  'Left Alt': 'L Alt', 'Right Alt': 'R Alt', 'Left GUI': 'L Super', 'Right GUI': 'R Super', Up: '↑', Down: '↓', Left: '←', Right: '→' };
const MOUSE_NAMES = ['Mouse Left', 'Mouse Middle', 'Mouse Right', 'Mouse Side 1', 'Mouse Side 2']; // event.button 0..4
// KeyboardEvent.code → SDL key name (SDL_GetScancodeName).
function sdlKeyName(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `Keypad ${m[1]}`;
  if ((m = /^F(\d{1,2})$/.exec(code))) return code === 'F10' ? null : code;
  const named = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space', Enter: 'Return',
    Backspace: 'Backspace', Tab: 'Tab', CapsLock: 'CapsLock', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left GUI',
    MetaRight: 'Right GUI', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/', Insert: 'Insert', Delete: 'Delete', Home: 'Home',
    End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', NumpadAdd: 'Keypad +', NumpadSubtract: 'Keypad -',
    NumpadMultiply: 'Keypad *', NumpadDivide: 'Keypad /', NumpadEnter: 'Keypad Enter', NumpadDecimal: 'Keypad .'
  };
  return named[code] || null;
}

function bindingBox(row, slot, value, style) {
  const box = document.createElement('button');
  box.className = 'bind' + (value ? '' : ' empty');
  const isPad = slot >= 2;
  if (!value) {
    box.textContent = '—';
  } else if (isPad) {
    const info = PAD_INFO[value.toLowerCase()];
    if (info?.[0]) {
      const img = document.createElement('img');
      img.src = `assets/glyphs/${style === 'playstation' ? 'playstation' : 'xbox'}/${info[0]}.png`;
      img.alt = info[style === 'playstation' ? 2 : 1];
      box.append(img);
    } else {
      box.textContent = info ? info[style === 'playstation' ? 2 : 1] : value;
    }
  } else {
    box.textContent = KEY_LABELS[value] || value;
  }
  box.title = `${row.fight}: ${isPad ? 'controller' : 'keyboard'} (click to change)`;
  box.addEventListener('click', () => startCapture(row, slot));
  return box;
}

// Player 1's controller ([controller] player1 in the game's Config.toml). Chromium lists a controller only after one
// of its buttons is pressed; on Linux its id ends in "(… Vendor: 28de Product: 1303)", which the game matches exactly.
const PLAYER1_FIXED = [
  ['auto', 'Automatic (the one you use)'],
  ['external', "Any controller but the Steam Deck's own"],
  ['28de:1205', "Steam Deck's own controls"]
];
function gamepadChoice(pad) {
  const m = /Vendor: ([0-9a-f]{4}) Product: ([0-9a-f]{4})/i.exec(pad.id);
  const name = pad.id.replace(/\s*\(.*\)\s*$/, '').trim() || pad.id;
  return [m ? `${m[1].toLowerCase()}:${m[2].toLowerCase()}` : name, name];
}
let player1Seen = new Map();
function renderPlayer1(s) {
  const select = $('player1-controller');
  const saved = s.settings.player1Controller || 'auto';
  for (const pad of navigator.getGamepads?.() || []) {
    if (!pad) continue;
    const [value, name] = gamepadChoice(pad);
    if (!PLAYER1_FIXED.some(([v]) => v === value)) player1Seen.set(value, name);
  }
  const choices = [...PLAYER1_FIXED, ...player1Seen];
  if (!choices.some(([v]) => v === saved)) choices.push([saved, saved]);
  const key = choices.map(c => c.join('=')).join('|');
  if (select.dataset.key !== key) {
    select.replaceChildren(...choices.map(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      return o;
    }));
    select.dataset.key = key;
  }
  if (document.activeElement !== select) select.value = saved;
  $('player1-note').textContent = (saved === 'auto'
    ? 'Player 1 is the controller you pick up: after a few seconds without input, another controller you use takes over.'
    : 'Player 1 always uses this controller while it is connected; if it isn\'t, the game picks automatically.') +
    ' Press a button on a controller to add it to the list.';
}
$('player1-controller').addEventListener('change', () =>
  guarded(() => api.saveSettings({ player1Controller: $('player1-controller').value })));
window.addEventListener('gamepadconnected', () => { if (current) renderPlayer1(current); });

function renderControls(s) {
  const style = s.settings.buttonStyle || 'auto';
  setSegmented('buttonStyle', style);
  $('style-note').textContent = (style === 'auto' ? 'In the game, button prompts follow the controller you have plugged in'
    : `In the game, button prompts always use ${style === 'xbox' ? 'Xbox' : 'PlayStation'} buttons`) +
    ' and show the buttons you set below. While you play with the keyboard, they show your keys instead.';
  renderPlayer1(s);
  const controls = s.settings.controls;
  $('lock-mouse').checked = controls.lockMouse;
  $('controls-note').textContent = s.running ? 'The game reads these when it starts; while it runs, change them with F10 → Controller settings.' : '';
  if (capture) return; // don't rebuild the table under an open capture
  $('controls-body').replaceChildren(...CONTROL_ROWS.map(row => {
    const values = controls.bindings[row.id];
    const tr = document.createElement('tr');
    const f = document.createElement('td');
    f.textContent = row.fight;
    const w = document.createElement('td');
    w.className = 'wii';
    w.textContent = row.wii;
    const k = document.createElement('td');
    const p = document.createElement('td');
    k.className = p.className = 'binds';
    k.append(bindingBox(row, 0, values[0], style), bindingBox(row, 1, values[1], style));
    p.append(bindingBox(row, 2, values[2], style), bindingBox(row, 3, values[3], style));
    tr.append(f, w, k, p);
    return tr;
  }));
}

// Capturing a new binding: keyboard boxes take a key or a mouse button, controller boxes a controller button.
let capture = null;
function startCapture(row, slot) {
  const isPad = slot >= 2;
  capture = { row, slot, isPad, held: null, frame: 0 };
  $('capture-title').textContent = `${row.fight} (${isPad ? 'controller' : 'keyboard'}${slot % 2 ? ', second box' : ''})`;
  $('capture-hint').textContent = isPad ? 'Press a button on your controller, or pull a trigger.'
    : 'Press a key or click a mouse button here. Escape and F10 are kept for the game.';
  $('capture').hidden = false;
  $('capture-cancel').focus();
  if (isPad) capture.frame = requestAnimationFrame(pollCapturePad);
}
function endCapture(value) {
  if (!capture) return;
  const { row, slot, frame } = capture;
  cancelAnimationFrame(frame);
  capture = null;
  $('capture').hidden = true;
  if (value !== undefined) guarded(() => api.saveSettings({ controls: { binding: { control: row.id, slot, value } } }));
  else if (current) renderControls(current);
}
function pressedIndices() {
  const out = new Set();
  for (const gp of navigator.getGamepads?.() || []) {
    if (!gp?.connected || gp.mapping !== 'standard') continue;
    gp.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) out.add(i); });
  }
  return out;
}
function pollCapturePad() {
  if (!capture?.isPad) return;
  const now = pressedIndices();
  if (capture.held === null) capture.held = now; // anything held at the start must be let go first
  for (const i of now) {
    if (!capture.held.has(i) && PAD_FROM_INDEX[i]) { endCapture(PAD_FROM_INDEX[i]); return; }
  }
  for (const i of [...capture.held]) if (!now.has(i)) capture.held.delete(i);
  capture.frame = requestAnimationFrame(pollCapturePad);
}
window.addEventListener('keydown', event => {
  if (!capture) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.code === 'Escape') { endCapture(); return; }
  if (capture.isPad) return;
  const name = sdlKeyName(event.code);
  if (name) endCapture(name);
}, true);
$('capture').addEventListener('mousedown', event => {
  if (!capture || capture.isPad || event.target.closest('button')) return;
  event.preventDefault();
  if (MOUSE_NAMES[event.button]) endCapture(MOUSE_NAMES[event.button]);
});
$('capture').addEventListener('contextmenu', event => event.preventDefault());
$('capture-clear').addEventListener('click', () => endCapture(''));
$('capture-cancel').addEventListener('click', () => endCapture());
$('lock-mouse').addEventListener('change', () => guarded(() => api.saveSettings({ controls: { lockMouse: $('lock-mouse').checked } })));
$('controls-reset').addEventListener('click', () => guarded(() => api.saveSettings({ controls: { reset: true } })));

function render(s) {
  current = s;
  renderSetup(s);
  renderLaunch(s);
  renderArchipelago(s);
  renderSettings(s);
  renderControls(s);
  renderTask(s.task);
  $('version').textContent = s.steamDeck ? `v${s.version} · Steam Deck` : `v${s.version}`;
  if (!s.task && !s.busy) setStatus(s.running ? 'Playing' : s.step === 0 ? 'Ready' : 'Setup needed');
}
async function sync() {
  try { render(await api.state()); } catch (err) { setStatus(String(err?.message || err)); }
}

// ---- actions ----
$('recheck-tools').addEventListener('click', () => guarded(async () => render(await api.checkTools())));
$('install-tools').addEventListener('click', () => guarded(async () => { await api.installTools(); render(await api.checkTools()); }));
$('copy-tool-command').addEventListener('click', () => api.copyText($('tool-command').textContent).then(() => setStatus('Command copied')));
$('choose-disc').addEventListener('click', () => guarded(async () => {
  $('disc-error').hidden = true;
  const r = await api.chooseDisc();
  if (r && !r.ok && !r.canceled) { $('disc-error').textContent = r.problem; $('disc-error').hidden = false; }
}));
$('choose-disc-folder').addEventListener('click', () => guarded(async () => {
  $('disc-error').hidden = true;
  const r = await api.chooseDiscFolder();
  if (r && !r.ok && !r.canceled) { $('disc-error').textContent = r.problem; $('disc-error').hidden = false; }
}));
for (const id of ['punchout', 'doclouis']) {
  $(`game-${id}`).addEventListener('click', () => guarded(async () => { $('disc-error').hidden = true; render(await api.selectGame(id)); }));
}
// Doc Louis's: the WAD, then the key to unpack it (the pasted key is cleared from the box straight away).
const docProblem = res => { if (res && !res.ok && !res.canceled) { $('disc-error').textContent = res.problem; $('disc-error').hidden = false; } };
$('choose-doc-wad').addEventListener('click', () => guarded(async () => {
  $('disc-error').hidden = true;
  const res = await api.chooseDocWad();
  if (res && res.ok) docKeyWanted = true;
  docProblem(res);
}));
$('doc-keyfile').addEventListener('click', () => guarded(async () => {
  $('disc-error').hidden = true;
  const res = await api.unpackDocKeyFile();
  if (res && res.ok) docKeyWanted = false;
  docProblem(res);
}));
const unpackPasted = () => guarded(async () => {
  $('disc-error').hidden = true;
  const input = $('doc-key-input');
  const text = input.value;
  input.value = '';
  const res = await api.unpackDocKey(text);
  if (res && res.ok) docKeyWanted = false;
  docProblem(res);
});
$('doc-unpack').addEventListener('click', unpackPasted);
$('doc-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') unpackPasted(); });
$('build').addEventListener('click', () => guarded(() => api.build()));
$('rebuild').addEventListener('click', () => guarded(async () => { showPage('play'); await api.build(); }));
$('play').addEventListener('click', () => guarded(() => api.play()));
$('stop').addEventListener('click', () => api.stop());
$('open-port').addEventListener('click', () => api.openFolder('port'));
$('open-logs').addEventListener('click', () => api.openFolder('logs'));
$('choose-data-root').addEventListener('click', () => guarded(() => api.chooseFolder('dataRoot')));
$('choose-port-source').addEventListener('click', () => guarded(() => api.chooseFolder('portSource')));
for (const a of document.querySelectorAll('a[data-url]')) {
  a.addEventListener('click', event => { event.preventDefault(); api.openExternal(a.dataset.url); });
}

// Archipelago.
for (const id of ['ap-server', 'ap-slot', 'ap-password']) $(id).addEventListener('input', () => { apDirty = true; $('ap-saved').hidden = true; });
async function saveArchipelago(extra = {}) {
  await api.saveSettings({
    archipelago: {
      enabled: $('ap-enabled').checked, server: $('ap-server').value.trim(), slot: $('ap-slot').value.trim(),
      password: $('ap-password').value, showLog: $('ap-show-log').checked, ...extra
    }
  });
  apDirty = false;
  $('ap-saved').hidden = false;
  setTimeout(() => { $('ap-saved').hidden = true; }, 2000);
}
$('ap-enabled').addEventListener('change', () => {
  if ($('ap-enabled').checked && !$('ap-slot').value.trim()) {
    setStatus('Enter your slot name, then Save.');
    $('ap-slot').focus();
  }
  guarded(() => saveArchipelago());
});
$('ap-show-log').addEventListener('change', () => guarded(() => saveArchipelago()));
$('ap-save').addEventListener('click', () => guarded(() => saveArchipelago()));
$('ap-choose-patch').addEventListener('click', () => guarded(async () => {
  const file = await api.choosePatchFile();
  if (file) await saveArchipelago({ patchFile: file });
}));
$('ap-clear-patch').addEventListener('click', () => guarded(() => saveArchipelago({ patchFile: '' })));

// Settings.
for (const input of document.querySelectorAll('input[name="difficulty"]')) {
  input.addEventListener('change', () => guarded(() => api.saveSettings({ difficulty: input.value })));
}
$('skip-strap').addEventListener('change', () => guarded(() => api.saveSettings({ skipStrapScreen: $('skip-strap').checked })));
// Segmented controls: data-setting on the group, data-value on each button.
const SEGMENT_SAVE = {
  buttonStyle: v => ({ buttonStyle: v }),
  widescreen: v => ({ graphics: { widescreen: v === 'true' } }),
  resolution: v => ({ graphics: { resolution: Number(v) } }),
  displayMode: v => ({ graphics: { displayMode: v } })
};
for (const group of document.querySelectorAll('.segmented[data-setting]')) {
  for (const b of group.querySelectorAll('.seg')) {
    b.addEventListener('click', () => {
      setSegmented(group.dataset.setting, b.dataset.value);
      guarded(() => api.saveSettings(SEGMENT_SAVE[group.dataset.setting](b.dataset.value)));
    });
  }
}
$('force-aspect').addEventListener('change', () => guarded(() => api.saveSettings({ graphics: { forceAspect: $('force-aspect').checked } })));
$('native-effects').addEventListener('change', () => guarded(() => api.saveSettings({ graphics: { nativeEffects: $('native-effects').checked } })));

// Window.
$('window-minimize').addEventListener('click', () => api.window('minimize'));
$('window-fullscreen').addEventListener('click', () => api.window('fullscreen'));
$('window-close').addEventListener('click', () => api.window('close'));

// Events from the main process.
api.onLog(appendLog);
api.onTask(renderTask);
api.onStateChanged(() => sync());
// ...and whenever the launcher's window comes back to the front (after playing, or after editing Config.toml).
window.addEventListener('focus', () => sync());

// Controller navigation (gamepad-nav.js from SMS Launcher, MIT).
window.smsGamepadNav.start({
  document, window,
  regions: '.switch, .field, .choice',
  defaultFocus: () => [page === 'play' ? ($('play').disabled ? $('setup').querySelector('.step.current button') : $('play')) : $(`nav-${page}`), $('nav-play')],
  // The game reads the same controller while it runs.
  paused: () => Boolean(current?.running) || Boolean(capture),
  actions: {
    back: () => { if (logOpen) setLogOpen(false); else if (page !== 'play') showPage('play'); },
    menu: () => showPage(page === 'settings' ? 'play' : 'settings'),
    view: () => setLogOpen(!logOpen),
    previous: () => stepPage(-1),
    next: () => stepPage(1)
  }
});
window.addEventListener('gamepadconnected', () => { $('pad-hints').hidden = false; });
window.addEventListener('keydown', event => { if (event.key === 'Escape' && page !== 'play') showPage('play'); });

sync().then(() => { for (const line of current?.logs || []) appendLog(line); });

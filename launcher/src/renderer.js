'use strict';

const $ = id => document.getElementById(id);
const api = window.launcher;
let current = null;
let page = 'play';
let logOpen = false;

// ---- pages ----
const pageOrder = ['play', 'archipelago', 'controls', 'settings', 'credits'];
function showPage(name) {
  page = name;
  for (const p of pageOrder) {
    $(`page-${p}`).classList.toggle('active', p === name);
    $(`nav-${p}`).classList.toggle('active', p === name);
  }
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
  $('install-tools').hidden = !s.tools.managed || s.tools.ok;
  $('install-tools').disabled = s.busy || s.running;
  $('copy-tool-command').hidden = !s.tools.hint;
  $('tool-command').textContent = s.tools.hint || '';
  // Disc.
  $('disc-path').textContent = s.disc || (s.extracted ? 'Already extracted' : 'No disc chosen');
  $('step-2-state').textContent = s.extracted ? 'Extracted' : s.disc ? 'Chosen' : '';
  // Build.
  $('step-3-state').textContent = s.build.built ? (s.build.outdated ? 'Update available' : 'Built') : '';
  $('build').textContent = s.build.built ? 'Rebuild' : 'Build';
  $('build').disabled = s.busy || s.running;
  $('setup').hidden = s.step === 0 && !s.build.outdated;
  $('setup-title').textContent = s.build.outdated ? 'An update to the port is ready' : 'Set up Fist-In!!';
  if (s.build.outdated) { $('step-3').classList.add('current'); $('step-3').classList.remove('done'); }
}

function renderLaunch(s) {
  const ready = s.step === 0;
  $('play').disabled = !ready || s.busy || s.running;
  $('play').textContent = s.running ? 'Playing' : 'Play';
  $('launch-title').textContent = s.running ? 'Fist-In!! is running' : ready ? 'Ready to play' : 'Not ready yet';
  $('launch-detail').textContent = s.running ? 'Close the game to come back here.'
    : ready ? (s.build.at ? `Built ${new Date(s.build.at).toLocaleString()}` : '') : 'Finish the setup above.';
  const ap = s.settings.archipelago;
  $('ap-badge').hidden = !ap.enabled;
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
  $('graphics-note').textContent = s.running
    ? 'The game is running, so changes here apply the next time it starts. To change them now, press F10 in the game.'
    : "Auto renders at the window's size. Native is the Wii's resolution; higher multiples look sharper but need a stronger graphics card. Aspect ratio changes apply the next time the game starts.";
  $('data-root').textContent = s.dataRoot;
  $('port-source').textContent = s.portSource || 'Not found';
  $('rebuild').disabled = s.busy || s.running || s.step === 1;
}

// Controls: the gamepad mapping (wiimote_emulated.cpp), shown with the chosen style's glyphs.
const CONTROLS = [
  { glyphs: ['south'], wii: '1', fight: 'Left punch' },
  { glyphs: ['east'], wii: '2', fight: 'Right punch' },
  { glyphs: ['north'], wii: 'A', fight: 'Star punch' },
  { glyphs: ['west'], wii: 'B', fight: "The remote's B" },
  { glyphs: ['dpad_up'], wii: 'Up', fight: 'Block; with a punch: punch to the face' },
  { glyphs: ['dpad_down'], wii: 'Down', fight: 'Duck' },
  { glyphs: ['dpad_left', 'dpad_right'], wii: 'Left / Right', fight: 'Dodge' },
  { glyphs: ['leftstick'], wii: 'D-pad', fight: 'Same as the D-pad' },
  { glyphs: ['start'], wii: '+', fight: 'Pause' },
  { glyphs: ['back'], wii: '−', fight: "The remote's −" },
  { glyphs: ['rightstick'], wii: 'Pointer', fight: 'Moves the pointer in menus' }
];
function renderControls(s) {
  const style = s.settings.buttonStyle || 'auto';
  setSegmented('buttonStyle', style);
  $('style-note').textContent = style === 'auto' ? 'The in-game button prompts follow the controller you have plugged in.'
    : `The in-game button prompts always use ${style === 'xbox' ? 'Xbox' : 'PlayStation'} buttons.`;
  const folder = style === 'playstation' ? 'playstation' : 'xbox';
  $('controls-body').replaceChildren(...CONTROLS.map(c => {
    const tr = document.createElement('tr');
    const g = document.createElement('td');
    for (const name of c.glyphs) {
      const img = document.createElement('img');
      img.src = `assets/glyphs/${folder}/${name}.png`;
      img.alt = name;
      g.append(img);
    }
    const w = document.createElement('td');
    w.className = 'wii';
    w.textContent = c.wii;
    const f = document.createElement('td');
    f.textContent = c.fight;
    tr.append(g, w, f);
    return tr;
  }));
}

function render(s) {
  current = s;
  renderSetup(s);
  renderLaunch(s);
  renderArchipelago(s);
  renderSettings(s);
  renderControls(s);
  renderTask(s.task);
  $('version').textContent = `v${s.version}`;
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

// Window.
$('window-minimize').addEventListener('click', () => api.window('minimize'));
$('window-fullscreen').addEventListener('click', () => api.window('fullscreen'));
$('window-close').addEventListener('click', () => api.window('close'));

// Events from the main process.
api.onLog(appendLog);
api.onTask(renderTask);
api.onStateChanged(() => sync());

// Controller navigation (gamepad-nav.js from SMS Launcher, MIT).
window.smsGamepadNav.start({
  document, window,
  regions: '.switch, .field, .choice',
  defaultFocus: () => [page === 'play' ? ($('play').disabled ? $('setup').querySelector('.step.current button') : $('play')) : $(`nav-${page}`), $('nav-play')],
  // The game reads the same controller while it runs.
  paused: () => Boolean(current?.running),
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

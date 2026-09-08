// Minimal SPA — no build step, no framework. Every screen renders into #app.
// Kept intentionally small: this is the MVP core loop (login, mark entry,
// exam config, locking, student & teacher management), not full report parity.

const state = {
  user: null,
  access: [],
  view: 'login',
  exams: [],
  currentExamId: null,
  classSections: null, // [{class, sec}, ...] — cached after first load
};

async function loadClassSections() {
  if (state.classSections) return state.classSections;
  try {
    state.classSections = await api('/students/meta/class-sections', { silent: true });
  } catch {
    state.classSections = [];
  }
  return state.classSections;
}

async function boot() {
  const sid = getSessionId();
  if (sid) {
    try {
      const me = await api('/auth/me', { silent: true });
      state.user = me.user;
      state.access = me.access;
      state.view = me.user.mustChangePassword ? 'changePassword' : 'dashboard';
    } catch {
      localStorage.removeItem('sessionId');
      state.view = 'login';
    }
  }
  renderApp();
}

function renderApp() {
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (!state.user) {
    app.appendChild(viewLogin());
    return;
  }
  if (state.view === 'changePassword') {
    app.appendChild(viewChangePassword());
    return;
  }
  app.appendChild(topbar());
  const container = document.createElement('div');
  container.className = 'container';
  if (state.view !== 'dashboard') {
    const back = el('a', { class: 'back-link' }, '← Back to Dashboard');
    back.onclick = () => { state.view = 'dashboard'; renderApp(); };
    container.appendChild(back);
  }
  container.appendChild(renderView());
  app.appendChild(container);
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue; // null/undefined means "omit this attribute", not setAttribute(k, "null")
    if (k === 'onclick' || k.startsWith('on')) e[k] = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

// ---------------------------------------------------------------------------
// Auth screens
// ---------------------------------------------------------------------------

function viewLogin() {
  const wrap = el('div', { class: 'center' });
  const card = el('div', { class: 'card login-card' });
  card.appendChild(el('h2', {}, 'Mark Entry System'));
  const username = el('input', { placeholder: 'Username' });
  const password = el('input', { type: 'password', placeholder: 'Password' });
  const btn = el('button', { style: 'width:100%;margin-top:14px' }, 'Log in');

  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const res = await api('/auth/login', { method: 'POST', body: { username: username.value, password: password.value } });
      localStorage.setItem('sessionId', res.sessionId);
      state.user = res.user;
      state.access = res.access;
      state.view = res.user.mustChangePassword ? 'changePassword' : 'dashboard';
      renderApp();
    } finally {
      btn.disabled = false;
    }
  };

  card.appendChild(el('label', {}, 'Username'));
  card.appendChild(username);
  card.appendChild(el('label', {}, 'Password'));
  card.appendChild(password);
  card.appendChild(btn);
  wrap.appendChild(card);
  return wrap;
}

function viewChangePassword() {
  const wrap = el('div', { class: 'center' });
  const card = el('div', { class: 'card login-card' });
  card.appendChild(el('h2', {}, 'Set a new password'));
  card.appendChild(el('p', { class: 'muted' }, 'Your account requires a password change before continuing.'));
  const pw1 = el('input', { type: 'password', placeholder: 'New password (min 8 chars)' });
  const btn = el('button', { style: 'width:100%;margin-top:14px' }, 'Save & continue');
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await api('/auth/change-password', { method: 'POST', body: { newPassword: pw1.value } });
      state.user.mustChangePassword = false;
      state.view = 'dashboard';
      renderApp();
    } finally {
      btn.disabled = false;
    }
  };
  card.appendChild(el('label', {}, 'New password'));
  card.appendChild(pw1);
  card.appendChild(btn);
  wrap.appendChild(card);
  return wrap;
}

function topbar() {
  const bar = el('div', { class: 'topbar' });
  const left = el('div', {}, [
    el('strong', {}, 'Mark Entry System'),
    el('span', { class: 'badge' }, roleLabel()),
  ]);
  const nav = el('nav');
  const link = (label, view) => {
    const a = el('a', {}, label);
    a.onclick = () => { state.view = view; renderApp(); };
    return a;
  };
  nav.appendChild(link('Dashboard', 'dashboard'));
  const logout = el('a', {}, 'Log out');
  logout.onclick = async () => {
    try { await api('/auth/logout', { method: 'POST', silent: true }); } catch {}
    localStorage.removeItem('sessionId');
    state.user = null;
    renderApp();
  };
  nav.appendChild(logout);
  const right = el('div', {}, [el('span', { class: 'muted' }, state.user.name), nav]);
  bar.appendChild(left);
  bar.appendChild(right);
  return bar;
}

function roleLabel() {
  if (state.user.isSuperAdmin) return 'Super Admin';
  if (state.user.isAdmin) return 'Admin';
  if (state.user.isAhm) return 'AHM';
  return 'Teacher';
}

function renderView() {
  switch (state.view) {
    case 'markEntry': return viewMarkEntry();
    case 'examConfig': return viewExamConfig();
    case 'locking': return viewLocking();
    case 'rankHub': return viewRankHub();
    case 'students': return viewStudents();
    case 'teachers': return viewTeachers();
    default: return viewDashboard();
  }
}

/**
 * Dashboard is a "Choose Action" hub, same idea as the old Apps Script
 * system: pick an exam for context (used to pre-select it on screens that
 * need one), then click a card for the thing you actually want to do.
 * Keeps the top nav down to just Dashboard + Log out instead of a long
 * flat list of tabs.
 */
function viewDashboard() {
  const wrap = el('div');
  wrap.appendChild(el('h2', {}, `Welcome, ${state.user.name}`));

  if (!state.user.isAdmin && !state.user.isSuperAdmin) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('p', {}, 'Enter marks for your assigned class/section/subjects.'));
    card.appendChild(el('p', { class: 'muted' }, `Your assigned class/section/subjects: ${
      state.access.length ? state.access.map((a) => `${a.class}-${a.sec} ${a.subject}`).join(', ') : 'none yet — ask your admin to grant access.'
    }`));
    const goBtn = el('button', {}, 'Enter Marks');
    goBtn.onclick = () => { state.view = 'markEntry'; renderApp(); };
    card.appendChild(el('div', { style: 'margin-top:14px' }, goBtn));
    wrap.appendChild(card);
    return wrap;
  }

  const examCard = el('div', { class: 'card' });
  const examSel = el('select');
  examSel.appendChild(el('option', { value: '' }, '-- choose an exam for context --'));
  loadExams().then(() => {
    for (const ex of state.exams) {
      const opt = el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`);
      if (ex.id === state.currentExamId) opt.selected = true;
      examSel.appendChild(opt);
    }
  });
  examSel.onchange = () => { state.currentExamId = examSel.value || null; };
  examCard.appendChild(el('label', {}, 'Current exam'));
  examCard.appendChild(examSel);
  examCard.appendChild(el('p', { class: 'muted' }, 'Pre-selects this exam on the screens below — Mark Entry, Config, and Rank List all read from it. Rank Cards always show every exam so far, regardless of this choice.'));
  wrap.appendChild(examCard);

  const grid = el('div', { class: 'action-grid' });
  const actionCard = (title, desc, view) => {
    const c = el('div', { class: 'action-card' }, [
      el('h3', {}, title),
      el('p', {}, desc),
    ]);
    c.onclick = () => { state.view = view; renderApp(); };
    return c;
  };
  grid.appendChild(actionCard('Enter Marks', 'Theory / Internal / Practical for one class-section-subject', 'markEntry'));
  grid.appendChild(actionCard('Configure Max & Pass Marks', 'Set max marks and minimum pass marks per subject', 'examConfig'));
  grid.appendChild(actionCard('Locking', 'Lock or unlock a subject so marks can no longer be edited', 'locking'));
  grid.appendChild(actionCard('Rank List & Rank Cards', 'View ranking and generate printable rank cards', 'rankHub'));
  grid.appendChild(actionCard('Manage Teacher Logins', 'View accounts, grant access, reset a forgotten password', 'teachers'));
  grid.appendChild(actionCard('Manage Students', 'Add, edit, or transfer a student between class/section', 'students'));
  wrap.appendChild(grid);
  return wrap;
}

// ---------------------------------------------------------------------------
// Shared: exam picker
// ---------------------------------------------------------------------------

async function loadExams() {
  state.exams = await api('/exams');
  return state.exams;
}

function examSelect(onChange) {
  const sel = el('select');
  sel.appendChild(el('option', { value: '' }, '-- select exam --'));
  for (const ex of state.exams) {
    sel.appendChild(el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`));
  }
  sel.onchange = () => onChange(sel.value);
  return sel;
}

// ---------------------------------------------------------------------------
// Mark Entry
// ---------------------------------------------------------------------------

function viewMarkEntry() {
  const wrap = el('div');
  wrap.appendChild(el('h2', {}, 'Mark Entry'));
  const card = el('div', { class: 'card' });
  const resultArea = el('div');

  const examSel = el('select');
  const clsSel = el('select');
  const secSel = el('select');
  const subjSel = el('select');
  const loadBtn = el('button', {}, 'Load');

  loadExams().then(() => {
    examSel.innerHTML = '';
    examSel.appendChild(el('option', { value: '' }, '-- exam --'));
    for (const ex of state.exams) {
      const opt = el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`);
      if (ex.id === state.currentExamId) opt.selected = true;
      examSel.appendChild(opt);
    }
  });

  loadClassSections().then((rows) => {
    clsSel.innerHTML = '';
    clsSel.appendChild(el('option', { value: '' }, '-- class --'));
    const classes = [...new Set(rows.map(r => r.class))];
    for (const c of classes) clsSel.appendChild(el('option', { value: c }, c));
  });

  function refreshSections() {
    secSel.innerHTML = '';
    subjSel.innerHTML = '';
    if (!clsSel.value) return;
    secSel.appendChild(el('option', { value: '' }, '-- section --'));
    const secs = state.classSections.filter(r => r.class === clsSel.value).map(r => r.sec);
    for (const s of secs) secSel.appendChild(el('option', { value: s }, s));
  }
  clsSel.onchange = () => { refreshSections(); };

  async function refreshSubjects() {
    subjSel.innerHTML = '';
    if (!clsSel.value || !secSel.value) return;
    try {
      const subjects = await api(`/exams/subjects?class=${encodeURIComponent(clsSel.value)}&sec=${encodeURIComponent(secSel.value)}`, { silent: true });
      for (const s of subjects) subjSel.appendChild(el('option', { value: s }, s === 'Language' ? 'Tamil (Language)' : s));
    } catch (err) {
      subjSel.appendChild(el('option', { value: '' }, 'No subject set for this class/section'));
    }
  }
  secSel.onchange = refreshSubjects;

  loadBtn.onclick = async () => {
    resultArea.innerHTML = '';
    if (!examSel.value || !clsSel.value || !secSel.value || !subjSel.value) {
      toast('Select exam, class, section, and subject first.');
      return;
    }
    try {
      const data = await api(`/marks?examId=${examSel.value}&class=${encodeURIComponent(clsSel.value)}&sec=${encodeURIComponent(secSel.value)}&subject=${encodeURIComponent(subjSel.value)}`);
      resultArea.appendChild(markEntryTable(examSel.value, clsSel.value, secSel.value, subjSel.value, data));
    } catch {
      // toast already shown by api()
    }
  };

  const row = el('div', { class: 'row' }, [
    el('div', {}, [el('label', {}, 'Exam'), examSel]),
    el('div', {}, [el('label', {}, 'Class'), clsSel]),
    el('div', {}, [el('label', {}, 'Section'), secSel]),
    el('div', {}, [el('label', {}, 'Subject'), subjSel]),
  ]);
  card.appendChild(row);
  card.appendChild(el('div', { style: 'margin-top:14px' }, loadBtn));
  wrap.appendChild(card);
  wrap.appendChild(resultArea);
  return wrap;
}

function markEntryTable(examId, cls, sec, subject, data) {
  const wrap = el('div', { class: 'card' });
  if (data.locked) {
    wrap.appendChild(el('div', { class: 'locked-banner' }, '🔒 This subject is locked and read-only. Ask an admin to unlock it to make changes.'));
  }
  const table = el('table');
  table.appendChild(el('tr', {}, [el('th', {}, 'Adm No'), el('th', {}, 'Name'), el('th', {}, 'Theory'), el('th', {}, 'Internal'), el('th', {}, 'Practical'), el('th', {}, 'Absent')]));
  const inputs = [];
  for (const s of data.rows) {
    const theory = el('input', { type: 'number', value: s.theory ?? '', disabled: data.locked ? 'true' : null });
    const internal = el('input', { type: 'number', value: s.internal ?? '', disabled: data.locked ? 'true' : null });
    const practical = el('input', { type: 'number', value: s.practical ?? '', disabled: data.locked ? 'true' : null });
    const absent = el('input', { type: 'checkbox', disabled: data.locked ? 'true' : null });
    absent.checked = !!s.is_absent;
    inputs.push({ studentId: s.student_id, theory, internal, practical, absent });
    table.appendChild(el('tr', {}, [
      el('td', {}, s.admission_no), el('td', {}, s.name),
      el('td', {}, theory), el('td', {}, internal), el('td', {}, practical), el('td', {}, absent),
    ]));
  }
  wrap.appendChild(table);
  if (!data.locked) {
    const saveBtn = el('button', { style: 'margin-top:14px' }, 'Save marks');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      const entries = inputs.map((i) => ({
        studentId: i.studentId,
        theory: i.theory.value === '' ? null : Number(i.theory.value),
        internal: i.internal.value === '' ? null : Number(i.internal.value),
        practical: i.practical.value === '' ? null : Number(i.practical.value),
        isAbsent: i.absent.checked,
      }));
      try {
        await api('/marks', { method: 'POST', body: { examId, class: cls, sec, subject, entries } });
        toast('Marks saved.', 'success');
      } finally {
        saveBtn.disabled = false;
      }
    };
    wrap.appendChild(saveBtn);
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// Admin: Exams & Config
// ---------------------------------------------------------------------------

function viewExamConfig() {
  const wrap = el('div');
  wrap.appendChild(el('h2', {}, 'Exams & Mark Configuration'));

  const createCard = el('div', { class: 'card' });
  createCard.appendChild(el('h3', {}, 'Create exam'));
  const nameInput = el('input', { placeholder: 'Exam name (e.g. Weekly Test 1, Mid Term)' });
  const createBtn = el('button', {}, 'Create');
  createBtn.onclick = async () => {
    if (!nameInput.value) return toast('Exam name required');
    try {
      await api('/exams', { method: 'POST', body: { examName: nameInput.value } });
      toast('Exam created.', 'success');
      nameInput.value = '';
      configArea.innerHTML = '';
      await loadExams();
      examSel.innerHTML = '';
      examSel.appendChild(el('option', { value: '' }, '-- exam --'));
      for (const ex of state.exams) examSel.appendChild(el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`));
    } catch {}
  };
  createCard.appendChild(el('div', { class: 'row' }, [nameInput, createBtn]));
  wrap.appendChild(createCard);

  const configCard = el('div', { class: 'card' });
  configCard.appendChild(el('h3', {}, 'Set max / pass marks'));
  const examSel = el('select');
  const clsInput = el('input', { placeholder: 'Class (e.g. VI)' });
  const subjInput = el('input', { placeholder: 'Subject key (e.g. Tamil, Language, Bio-Botany)' });
  const maxT = el('input', { type: 'number', placeholder: 'Max Theory' });
  const passT = el('input', { type: 'number', placeholder: 'Pass Theory' });
  const maxI = el('input', { type: 'number', placeholder: 'Max Internal' });
  const passI = el('input', { type: 'number', placeholder: 'Pass Internal' });
  const maxP = el('input', { type: 'number', placeholder: 'Max Practical' });
  const passP = el('input', { type: 'number', placeholder: 'Pass Practical' });
  const saveConfigBtn = el('button', {}, 'Save config');
  const configArea = el('div');

  loadExams().then(() => {
    examSel.innerHTML = '';
    examSel.appendChild(el('option', { value: '' }, '-- exam --'));
    for (const ex of state.exams) {
      const opt = el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`);
      if (ex.id === state.currentExamId) opt.selected = true;
      examSel.appendChild(opt);
    }
  });

  saveConfigBtn.onclick = async () => {
    if (!examSel.value || !clsInput.value || !subjInput.value) return toast('Exam, class, subject required');
    try {
      await api(`/exams/${examSel.value}/config`, {
        method: 'PUT',
        body: {
          class: clsInput.value, subject: subjInput.value,
          maxTheory: Number(maxT.value) || 0, passTheory: Number(passT.value) || 0,
          maxInternal: Number(maxI.value) || 0, passInternal: Number(passI.value) || 0,
          maxPractical: Number(maxP.value) || 0, passPractical: Number(passP.value) || 0,
        },
      });
      toast('Config saved.', 'success');
    } catch {}
  };

  configCard.appendChild(el('div', { class: 'row' }, [
    el('div', {}, [el('label', {}, 'Exam'), examSel]),
    el('div', {}, [el('label', {}, 'Class'), clsInput]),
    el('div', {}, [el('label', {}, 'Subject key'), subjInput]),
  ]));
  configCard.appendChild(el('p', { class: 'muted' }, 'Tip: XI/XII use internal key "Language" for what displays as "Tamil". Bio-Botany and Bio-Zoology are configured separately.'));
  configCard.appendChild(el('div', { class: 'row' }, [maxT, passT, maxI, passI, maxP, passP]));
  configCard.appendChild(el('div', { style: 'margin-top:14px' }, saveConfigBtn));
  wrap.appendChild(configCard);
  wrap.appendChild(configArea);
  return wrap;
}

// ---------------------------------------------------------------------------
// Admin: Locking
// ---------------------------------------------------------------------------

function viewLocking() {
  const wrap = el('div');
  wrap.appendChild(el('h2', {}, 'Locking'));
  const card = el('div', { class: 'card' });
  const examSel = el('select');
  const clsInput = el('input', { placeholder: 'Class' });
  const secInput = el('input', { placeholder: 'Section' });
  const subjInput = el('input', { placeholder: 'Subject key (blank = whole section)' });
  const status = el('div', { class: 'muted', style: 'margin-top:10px' });

  loadExams().then(() => {
    examSel.innerHTML = '';
    examSel.appendChild(el('option', { value: '' }, '-- exam --'));
    for (const ex of state.exams) {
      const opt = el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`);
      if (ex.id === state.currentExamId) opt.selected = true;
      examSel.appendChild(opt);
    }
  });

  async function checkStatus() {
    if (!examSel.value || !clsInput.value || !secInput.value) return;
    try {
      const r = await api(`/locks/section-fully-locked?examId=${examSel.value}&class=${encodeURIComponent(clsInput.value)}&sec=${encodeURIComponent(secInput.value)}`, { silent: true });
      status.textContent = r.fullyLocked
        ? `Fully locked — ${r.lockedSubjects.length}/${r.subjects.length} subjects. Rank Cards may be generated.`
        : `Not fully locked — ${r.lockedSubjects.length}/${r.subjects.length} subjects locked (${r.subjects.filter((s) => !r.lockedSubjects.includes(s)).join(', ')} still open).`;
    } catch {
      status.textContent = '';
    }
  }

  const lockOneBtn = el('button', {}, 'Lock subject');
  const unlockOneBtn = el('button', { class: 'secondary' }, 'Unlock subject');
  const lockAllBtn = el('button', {}, 'Lock ALL subjects for section');
  const unlockAllBtn = el('button', { class: 'secondary' }, 'Unlock ALL subjects for section');

  async function toggleOne(locked) {
    if (!examSel.value || !clsInput.value || !secInput.value || !subjInput.value) return toast('Exam, class, section, subject required for single-subject toggle');
    try {
      await api('/locks/toggle', { method: 'POST', body: { examId: examSel.value, class: clsInput.value, sec: secInput.value, subject: subjInput.value, locked } });
      toast(locked ? 'Locked.' : 'Unlocked.', 'success');
      checkStatus();
    } catch {}
  }
  async function toggleAll(locked) {
    if (!examSel.value || !clsInput.value || !secInput.value) return toast('Exam, class, section required');
    try {
      await api('/locks/lock-all', { method: 'POST', body: { examId: examSel.value, class: clsInput.value, sec: secInput.value, locked } });
      toast(locked ? 'All subjects locked.' : 'All subjects unlocked.', 'success');
      checkStatus();
    } catch {}
  }

  lockOneBtn.onclick = () => toggleOne(true);
  unlockOneBtn.onclick = () => toggleOne(false);
  lockAllBtn.onclick = () => toggleAll(true);
  unlockAllBtn.onclick = () => toggleAll(false);
  [examSel, clsInput, secInput].forEach((i) => i.addEventListener('change', checkStatus));

  card.appendChild(el('div', { class: 'row' }, [
    el('div', {}, [el('label', {}, 'Exam'), examSel]),
    el('div', {}, [el('label', {}, 'Class'), clsInput]),
    el('div', {}, [el('label', {}, 'Section'), secInput]),
    el('div', {}, [el('label', {}, 'Subject key (optional)'), subjInput]),
  ]));
  card.appendChild(el('div', { class: 'row', style: 'margin-top:14px' }, [lockOneBtn, unlockOneBtn, lockAllBtn, unlockAllBtn]));
  card.appendChild(status);
  wrap.appendChild(card);
  return wrap;
}

// ---------------------------------------------------------------------------
// Admin: Students
// ---------------------------------------------------------------------------

function viewStudents() {
  const wrap = el('div');
  wrap.appendChild(el('h2', {}, 'Students'));

  const addCard = el('div', { class: 'card' });
  addCard.appendChild(el('h3', {}, 'Add student'));
  const cls = el('input', { placeholder: 'Class' });
  const sec = el('input', { placeholder: 'Section' });
  const adm = el('input', { placeholder: 'Admission No' });
  const examNo = el('input', { placeholder: 'Exam No (optional)' });
  const name = el('input', { placeholder: 'Name' });
  const addBtn = el('button', {}, 'Add');
  addBtn.onclick = async () => {
    if (!cls.value || !sec.value || !adm.value || !name.value) return toast('Class, section, admission no, name required');
    try {
      await api('/students', { method: 'POST', body: { class: cls.value, sec: sec.value, admissionNo: adm.value, examNo: examNo.value || null, name: name.value } });
      toast('Student added.', 'success');
      cls.value = sec.value = adm.value = examNo.value = name.value = '';
      loadList();
    } catch {}
  };
  addCard.appendChild(el('div', { class: 'row' }, [cls, sec, adm, examNo, name]));
  addCard.appendChild(el('div', { style: 'margin-top:14px' }, addBtn));
  wrap.appendChild(addCard);

  const listCard = el('div', { class: 'card' });
  listCard.appendChild(el('h3', {}, 'All students'));
  const filterCls = el('input', { placeholder: 'Filter by class (optional)' });
  const filterBtn = el('button', { class: 'secondary' }, 'Filter');
  const tableWrap = el('div');
  filterBtn.onclick = () => loadList();
  listCard.appendChild(el('div', { class: 'row' }, [filterCls, filterBtn]));
  listCard.appendChild(tableWrap);
  wrap.appendChild(listCard);

  async function loadList() {
    tableWrap.innerHTML = '';
    try {
      const q = filterCls.value ? `?class=${encodeURIComponent(filterCls.value)}` : '';
      const rows = await api(`/students${q}`, { silent: true });
      const table = el('table');
      table.appendChild(el('tr', {}, [el('th', {}, 'Class'), el('th', {}, 'Sec'), el('th', {}, 'Adm No'), el('th', {}, 'Name'), el('th', {}, '')]));
      for (const s of rows) {
        const delBtn = el('button', { class: 'danger' }, 'Delete');
        delBtn.onclick = async () => {
          if (!confirm(`Delete ${s.name}? This is logged and revertible via the audit trail.`)) return;
          try { await api(`/students/${s.student_id}`, { method: 'DELETE' }); toast('Deleted.', 'success'); loadList(); } catch {}
        };
        table.appendChild(el('tr', {}, [el('td', {}, s.class), el('td', {}, s.sec), el('td', {}, s.admission_no), el('td', {}, s.name), el('td', {}, delBtn)]));
      }
      tableWrap.appendChild(table);
    } catch {}
  }
  loadList();
  return wrap;
}

// ---------------------------------------------------------------------------
// Admin: Teachers
// ---------------------------------------------------------------------------

function viewTeachers() {
  const wrap = el('div');
  wrap.appendChild(el('h2', {}, 'Teachers & Access'));

  const addCard = el('div', { class: 'card' });
  addCard.appendChild(el('h3', {}, 'Create teacher login'));
  const name = el('input', { placeholder: 'Name' });
  const username = el('input', { placeholder: 'Username' });
  const isAdmin = el('input', { type: 'checkbox' });
  const isAhm = el('input', { type: 'checkbox' });
  const addBtn = el('button', {}, 'Create');
  const tempPwArea = el('p', { class: 'muted' });
  addBtn.onclick = async () => {
    if (!name.value || !username.value) return toast('Name and username required');
    try {
      const res = await api('/teachers', { method: 'POST', body: { name: name.value, username: username.value, isAdmin: isAdmin.checked, isAhm: isAhm.checked } });
      tempPwArea.textContent = `Temp password for ${username.value}: ${res.tempPassword} — give this to the teacher now, it won't be shown again.`;
      name.value = username.value = '';
      isAdmin.checked = isAhm.checked = false;
      loadList();
    } catch {}
  };
  addCard.appendChild(el('div', { class: 'row' }, [
    el('div', {}, [el('label', {}, 'Name'), name]),
    el('div', {}, [el('label', {}, 'Username'), username]),
    el('div', {}, [el('label', {}, 'Admin'), isAdmin]),
    el('div', {}, [el('label', {}, 'AHM'), isAhm]),
  ]));
  addCard.appendChild(el('div', { style: 'margin-top:14px' }, addBtn));
  addCard.appendChild(tempPwArea);
  wrap.appendChild(addCard);

  const grantCard = el('div', { class: 'card' });
  grantCard.appendChild(el('h3', {}, 'Grant class/section/subject access'));
  const empIdInput = el('input', { placeholder: 'Teacher EmpID (copy from list below)' });
  const gCls = el('input', { placeholder: 'Class' });
  const gSec = el('input', { placeholder: 'Section' });
  const gSubj = el('input', { placeholder: 'Subject key' });
  const grantBtn = el('button', {}, 'Grant');
  grantBtn.onclick = async () => {
    if (!empIdInput.value || !gCls.value || !gSec.value || !gSubj.value) return toast('All fields required');
    try {
      await api(`/teachers/${empIdInput.value}/access`, { method: 'POST', body: { class: gCls.value, sec: gSec.value, subject: gSubj.value } });
      toast('Access granted.', 'success');
    } catch {}
  };
  grantCard.appendChild(el('div', { class: 'row' }, [empIdInput, gCls, gSec, gSubj]));
  grantCard.appendChild(el('div', { style: 'margin-top:14px' }, grantBtn));
  wrap.appendChild(grantCard);

  const listCard = el('div', { class: 'card' });
  listCard.appendChild(el('h3', {}, 'All teachers'));
  const tableWrap = el('div');
  listCard.appendChild(tableWrap);
  wrap.appendChild(listCard);

  async function loadList() {
    tableWrap.innerHTML = '';
    try {
      const rows = await api('/teachers', { silent: true });
      const table = el('table');
      table.appendChild(el('tr', {}, [el('th', {}, 'EmpID'), el('th', {}, 'Name'), el('th', {}, 'Username'), el('th', {}, 'Roles'), el('th', {}, '')]));
      for (const t of rows) {
        const resetBtn = el('button', { class: 'secondary' }, 'Reset password');
        resetBtn.onclick = async () => {
          try {
            const res = await api(`/teachers/${t.emp_id}/reset-password`, { method: 'POST' });
            alert(`New temp password for ${t.username}: ${res.tempPassword}`);
          } catch {}
        };
        const roles = [t.is_super_admin && 'SuperAdmin', t.is_admin && 'Admin', t.is_ahm && 'AHM'].filter(Boolean).join(', ') || 'Teacher';
        table.appendChild(el('tr', {}, [el('td', {}, t.emp_id.slice(0, 8) + '…'), el('td', {}, t.name), el('td', {}, t.username), el('td', {}, roles), el('td', {}, resetBtn)]));
      }
      tableWrap.appendChild(table);
    } catch {}
  }
  loadList();
  return wrap;
}

// ---------------------------------------------------------------------------
// Admin: Rank List
// ---------------------------------------------------------------------------

function rankListTable(rows) {
  const wrap = el('div', { class: 'card' });
  if (!rows.length) { wrap.appendChild(el('p', { class: 'muted' }, 'No students found.')); return wrap; }
  const subjects = rows[0].subjects.map((s) => s.subject);
  const table = el('table');
  const headCells = [el('th', {}, 'Adm No'), el('th', {}, 'Name')];
  for (const subj of subjects) headCells.push(el('th', {}, displayLabelFor(subj)));
  headCells.push(el('th', {}, 'Total'), el('th', {}, '%'), el('th', {}, 'Result'), el('th', {}, 'Rank'));
  table.appendChild(el('tr', {}, headCells));

  for (const r of rows) {
    const cells = [el('td', {}, String(r.admissionNo)), el('td', {}, r.name)];
    for (const subj of subjects) {
      const sr = r.subjects.find((x) => x.subject === subj);
      const shown = !sr || !sr.configured ? '' : (!sr.complete ? 'AB' : `${Math.round(sr.total)}/${sr.max}`);
      cells.push(el('td', {}, shown));
    }
    cells.push(
      el('td', {}, `${r.grandTotal}/${r.grandMax}`),
      el('td', {}, `${r.percentage}%`),
      el('td', {}, r.result),
      el('td', {}, r.rank == null ? '-' : String(r.rank)),
    );
    table.appendChild(el('tr', {}, cells));
  }
  wrap.appendChild(table);
  return wrap;
}

// 'Language' always displays as 'Tamil' everywhere in the UI, per the
// original system's rule (internal key never changes, only the label).
function displayLabelFor(subjectKey) {
  return subjectKey === 'Language' ? 'Tamil' : subjectKey;
}

// ---------------------------------------------------------------------------
// Admin: Rank List + Rank Cards — one combined screen, matching the old
// system's layout: pick exam/class/section once, see the Rank List for that
// exam, then generate printable Rank Cards below (cards always show every
// exam created so far, regardless of which exam is picked above — same as
// the old system's behavior).
// ---------------------------------------------------------------------------

function viewRankHub() {
  const wrap = el('div');
  wrap.appendChild(el('h2', {}, 'Rank List & Rank Cards'));

  const pickCard = el('div', { class: 'card' });
  const examSel = el('select');
  const clsSel = el('select');
  const secSel = el('select');
  const loadBtn = el('button', {}, 'Load Rank List');

  loadExams().then(() => {
    examSel.innerHTML = '';
    examSel.appendChild(el('option', { value: '' }, '-- exam --'));
    for (const ex of state.exams) {
      const opt = el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`);
      if (ex.id === state.currentExamId) opt.selected = true;
      examSel.appendChild(opt);
    }
  });
  loadClassSections().then((rows) => {
    clsSel.innerHTML = '';
    clsSel.appendChild(el('option', { value: '' }, '-- class --'));
    for (const c of [...new Set(rows.map((r) => r.class))]) clsSel.appendChild(el('option', { value: c }, c));
  });
  clsSel.onchange = () => {
    secSel.innerHTML = '';
    secSel.appendChild(el('option', { value: '' }, '-- section --'));
    for (const s of state.classSections.filter((r) => r.class === clsSel.value).map((r) => r.sec)) {
      secSel.appendChild(el('option', { value: s }, s));
    }
  };

  const rankListArea = el('div');
  loadBtn.onclick = async () => {
    rankListArea.innerHTML = '';
    if (!examSel.value || !clsSel.value || !secSel.value) { toast('Select exam, class, and section first.'); return; }
    try {
      const rows = await api(`/ranks/list?examId=${examSel.value}&class=${encodeURIComponent(clsSel.value)}&sec=${encodeURIComponent(secSel.value)}`);
      rankListArea.appendChild(el('h3', {}, `Rank List — ${examSel.selectedOptions[0].textContent}`));
      rankListArea.appendChild(rankListTable(rows));
    } catch {}
  };

  pickCard.appendChild(el('div', { class: 'row' }, [
    el('div', {}, [el('label', {}, 'Exam'), examSel]),
    el('div', {}, [el('label', {}, 'Class'), clsSel]),
    el('div', {}, [el('label', {}, 'Section'), secSel]),
  ]));
  pickCard.appendChild(el('div', { style: 'margin-top:14px' }, loadBtn));
  wrap.appendChild(pickCard);
  wrap.appendChild(rankListArea);

  // ---- Rank Card generation (consolidates every exam so far) ----
  const rcCard = el('div', { class: 'card' });
  rcCard.appendChild(el('h3', {}, 'Generate Rank Card (every exam so far, for this student)'));
  const statusArea = el('div');
  const cardArea = el('div', { id: 'rankCardArea' });
  const admInput = el('input', { placeholder: 'Admission No (optional — leave blank for whole section)' });
  const genBtn = el('button', {}, 'Generate');
  const printBtn = el('button', { class: 'secondary', style: 'display:none' }, 'Print / Save as PDF');
  printBtn.onclick = () => window.print();

  genBtn.onclick = async () => {
    statusArea.innerHTML = '';
    cardArea.innerHTML = '';
    printBtn.style.display = 'none';
    if (!clsSel.value || !secSel.value) { toast('Select class and section first (above).'); return; }

    try {
      const school = await api('/settings', { silent: true });

      if (admInput.value.trim()) {
        // Single student — always allowed as a preview, no lock requirement
        // (matches the old system: "View Rank Card" previews anytime; only
        // bulk section generation requires everything locked first).
        const oneCard = await api(`/ranks/cards/${encodeURIComponent(admInput.value.trim())}?class=${encodeURIComponent(clsSel.value)}&sec=${encodeURIComponent(secSel.value)}`);
        cardArea.appendChild(buildRankCardEl(oneCard, school));
        printBtn.style.display = '';
        return;
      }

      const lockStatus = await api(`/ranks/lock-status?class=${encodeURIComponent(clsSel.value)}&sec=${encodeURIComponent(secSel.value)}`, { silent: true });
      if (!lockStatus.fullyLocked) {
        const list = lockStatus.unlocked.map((u) => `${u.examName} — ${displayLabelFor(u.subject)}`).join(', ');
        statusArea.appendChild(el('div', { class: 'locked-banner' },
          `Rank Cards can only be generated once every exam/subject for this section is locked. Still open: ${list || '(nothing configured yet)'}`));
        return;
      }

      const cards = await api(`/ranks/cards?class=${encodeURIComponent(clsSel.value)}&sec=${encodeURIComponent(secSel.value)}`);
      if (!cards.length) { statusArea.appendChild(el('p', { class: 'muted' }, 'No students found.')); return; }
      for (const c of cards) cardArea.appendChild(buildRankCardEl(c, school));
      printBtn.style.display = '';
    } catch {}
  };

  rcCard.appendChild(el('div', { class: 'row' }, [
    el('div', {}, [el('label', {}, 'Admission No (optional)'), admInput]),
  ]));
  rcCard.appendChild(el('div', { style: 'margin-top:14px' }, [genBtn, printBtn]));
  wrap.appendChild(rcCard);
  wrap.appendChild(statusArea);
  wrap.appendChild(cardArea);
  return wrap;
}

/**
 * Merges Bio-Botany + Bio-Zoology into one "Biology" column for display,
 * exactly like the old system's mergeBiologyForCard_ — data-driven (only
 * fires when both halves are actually present in the subject list), works
 * on the RAW as-entered marks (never the EMIS-converted figures).
 */
function mergeBiologyForCard(subjects, exams) {
  const iB = subjects.indexOf('Bio-Botany');
  const iZ = subjects.indexOf('Bio-Zoology');
  if (iB === -1 || iZ === -1) return { subjects, exams };

  const mergedSubjects = subjects.filter((s) => s !== 'Bio-Botany' && s !== 'Bio-Zoology');
  mergedSubjects.splice(Math.min(iB, iZ), 0, 'Biology');

  const mergedExams = exams.map((ex) => {
    const botany = ex.subjects.find((s) => s.subject === 'Bio-Botany');
    const zoology = ex.subjects.find((s) => s.subject === 'Bio-Zoology');
    const rest = ex.subjects.filter((s) => s.subject !== 'Bio-Botany' && s.subject !== 'Bio-Zoology');
    if (botany || zoology) {
      const configured = (botany && botany.configured) || (zoology && zoology.configured);
      const complete = configured && (!botany || botany.complete) && (!zoology || zoology.complete);
      const total = (botany ? botany.total : 0) + (zoology ? zoology.total : 0);
      const max = (botany ? botany.max : 0) + (zoology ? zoology.max : 0);
      rest.push({ subject: 'Biology', configured, complete, total, max });
    }
    return { ...ex, subjects: rest };
  });

  return { subjects: mergedSubjects, exams: mergedExams };
}

/**
 * Picks one "Max" figure per exam row for the card header column — the max
 * most subjects in that exam actually share (e.g. Weekly Test = 25 for
 * every subject), matching the old system's examRepresentativeMax_.
 */
function examRepresentativeMax(ex) {
  const counts = {};
  let best = null, bestCount = 0;
  for (const s of ex.subjects) {
    if (s.configured && s.max) {
      counts[s.max] = (counts[s.max] || 0) + 1;
      if (counts[s.max] > bestCount) { bestCount = counts[s.max]; best = s.max; }
    }
  }
  return best;
}

/**
 * Printable rank card matching the old system's official progress-report
 * layout: one row per exam, one column per subject (actual mark, not any
 * EMIS-converted figure), AB for absent/incomplete, TOT as total/max, RANK
 * blank unless that exam's result is Pass, REMARK as Pass/Fail/Incomplete.
 */
function buildRankCardEl(card, school) {
  const allSubjects = [];
  for (const ex of card.exams) for (const s of ex.subjects) if (!allSubjects.includes(s.subject)) allSubjects.push(s.subject);
  const merged = mergeBiologyForCard(allSubjects, card.exams);

  const page = el('div', { class: 'rank-card-page' });
  page.appendChild(el('div', { class: 'pr-header' }, [
    el('div', { class: 'pr-title-row' }, [el('h2', {}, school.school_name || '[School name — set in School Settings]')]),
    el('div', { class: 'pr-header-row' }, [
      el('span', {}, `PROGRESS REPORT${school.academic_year ? ' ' + school.academic_year : ''}`),
      school.phone ? el('span', { class: 'pr-phone' }, `PH : ${school.phone}`) : el('span'),
    ]),
  ]));
  page.appendChild(el('div', { class: 'pr-meta-row' }, [
    el('span', {}, [el('b', {}, 'NAME : '), card.name]),
    el('span', {}, [el('b', {}, 'CLASS : '), `${card.class}-${card.sec}`]),
    el('span', {}, [el('b', {}, 'ADM.NO : '), String(card.admissionNo)]),
    el('span', {}, [el('b', {}, 'EX.NO : '), String(card.examNo ?? '')]),
  ]));

  if (!merged.exams.length) {
    page.appendChild(el('p', {}, [el('i', {}, 'No exams recorded yet.')]));
    return page;
  }

  const headRow = [el('th', {}, 'Examination'), el('th', {}, 'Max')];
  for (const subj of merged.subjects) headRow.push(el('th', {}, displayLabelFor(subj)));
  headRow.push(el('th', {}, 'TOT'), el('th', {}, 'RANK'), el('th', {}, 'REMARK'));
  const table = el('table', { class: 'pr-grid' }, [el('tr', {}, headRow)]);

  for (const ex of merged.exams) {
    const maxPerSubj = examRepresentativeMax(ex);
    const rowCells = [el('td', { class: 'pr-exam-name' }, ex.examName), el('td', {}, maxPerSubj != null ? String(maxPerSubj) : '')];
    for (const subj of merged.subjects) {
      const sub = ex.subjects.find((s) => s.subject === subj);
      let cell = '';
      if (sub && sub.configured) cell = (!sub.complete || Math.round(sub.total) === 0) ? 'AB' : String(Math.round(sub.total));
      rowCells.push(el('td', {}, cell));
    }
    rowCells.push(
      el('td', {}, `${ex.grandTotal}/${ex.grandMax}`),
      el('td', {}, ex.rank == null ? '-' : String(ex.rank)),
      el('td', {}, ex.result),
    );
    table.appendChild(el('tr', {}, rowCells));
  }
  page.appendChild(table);

  page.appendChild(el('div', { class: 'pc-sign-row' }, [
    el('div', { class: 'pc-sign-block' }, [el('div', { class: 'pc-sign-line' }, ' '), "Class Teacher's Signature"]),
    el('div', { class: 'pc-sign-block' }, [el('div', { class: 'pc-sign-line' }, ' '), "Principal's Signature"]),
  ]));

  return page;
}

boot();

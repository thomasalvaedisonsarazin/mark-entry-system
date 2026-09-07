// Minimal SPA — no build step, no framework. Every screen renders into #app.
// Kept intentionally small: this is the MVP core loop (login, mark entry,
// exam config, locking, student & teacher management), not full report parity.

const state = {
  user: null,
  access: [],
  view: 'login',
  exams: [],
  currentExamId: null,
};

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
  nav.appendChild(link('Mark Entry', 'markEntry'));
  if (state.user.isAdmin || state.user.isSuperAdmin) {
    nav.appendChild(link('Exams & Config', 'examConfig'));
    nav.appendChild(link('Locking', 'locking'));
    nav.appendChild(link('Students', 'students'));
    nav.appendChild(link('Teachers', 'teachers'));
  }
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
    case 'students': return viewStudents();
    case 'teachers': return viewTeachers();
    default: return viewDashboard();
  }
}

function viewDashboard() {
  const wrap = el('div');
  wrap.appendChild(el('h2', {}, `Welcome, ${state.user.name}`));
  const card = el('div', { class: 'card' });
  card.appendChild(el('p', {}, 'This is the MVP core loop: create an exam, configure max/pass marks, enter and lock marks per subject.'));
  if (!state.user.isAdmin && !state.user.isSuperAdmin) {
    card.appendChild(el('p', { class: 'muted' }, `Your assigned class/section/subjects: ${
      state.access.length ? state.access.map((a) => `${a.class}-${a.sec} ${a.subject}`).join(', ') : 'none yet — ask your admin to grant access.'
    }`));
  }
  wrap.appendChild(card);
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
  const clsInput = el('input', { placeholder: 'Class (e.g. VI, XI)' });
  const secInput = el('input', { placeholder: 'Section (e.g. A)' });
  const subjSel = el('select');
  const loadBtn = el('button', {}, 'Load');

  loadExams().then(() => {
    examSel.innerHTML = '';
    examSel.appendChild(el('option', { value: '' }, '-- exam --'));
    for (const ex of state.exams) examSel.appendChild(el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`));
  });

  async function refreshSubjects() {
    subjSel.innerHTML = '';
    if (!clsInput.value || !secInput.value) return;
    try {
      const subjects = await api(`/exams/subjects?class=${encodeURIComponent(clsInput.value)}&sec=${encodeURIComponent(secInput.value)}`, { silent: true });
      for (const s of subjects) subjSel.appendChild(el('option', { value: s }, s === 'Language' ? 'Tamil (Language)' : s));
    } catch (err) {
      subjSel.appendChild(el('option', { value: '' }, 'No subject set for this class/section'));
    }
  }
  clsInput.oninput = refreshSubjects;
  secInput.oninput = refreshSubjects;

  loadBtn.onclick = async () => {
    resultArea.innerHTML = '';
    if (!examSel.value || !clsInput.value || !secInput.value || !subjSel.value) {
      toast('Select exam, class, section, and subject first.');
      return;
    }
    try {
      const data = await api(`/marks?examId=${examSel.value}&class=${encodeURIComponent(clsInput.value)}&sec=${encodeURIComponent(secInput.value)}&subject=${encodeURIComponent(subjSel.value)}`);
      resultArea.appendChild(markEntryTable(examSel.value, clsInput.value, secInput.value, subjSel.value, data));
    } catch {
      // toast already shown by api()
    }
  };

  const row = el('div', { class: 'row' }, [
    el('div', {}, [el('label', {}, 'Exam'), examSel]),
    el('div', {}, [el('label', {}, 'Class'), clsInput]),
    el('div', {}, [el('label', {}, 'Section'), secInput]),
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
    for (const ex of state.exams) examSel.appendChild(el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`));
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
    for (const ex of state.exams) examSel.appendChild(el('option', { value: ex.id }, `${ex.exam_name} (${ex.year_label})`));
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

boot();

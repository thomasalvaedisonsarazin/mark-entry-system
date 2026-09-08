// Rank list / rank card computation — ported line-for-line in behavior from
// the live Code.gs's computeRankList_ (see MARK_ENTRY_SYSTEM_SPEC.md history).
// Do not "simplify" the tie-handling or the Pass-only ranking rule below —
// both are exact matches to the official report convention the school uses.

/** Matches Code.gs's isWeeklyOrMidTermExam_ exactly (name-only, case-insensitive). */
export function isWeeklyOrMidTermExam(examName) {
  return /weekly\s*test/i.test(examName) || /mid\s*term/i.test(examName);
}

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function isBlank(v) {
  return v === '' || v === undefined || v === null;
}

/**
 * cfgRows: exam_config rows for this exam+class (max_theory, pass_theory, ...).
 * markRows: marks rows for this exam+class+sec (student_id, subject, theory,
 *   internal, practical, is_absent).
 * students: [{ student_id, admission_no, exam_no, name }] for this class+sec.
 * subjects: subject key list for this class+sec (getSubjectsFor).
 *
 * Returns one result object per student: subjects[], grandTotal, grandMax,
 * percentage, result ('Pass'|'Fail'|'Incomplete'), complete, rank (or null).
 */
export function computeRankList(examName, students, subjects, cfgRows, markRows) {
  const cfgMap = {};
  for (const r of cfgRows) {
    cfgMap[r.subject] = {
      maxT: numOrZero(r.max_theory), passT: numOrZero(r.pass_theory),
      maxI: numOrZero(r.max_internal), passI: numOrZero(r.pass_internal),
      maxP: numOrZero(r.max_practical), passP: numOrZero(r.pass_practical),
    };
  }

  const markMap = {};
  for (const r of markRows) {
    markMap[`${r.student_id}|${r.subject}`] = {
      theory: r.is_absent ? null : r.theory,
      internal: r.is_absent ? null : r.internal,
      practical: r.is_absent ? null : r.practical,
    };
  }

  const results = students.map((s) => {
    const subjResults = [];
    let grandTotal = 0, grandMax = 0, complete = true;

    for (const subj of subjects) {
      const cfg = cfgMap[subj];
      const mk = markMap[`${s.student_id}|${subj}`] || {};
      const configured = !!cfg && (cfg.maxT > 0 || cfg.maxI > 0 || cfg.maxP > 0);
      let subjMax = 0, subjTotal = 0, subjPass = true, subjComplete = configured;

      if (configured) {
        if (cfg.maxT > 0) {
          subjMax += cfg.maxT;
          if (isBlank(mk.theory)) subjComplete = false;
          else { subjTotal += Number(mk.theory); if (Number(mk.theory) < cfg.passT) subjPass = false; }
        }
        if (cfg.maxI > 0) {
          subjMax += cfg.maxI;
          if (isBlank(mk.internal)) subjComplete = false;
          else { subjTotal += Number(mk.internal); if (Number(mk.internal) < cfg.passI) subjPass = false; }
        }
        if (cfg.maxP > 0) {
          subjMax += cfg.maxP;
          if (isBlank(mk.practical)) subjComplete = false;
          else { subjTotal += Number(mk.practical); if (Number(mk.practical) < cfg.passP) subjPass = false; }
        }
      }

      if (!subjComplete) complete = false;
      grandMax += subjMax;
      grandTotal += subjTotal;

      subjResults.push({
        subject: subj,
        total: subjTotal, max: subjMax,
        passMark: cfg ? (cfg.passT + cfg.passI + cfg.passP) : 0,
        pass: subjPass, configured, complete: subjComplete,
      });
    }

    // Biology combined-pass override (Weekly Test / Mid Term only): Bio-Botany
    // and Bio-Zoology's individual pass/fail is replaced by one combined
    // check — total of both halves vs. sum of both halves' pass marks.
    if (isWeeklyOrMidTermExam(examName)) {
      const botanyR = subjResults.find((r) => r.subject === 'Bio-Botany');
      const zoologyR = subjResults.find((r) => r.subject === 'Bio-Zoology');
      if (botanyR && zoologyR && botanyR.configured && zoologyR.configured) {
        const combinedTotal = botanyR.total + zoologyR.total;
        const combinedPassMark = botanyR.passMark + zoologyR.passMark;
        const combinedPass = combinedTotal >= combinedPassMark;
        botanyR.pass = combinedPass;
        zoologyR.pass = combinedPass;
      }
    }
    const allPass = subjResults.every((r) => !r.configured || r.pass);

    const pct = grandMax > 0 ? (grandTotal / grandMax) * 100 : 0;
    return {
      studentId: s.student_id, admissionNo: s.admission_no, examNo: s.exam_no, name: s.name,
      subjects: subjResults,
      grandTotal, grandMax,
      percentage: Math.round(pct * 100) / 100,
      result: complete ? (allPass ? 'Pass' : 'Fail') : 'Incomplete',
      complete,
      rank: null,
    };
  });

  // Rank is only meaningful among students who PASSED (cleared every
  // subject's minimum mark AND every subject is complete). Ties share a rank.
  const passOnes = results.filter((r) => r.complete && r.result === 'Pass');
  passOnes.sort((a, b) => b.grandTotal - a.grandTotal);
  passOnes.forEach((r, idx) => {
    if (idx === 0) r.rank = 1;
    else r.rank = passOnes[idx - 1].grandTotal === r.grandTotal ? passOnes[idx - 1].rank : idx + 1;
  });

  results.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    if (a.complete && b.complete) return b.grandTotal - a.grandTotal;
    if (a.complete) return -1;
    if (b.complete) return 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return results;
}

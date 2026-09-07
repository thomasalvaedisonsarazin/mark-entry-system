// Subject rules & EMIS conversion.
// Values verified directly against the live Code.gs (EMIS_CONVERSION_TO,
// EMIS_PASS_MARK, EMIS_BIOLOGY_PASS_MARK, getSubjectsFor_, SENIOR_GROUPS) —
// do not "simplify" these numbers, each one maps to a real government form field.

export const FIXED_SUBJECTS_VI_TO_X = ['Tamil', 'English', 'Maths', 'Science', 'Social'];

// Internal key is 'Language' for XI/XII; display label is always 'Tamil'.
// The key must never change — only how it's shown to a user / printed.
export const SENIOR_GROUPS = [
  { name: 'Biology Group', sections: ['A', 'B', 'C'],
    subjects: ['Language', 'English', 'Physics', 'Chemistry', 'Bio-Botany', 'Bio-Zoology', 'Mathematics'] },
  { name: 'Computer Science Group', sections: ['D', 'E', 'F', 'G'],
    subjects: ['Language', 'English', 'Physics', 'Chemistry', 'Computer Science', 'Mathematics'] },
  { name: 'Commerce Group', sections: ['H', 'I', 'J'],
    subjects: ['Language', 'English', 'Economics', 'Commerce', 'Accountancy', 'Business Maths'] },
  { name: 'EMR Group', sections: ['K'],
    subjects: ['Language', 'English', 'Mathematics', 'Basic Electrical - Theory', 'Basic Electrical - Practical', 'Employability Skills'] },
  { name: 'History Group', sections: ['L'],
    subjects: ['Language', 'English', 'History', 'Economics', 'Commerce', 'Accountancy'] },
];

/** Display label for a subject key. Only 'Language' is renamed; everything else is shown as-is. */
export function displayLabel(subjectKey) {
  return subjectKey === 'Language' ? 'Tamil' : subjectKey;
}

/**
 * Returns the exact subject key list for a class+section.
 * VI-X: fixed set regardless of section.
 * XI-XII: entirely determined by section letter (group code is deliberately ignored).
 */
export function getSubjectsFor(className, sec) {
  const cls = String(className).toUpperCase().trim();
  if (cls === 'XI' || cls === 'XII') {
    const group = SENIOR_GROUPS.find((g) => g.sections.includes(String(sec).toUpperCase().trim()));
    if (!group) throw new Error(`No senior group configured for section "${sec}"`);
    return group.subjects.slice();
  }
  return FIXED_SUBJECTS_VI_TO_X.slice();
}

export function getGroupForSection(sec) {
  return SENIOR_GROUPS.find((g) => g.sections.includes(String(sec).toUpperCase().trim())) || null;
}

// ---------------------------------------------------------------------------
// EMIS conversion — ONLY applies to Class XI/XII, Weekly Test or Mid Term exams.
// ---------------------------------------------------------------------------

export const EMIS_CONVERSION_TO = {
  Language: 90, Tamil: 90, English: 90,
  Physics: 70, Chemistry: 70,
  'Bio-Botany': 35, 'Bio-Zoology': 35, Biology: 70,
  Mathematics: 90, 'Computer Science': 70,
  Economics: 90, Commerce: 90, Accountancy: 90,
  'Business Maths': 90, 'Business Mathematics': 90,
  'Basic Electrical - Theory': 90, 'BEE Theory': 90,
  'Basic Electrical - Practical': 75, 'BEE Practical': 75,
  'Employability Skills': 90, History: 90,
};

// Flat lookup by converted max — NOT a proportional recalculation of the
// school's own internal pass threshold. This was a real, previously-shipped bug.
export const EMIS_PASS_MARK = {
  Language: 25, Tamil: 25, English: 25,
  Physics: 15, Chemistry: 15,
  Mathematics: 25, 'Computer Science': 15,
  Economics: 25, Commerce: 25, Accountancy: 25,
  'Business Maths': 25, 'Business Mathematics': 25,
  'Basic Electrical - Theory': 25, 'BEE Theory': 25,
  'Basic Electrical - Practical': 20, 'BEE Practical': 20,
  'Employability Skills': 25, History: 25,
};

// Combined Bio-Botany + Bio-Zoology (35+35=70 theory), per the official Biology row.
export const EMIS_BIOLOGY_PASS_MARK = 15;

/** EMIS conversion applies only to Class XI/XII, exam name containing "Weekly Test" or "Mid Term" (case-insensitive). */
export function isEmisEligible(className, examName) {
  const cls = String(className).toUpperCase().trim();
  if (cls !== 'XI' && cls !== 'XII') return false;
  const name = String(examName).toLowerCase();
  return name.includes('weekly test') || name.includes('mid term');
}

/** Converts a raw as-entered mark to the EMIS scale for a given subject's max. Returns the raw mark unchanged if the subject has no conversion entry. */
export function convertToEmisScale(subjectKey, rawMark, rawMax) {
  const to = EMIS_CONVERSION_TO[subjectKey];
  if (to == null || !rawMax) return rawMark;
  return Math.round((Number(rawMark) / Number(rawMax)) * to * 100) / 100;
}

/**
 * Merges Bio-Botany + Bio-Zoology into a single "Biology" line for EMIS/rank-card
 * purposes. subjectMarks: array of { subject, mark, max }.
 * Returns a new array with the two half-papers replaced by one 'Biology' entry
 * (marks summed, using the fixed Biology pass mark), all other subjects untouched.
 */
export function mergeBiology(subjectMarks) {
  const botany = subjectMarks.find((s) => s.subject === 'Bio-Botany');
  const zoology = subjectMarks.find((s) => s.subject === 'Bio-Zoology');
  if (!botany && !zoology) return subjectMarks.slice();

  const rest = subjectMarks.filter((s) => s.subject !== 'Bio-Botany' && s.subject !== 'Bio-Zoology');
  const mark = (botany?.mark || 0) + (zoology?.mark || 0);
  const max = (botany?.max || 0) + (zoology?.max || 0);
  return [...rest, { subject: 'Biology', mark, max, passMark: EMIS_BIOLOGY_PASS_MARK }];
}

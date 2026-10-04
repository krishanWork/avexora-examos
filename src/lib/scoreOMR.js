// Scoring logic mirrored from the evaluateExamination backend function
export function computeGrade(pct) {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B+";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 33) return "D";
  return "F";
}

const round2 = (n) => Math.round(n * 100) / 100;

export function scoreSheet(examination, keyAnswers, responses) {
  const numQuestions = examination.num_questions || 50;
  const perQ = (examination.max_marks || 100) / numQuestions;
  const neg = examination.negative_marking ? (examination.negative_mark_value || 0) : 0;
  let correct = 0, wrong = 0, skipped = 0;
  for (let q = 1; q <= numQuestions; q++) {
    const given = responses?.[String(q)];
    const ans = keyAnswers?.[String(q)];
    if (!given) { skipped++; continue; }
    if (ans && given === ans) correct++;
    else wrong++;
  }
  const total = Math.max(0, correct * perQ - wrong * neg);
  const percentage = (total / (examination.max_marks || 100)) * 100;
  return {
    correct_count: correct,
    wrong_count: wrong,
    skipped_count: skipped,
    total_marks: round2(total),
    percentage: round2(percentage),
    grade: computeGrade(percentage),
  };
}

// Returns [{id, rank, percentile}] for results whose rank/percentile changed
export function rankUpdates(results) {
  const sorted = [...results].sort((a, b) => (b.total_marks || 0) - (a.total_marks || 0));
  const n = sorted.length;
  const updates = [];
  sorted.forEach((r, idx) => {
    const rank = idx + 1;
    const below = n - idx - 1;
    const percentile = n > 1 ? round2((below / (n - 1)) * 100) : 100;
    if (r.rank !== rank || r.percentile !== percentile) {
      updates.push({ id: r.id, rank, percentile });
    }
  });
  return updates;
}
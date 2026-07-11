
// Deterministic slug from task text (no Date/Math.random in workflow scripts).
function taskSlug(task) {
  const cleaned = String(task)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || 'feature-pipeline-task'
}

// FX-11: bound a categorizer segment to kebab-case + ≤maxWords words + ≤maxChars chars.
// Summarization is the LLM's job (prompt + schema); this is the deterministic safety net so a
// path segment can never become a raw task-text substring. Mirrors taskSlug's normalization.
function categorizeSlug(s, maxWords = 3, maxChars = 24) {
  const cleaned = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // collapse non-alphanumeric to hyphens
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
  const words = cleaned.split('-').filter(Boolean).slice(0, maxWords) // cap word count
  let out = words.join('-').slice(0, maxChars)
  out = out.replace(/-+$/g, '')     // re-trim after char cap
  return out || 'misc'
}

// Extract a JIRA ticket id (e.g. PROJ-123) from task text for planDir naming.
// No Date/Math.random — pure regex on the task string. Returns null if absent.
function jiraIdFromTask(task) {
  const match = String(task || '').match(/\b([A-Z][A-Z0-9_]+-\d+)\b/)
  return match ? match[1] : null
}

// Heuristic non-English detection for the translator gate: ratio of non-ASCII letters
// to total letters. No regex, no Date/Math.random — pure char-code scan. Returns
// {isEnglish, ratio}. Threshold 0.15 tolerates accents/quotes in otherwise-English text.
function detectNonEnglish(text) {
  let letters = 0
  let nonAsciiLetters = 0
  const str = String(text || '')
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      letters++ // ASCII A-Z / a-z
    } else if (c > 127) {
      nonAsciiLetters++ // any non-ASCII char counted as a potential non-English letter
      letters++
    }
  }
  const ratio = letters > 0 ? nonAsciiLetters / letters : 0
  return { isEnglish: letters === 0 || ratio < 0.15, ratio }
}

export { taskSlug, categorizeSlug, jiraIdFromTask, detectNonEnglish }

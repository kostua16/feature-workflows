
function extractJson(raw) {
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  for (const candidate of jsonCandidates(text)) {
    const parsed = parseJsonCandidate(candidate)
    if (parsed !== null) return parsed
  }
  return null
}

function parseJsonCandidate(candidate) {
  const variants = [candidate, repairJsonText(candidate)]
  for (const variant of variants) {
    try { return JSON.parse(variant) } catch (_) { /* continue */ }
  }
  return null
}

function jsonCandidates(text) {
  const candidates = [text]
  const fenceRegex = /```(?:json)?\s*([\s\S]+?)```/gi
  let fenceMatch
  while ((fenceMatch = fenceRegex.exec(text)) !== null) {
    candidates.push(fenceMatch[1].trim())
  }
  candidates.push(...braceCandidates(text))
  return candidates.filter((candidate, index) => candidate && candidates.indexOf(candidate) === index)
}

function braceCandidates(text) {
  const candidates = []
  const stack = []
  let start = -1
  let quote = ''
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char !== '{' && char !== '[' && char !== '}' && char !== ']') continue
    if (char === '{' || char === '[') {
      if (stack.length === 0) start = i
      stack.push(char)
      continue
    }
    const opener = stack[stack.length - 1]
    if ((char === '}' && opener === '{') || (char === ']' && opener === '[')) {
      stack.pop()
      if (stack.length === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  if (start >= 0 && stack.length) {
    const closers = stack.reverse().map((char) => char === '{' ? '}' : ']').join('')
    candidates.push(text.slice(start) + closers)
  }
  return candidates
}

function repairJsonText(text) {
  let repaired = String(text).trim()
  repaired = stripTrailingCommasOutsideStrings(repaired)
  repaired = replacePythonLiteralsOutsideStrings(repaired)
  repaired = normalizeSingleQuotedStrings(repaired)
  repaired = quoteBareKeysOutsideStrings(repaired)
  const openCurly = (repaired.match(/{/g) || []).length
  const closeCurly = (repaired.match(/}/g) || []).length
  const openSquare = (repaired.match(/\[/g) || []).length
  const closeSquare = (repaired.match(/]/g) || []).length
  if (openSquare > closeSquare) repaired += ']'.repeat(openSquare - closeSquare)
  if (openCurly > closeCurly) repaired += '}'.repeat(openCurly - closeCurly)
  return repaired
}

function stripTrailingCommasOutsideStrings(text) {
  let out = ''
  let quote = ''
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      out += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      out += char
      continue
    }
    if (char === ',') {
      let j = i + 1
      while (/\s/.test(text[j] || '')) j += 1
      if (text[j] === '}' || text[j] === ']') continue
    }
    out += char
  }
  return out
}

function replacePythonLiteralsOutsideStrings(text) {
  return rewriteOutsideStrings(text, (segment) =>
    segment.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')
  )
}

function quoteBareKeysOutsideStrings(text) {
  return rewriteOutsideStrings(text, (segment) =>
    segment.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
  )
}

function normalizeSingleQuotedStrings(text) {
  let out = ''
  let doubleQuote = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (doubleQuote) {
      out += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        doubleQuote = false
      }
      continue
    }
    if (char === '"') {
      doubleQuote = true
      out += char
      continue
    }
    if (char !== "'") {
      out += char
      continue
    }
    let value = ''
    i += 1
    for (; i < text.length; i++) {
      const inner = text[i]
      if (inner === '\\' && i + 1 < text.length) {
        const escapedChar = text[i + 1]
        value += (escapedChar === "'" || escapedChar === '"') ? escapedChar : `\\${escapedChar}`
        i += 1
      } else if (inner === "'") {
        break
      } else {
        value += inner
      }
    }
    out += JSON.stringify(value)
  }
  return out
}

function rewriteOutsideStrings(text, rewriteSegment) {
  let out = ''
  let segment = ''
  let quote = ''
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      out += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'") {
      out += rewriteSegment(segment)
      segment = ''
      quote = char
      out += char
      continue
    }
    segment += char
  }
  return out + rewriteSegment(segment)
}

export { extractJson, parseJsonCandidate, jsonCandidates, braceCandidates, repairJsonText, stripTrailingCommasOutsideStrings, replacePythonLiteralsOutsideStrings, quoteBareKeysOutsideStrings, normalizeSingleQuotedStrings, rewriteOutsideStrings }

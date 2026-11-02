'use strict';

// Reads and changes single keys in the port's Config.toml without touching the rest of the file (comments, order,
// other sections). Values: strings, booleans and numbers.

function sectionRange(lines, section) {
  const header = new RegExp(`^\\s*\\[\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]\\s*(#.*)?$`);
  const start = lines.findIndex(l => header.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

function keyPattern(key) {
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*)$`);
}

function parseValue(raw) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    let out = '';
    for (let i = 1; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') {
        const n = s[++i];
        if (n === 'u') {
          out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16));
          i += 4;
        } else {
          out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
        }
      } else if (c === '"') {
        return out;
      } else {
        out += c;
      }
    }
    return out;
  }
  if (s.startsWith("'")) return s.slice(1, s.indexOf("'", 1));
  const bare = s.replace(/\s+#.*$/, '');
  if (bare === 'true') return true;
  if (bare === 'false') return false;
  if (/^[+-]?\d+(\.\d+)?$/.test(bare)) return Number(bare);
  return bare;
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

function get(text, section, key) {
  const lines = String(text || '').split('\n');
  const range = sectionRange(lines, section);
  if (!range) return undefined;
  const pattern = keyPattern(key);
  for (let i = range.start + 1; i < range.end; i++) {
    const m = pattern.exec(lines[i]);
    if (m) return parseValue(m[1]);
  }
  return undefined;
}

function set(text, section, key, value) {
  const lines = String(text || '').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const line = `${key} = ${formatValue(value)}`;
  const range = sectionRange(lines, section);
  if (!range) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`[${section}]`, line);
    return lines.join('\n') + '\n';
  }
  const pattern = keyPattern(key);
  for (let i = range.start + 1; i < range.end; i++) {
    if (pattern.test(lines[i])) {
      lines[i] = line;
      return lines.join('\n') + '\n';
    }
  }
  // After the section's last non-blank line.
  let at = range.end;
  while (at > range.start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, line);
  return lines.join('\n') + '\n';
}

module.exports = { get, set };

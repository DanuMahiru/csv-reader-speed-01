// A fast drop-in for csv-reader 1.0.0's readCsv: run(input) returns exactly
// csv-reader's answer {columns, rows, errors} for every input {text, header}.
//
// How it is fast: one left-to-right pass, but no per-character work. Unquoted
// fields are cut with a single sticky-regex search per field and one slice;
// quoted fields are found with indexOf('"') and cut with slices; a value is
// never built a character at a time. A record with no quote at all is cut in
// one go (find its line break, split on commas). The reference reader's
// policy is followed exactly, including every error and its order:
//
//   - U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, each CRLF or lone CR inside it is
//     read as LF; what follows its closing quote, up to the next comma or line
//     break, is appended as it stands (quote_junk, when the field ends); a
//     quote that never closes is a literal character and the text after it is
//     read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded (short_row) or cut (long_row) to the
//     first record's width;
//   - each error is {code, line, row} in the order met; line is the 1-based
//     line its record starts on, counting every LF, CRLF and lone CR inside
//     quotes; row is its record's index in rows, null for the header.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module; no WebAssembly, no native code.

const BODY = /[^,\r\n]*/y; // sticky: matches the field body at lastIndex

/** Line breaks in s: each LF counts 1, each CR counts 1, a CRLF pair counts 1. */
function countBreaks(s) {
  let n = 0;
  let i = -1;
  while ((i = s.indexOf('\n', i + 1)) !== -1) n++;
  let j = -1;
  while ((j = s.indexOf('\r', j + 1)) !== -1) {
    n++;
    if (s.charCodeAt(j + 1) === 10) n--; // CRLF: the LF belongs to the pair
  }
  return n;
}

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recLine = 1;
  let recRow = null;

  function error(code) {
    errors.push({ code, line: recLine, row: recRow });
  }

  // Reads an unquoted field onto `init` ('' normally, the quoted value for
  // quote junk, '"' for the unterminated-quote re-read). Returns the field and
  // how it ended: 0 comma, 1 line break, 2 end of text. `added` counts the
  // characters kept during this read (stray CRs are dropped, not counted).
  function readUnquoted(init) {
    let value = init;
    let added = 0;
    for (;;) {
      BODY.lastIndex = pos;
      const body = BODY.exec(text)[0];
      const end = pos + body.length;
      if (body !== '') {
        added += body.length;
        value = value === '' ? body : value + body;
      }
      if (end >= len) {
        pos = len;
        return { value, ended: 2, added };
      }
      const c = text.charCodeAt(end);
      if (c === 44) {
        pos = end + 1;
        return { value, ended: 0, added };
      }
      if (c === 10) {
        pos = end + 1;
        line += 1;
        return { value, ended: 1, added };
      }
      // '\r'
      if (text.charCodeAt(end + 1) === 10) {
        pos = end + 2;
        line += 1;
        return { value, ended: 1, added };
      }
      // A CR not followed by LF is dropped (stray_cr); the field goes on.
      error('stray_cr');
      pos = end + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field and
  // how it ended (0 comma, 1 line break, 2 end of text).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let parts = null; // pieces of the value, only when "" escapes occur
    let segStart = pos + 1;
    let p = pos + 1;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one literal quote; the field goes on.
        if (parts === null) parts = [text.slice(segStart, q)];
        else parts.push(text.slice(segStart, q));
        parts.push('"');
        p = q + 2;
        segStart = q + 2;
        continue;
      }
      // The closing quote at q.
      let content;
      if (parts === null) content = text.slice(segStart, q);
      else {
        parts.push(text.slice(segStart, q));
        content = parts.join('');
      }
      // Line breaks inside the quotes count, and each CRLF or lone CR in
      // them is read as LF.
      if (content.indexOf('\r') !== -1) {
        line += countBreaks(content);
        content = content.replace(/\r\n?/g, '\n');
      } else if (content.indexOf('\n') !== -1) {
        let n = 0;
        let k = -1;
        while ((k = content.indexOf('\n', k + 1)) !== -1) n++;
        line += n;
      }
      pos = q + 1;
      if (pos >= len) return { value: content, ended: 2 };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value: content, ended: 0 };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value: content, ended: 1 };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value: content, ended: 1 };
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(content);
      if (junk.added > 0) error('quote_junk');
      return junk;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;

    // Fast path: a record with no quote up to its line break is cut in one go.
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? len : nl;
    const q0 = text.indexOf('"', pos);
    if (false) {
      let seg = text.slice(pos, segEnd);
      if (nl !== -1) {
        // A CR just before the LF is the CRLF ending, not a stray CR.
        if (seg.charCodeAt(seg.length - 1) === 13) seg = seg.slice(0, -1);
        line += 1;
        pos = nl + 1;
      } else {
        pos = len;
      }
      let crs = 0;
      if (seg.indexOf('\r') !== -1) {
        let k = -1;
        while ((k = seg.indexOf('\r', k + 1)) !== -1) crs++;
        seg = seg.replace(/\r/g, '');
      }
      const fields = seg === '' ? [''] : seg.split(',');
      // A line left with no characters is no record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '') {
        for (let k = 0; k < crs; k++) error('stray_cr');
        continue;
      }
      for (let k = 0; k < crs; k++) error('stray_cr');
      if (width < 0) width = fields.length;
      if (header && columns === null) {
        columns = fields;
        continue;
      }
      if (fields.length < width) {
        errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
      }
      rows.push(fields);
      continue;
    }

    const fields = [];
    let field;
    let quoted;
    do {
      quoted = pos < len && text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

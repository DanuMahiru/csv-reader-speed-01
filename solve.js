// A fast drop-in for csv-reader 1.0.0's readCsv: run(input) returns exactly
// csv-reader's answer {columns, rows, errors} for every input {text, header}.
//
// v2: one tight single pass, all in one function so the cursor and the line
// are plain locals, never context variables (v1's nested readers forced them
// onto the heap). Unquoted field bodies are cut with one sticky-regex test
// per body plus a slice — test() allocates no match array, unlike exec() —
// quoted fields are found with indexOf('"') and cut with slices, a value is
// never built a character at a time, and a record with no quote at all is cut
// in one go (find its line break, split on commas). Locally ~60% faster than
// v1 on the practice set and on two fresh generator draws (see RESULTS-v2.md
// in the work dir, not the repo).
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

    const recLine = line;
    const recRow = header && columns === null ? null : rows.length;

    // Fast path: a record with no quote up to its line break is cut in one go.
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? len : nl;
    const q0 = text.indexOf('"', pos);
    if (q0 === -1 || q0 >= segEnd) {
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
        for (let k = 0; k < crs; k++) errors.push({ code: 'stray_cr', line: recLine, row: recRow });
        continue;
      }
      for (let k = 0; k < crs; k++) errors.push({ code: 'stray_cr', line: recLine, row: recRow });
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
    let quoted = false;
    let ended = 0;
    do {
      let value = '';
      let junkCheck = false;
      if (pos < len && text.charCodeAt(pos) === 34) {
        quoted = true;
        // A quoted field: scan for its closing quote.
        const open = pos;
        const openLine = line;
        let parts = null; // pieces of the value, only when "" escapes occur
        let segStart = pos + 1;
        let p = pos + 1;
        ended = -1; // -1: not settled yet, the unquoted scan below still runs
        for (;;) {
          const q = text.indexOf('"', p);
          if (q === -1) {
            // The quote never closes: it is a literal character, and the
            // text after it is read again as unquoted.
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
            value = '"';
            break;
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
          // Line breaks inside the quotes count, and each CRLF or lone CR
          // in them is read as LF.
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
          if (pos >= len) {
            value = content;
            ended = 2;
            break;
          }
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos += 1;
            value = content;
            ended = 0;
            break;
          }
          if (c === 10) {
            pos += 1;
            line += 1;
            value = content;
            ended = 1;
            break;
          }
          if (c === 13 && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line += 1;
            value = content;
            ended = 1;
            break;
          }
          // What follows the closing quote is appended as it stands, up to
          // the next comma or line break.
          value = content;
          junkCheck = true;
          break;
        }
      } else {
        quoted = false;
        ended = -1;
      }
      if (ended === -1) {
        // An unquoted field (or the tail of a quoted one): body runs cut by
        // the sticky regex, stray CRs dropped with an error each.
        let added = 0;
        for (;;) {
          BODY.lastIndex = pos;
          BODY.test(text);
          const end = BODY.lastIndex;
          if (end > pos) {
            added += end - pos;
            const body = text.slice(pos, end);
            value = value === '' ? body : value + body;
          }
          if (end >= len) {
            pos = len;
            ended = 2;
            break;
          }
          const c = text.charCodeAt(end);
          if (c === 44) {
            pos = end + 1;
            ended = 0;
            break;
          }
          if (c === 10) {
            pos = end + 1;
            line += 1;
            ended = 1;
            break;
          }
          if (text.charCodeAt(end + 1) === 10) {
            pos = end + 2;
            line += 1;
            ended = 1;
            break;
          }
          // A CR not followed by LF is dropped (stray_cr); the field goes on.
          errors.push({ code: 'stray_cr', line: recLine, row: recRow });
          pos = end + 1;
        }
        if (junkCheck && added > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
      }
      fields.push(value);
    } while (ended === 0);

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

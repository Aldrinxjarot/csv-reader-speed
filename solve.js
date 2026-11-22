// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's {columns, rows, errors} for every
// input, but reads the text in spans instead of a character at a time. The reading policy is csv-reader's own,
// followed branch for branch:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote, and each
//     CRLF or lone CR inside it read as LF; what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when any of it is kept); a quote that never closes is a literal character,
//     and the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it (every record
//     when header is false), each padded with "" (short_row, with fields: its count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met: line the 1-based line its record starts on (every LF, CRLF
//     and lone CR inside a quoted field counted), row its record's index in rows, null for the header.
//
// Where the reference builds each field a character at a time, this reader finds each field's end first and slices
// it out whole: unquoted fields are scanned for the next comma or line break, quoted fields for the next quote via
// indexOf, and only a stray CR inside an unquoted field (rare) splits a field into pieces that are joined once. A
// field's result is handed back through shared slots (fValue, fEnded, fAdded), not a fresh object per field.

const COMMA = 0; // the field ended at a comma: the record goes on
const LINE_BREAK = 1; // the field ended at a line break: the record ends
const END = 2; // the field ended at the end of the text: the record ends

/** csv-reader 1.0.0's answer for one case's input {text, header}, read faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field last read, handed back through these slots: its value, how it ended, the characters kept.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Sets fValue, fEnded and fAdded (the characters kept).
  function readUnquoted(value) {
    let seg = pos; // the start of the piece of the field not yet taken
    let i = pos;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44 || c === 10) {
        // ',' or LF: the field ends here.
        pos = i + 1;
        if (c === 10) line += 1;
        fAdded = i - seg;
        fValue = value + text.slice(seg, i);
        fEnded = c === 44 ? COMMA : LINE_BREAK;
        return;
      }
      if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) {
          // CRLF: the field ends here.
          pos = i + 2;
          line += 1;
          fAdded = i - seg;
          fValue = value + text.slice(seg, i);
          fEnded = LINE_BREAK;
          return;
        }
        // A CR not followed by LF is dropped (stray_cr): the field is split here and goes on in pieces.
        const parts = [text.slice(seg, i)];
        let added = i - seg;
        error('stray_cr');
        i += 1;
        seg = i;
        while (i < n) {
          const c2 = text.charCodeAt(i);
          if (c2 === 44 || c2 === 10) {
            pos = i + 1;
            if (c2 === 10) line += 1;
            added += i - seg;
            parts.push(text.slice(seg, i));
            fAdded = added;
            fValue = value + parts.join('');
            fEnded = c2 === 44 ? COMMA : LINE_BREAK;
            return;
          }
          if (c2 === 13) {
            if (text.charCodeAt(i + 1) === 10) {
              pos = i + 2;
              line += 1;
              added += i - seg;
              parts.push(text.slice(seg, i));
              fAdded = added;
              fValue = value + parts.join('');
              fEnded = LINE_BREAK;
              return;
            }
            parts.push(text.slice(seg, i));
            added += i - seg;
            error('stray_cr');
            i += 1;
            seg = i;
            continue;
          }
          i += 1;
        }
        pos = n;
        added += n - seg;
        parts.push(text.slice(seg, n));
        fAdded = added;
        fValue = value + parts.join('');
        fEnded = END;
        return;
      }
      i += 1;
    }
    pos = n;
    fAdded = n - seg;
    fValue = value + text.slice(seg, n);
    fEnded = END;
  }

  // Takes one piece of a quoted field's text: inside quotes each CRLF or lone CR is read as LF and counts as a
  // line, as does each LF. Returns the piece as read and counts its lines.
  function quotedPiece(piece) {
    if (piece.indexOf('\r') === -1) {
      let i = piece.indexOf('\n');
      if (i !== -1) {
        line += 1;
        while ((i = piece.indexOf('\n', i + 1)) !== -1) line += 1;
      }
      return piece;
    }
    const read = piece.replace(/\r\n|\r/g, '\n');
    let i = read.indexOf('\n');
    if (i !== -1) {
      line += 1;
      while ((i = read.indexOf('\n', i + 1)) !== -1) line += 1;
    }
    return read;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue, fEnded and fAdded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let seg = pos; // the start of the piece of the field not yet taken
    let parts = null; // the pieces taken so far, split at doubled quotes
    let value;
    while (true) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one literal quote, and the field goes on.
        if (parts === null) parts = [];
        parts.push(quotedPiece(text.slice(seg, q)), '"');
        pos = q + 2;
        seg = pos;
        continue;
      }
      // The closing quote.
      const last = quotedPiece(text.slice(seg, q));
      value = parts === null ? last : parts.join('') + last;
      pos = q + 1;
      break;
    }
    fAdded = value.length;
    if (pos >= n) {
      fValue = value;
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(value);
    if (fAdded > 0) error('quote_junk');
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// Wildcard options are long sentences, so the editor shows each one in its own field. The
// API stores a plain string[]; these helpers convert between that, the bulk one-per-line text,
// and the field list (which needs stable ids so React keeps focus when rows move).

export interface OptionRow {
  id: number;
  text: string;
}

let nextId = 1;
export const newRow = (text = ""): OptionRow => ({ id: nextId++, text });

export const optionsToText = (options: string[]) => options.join("\n");

export const textToOptions = (text: string) =>
  text
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);

/** Rows for editing; always at least one so there is somewhere to type. */
export const toRows = (options: string[]): OptionRow[] =>
  options.length ? options.map((o) => newRow(o)) : [newRow()];

export const fromRows = (rows: OptionRow[]) => textToOptions(rows.map((r) => r.text).join("\n"));

/**
 * Apply an edit to row `index`. A newline (Enter, or a multi-line paste) splits the row: the
 * first line stays, each further line becomes a new row below it. Returns the new rows and the
 * index of the row that should take focus.
 */
export function editRow(rows: OptionRow[], index: number, value: string) {
  const [first, ...rest] = value.split(/\r?\n/);
  const out = rows.slice();
  out[index] = { ...rows[index], text: first };
  if (!rest.length) return { rows: out, focus: index };
  out.splice(index + 1, 0, ...rest.map((t) => newRow(t)));
  return { rows: out, focus: index + rest.length };
}

export function removeRow(rows: OptionRow[], index: number) {
  const out = rows.filter((_, i) => i !== index);
  return out.length ? out : [newRow()];
}

/**
 * CSV writing.
 *
 * Its own module, free of Firebase imports, so the quoting rules can be
 * tested directly — quoting is exactly the part that silently corrupts a
 * municipal spreadsheet when a Greek street name contains a comma.
 */

/**
 * RFC 4180 serialisation.
 * @param {object[]} rows
 * @param {Array<{key?:string, label?:string, value?:(row:object)=>unknown}>} columns
 */
export function toCsv(rows, columns) {
  const escape = (value) => {
    if (value == null) return '';
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label ?? c.key)).join(',');
  const body = (rows || []).map((row) => columns.map((c) => escape(
    typeof c.value === 'function' ? c.value(row) : row[c.key]
  )).join(',')).join('\r\n');
  // A BOM keeps Greek street names readable when the file is opened in Excel.
  return `﻿${header}\r\n${body}\r\n`;
}

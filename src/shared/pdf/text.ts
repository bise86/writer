export type Line = {text: string; start: number; end: number};

export function wrapPdfText(
  text: string,
  width: number,
  measure: (text: string) => number,
  offset = 0,
): Line[] {
  const lines: Line[] = [];
  let line = '';
  let start = offset;
  let position = offset;
  let lineWidth = 0;
  for (const char of text) {
    if (char === '\r') {
      position += 1;
      continue;
    }
    if (char === '\n') {
      lines.push({text: line, start, end: position});
      line = '';
      lineWidth = 0;
      start = ++position;
      continue;
    }
    const charWidth = measure(char);
    if (line && lineWidth + charWidth > width) {
      lines.push({text: line, start, end: position});
      line = '';
      lineWidth = 0;
      start = position;
    }
    line += char;
    lineWidth += charWidth;
    position += char.length;
  }
  if (line) {
    lines.push({text: line, start, end: position});
  }
  return lines;
}

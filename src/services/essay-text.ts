export function essayParagraphs(text: string) {
  return [...text.matchAll(/[^\r\n]+/g)]
    .filter(
      match => match[0].trim() && !/^【第\s*\d+\s*页】$/.test(match[0].trim()),
    )
    .map((match, index) => {
      const content = match[0].trim();
      const start = match.index! + match[0].indexOf(content);
      return {
        index: index + 1,
        text: content,
        start,
        end: start + content.length,
      };
    });
}

/** Only use a recognizable title line; never invent a title from the body. */
export function recognizedTitle(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const candidate = lines.find(
    line =>
      !/^(【第\s*\d+\s*页】|第\s*\d+\s*页|姓名[：:]|班级[：:]|学号[：:])/.test(
        line,
      ),
  );
  if (!candidate) {
    return '';
  }
  const explicit = candidate.match(/^(?:作文标题|标题|题目)[：:]\s*(.+)$/)?.[1];
  const title = (explicit || candidate).replace(/^《(.+)》$/, '$1').trim();
  if (
    !title ||
    title.length > 40 ||
    (!explicit && /[，。！？；,!?;]/.test(title))
  ) {
    return '';
  }
  return title;
}

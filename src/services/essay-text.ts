import type {ScoreResult} from '../types';

function contentLines(text: string) {
  return [...text.matchAll(/[^\r\n]+/g)]
    .filter(
      match => match[0].trim() && !/^【第\s*\d+\s*页】$/.test(match[0].trim()),
    )
    .map(match => {
      const content = match[0].trim();
      const start = match.index! + match[0].indexOf(content);
      return {
        text: content,
        start,
        end: start + content.length,
      };
    });
}

const isSalutation = (text: string) => /^Dear[ \t]+[^!?;\r\n]{1,80}[,，:]$/i.test(text);
const looksLikeUnmarkedChineseTitle = (text: string) =>
  /^[\u3400-\u9fff《》、·“”‘’\s]{1,40}$/.test(text);

function hasBlankLineAfter(text: string, line: {end: number}) {
  return /^[ \t]*\r?\n[ \t]*(?:\r?\n|$)/.test(text.slice(line.end));
}

/** Only use a recognizable title line; never invent a title from the body. */
function titleLine(text: string) {
  const lines = contentLines(text);
  const candidate = lines.find(
    line =>
      !/^(【第\s*\d+\s*页】|第\s*\d+\s*页|姓名[：:]|班级[：:]|学号[：:])/.test(
        line.text,
      ),
  );
  if (!candidate) {
    return undefined;
  }
  const explicit = candidate.text.match(
    /^(?:作文标题|标题|题目|Title)[：:]\s*(.+)$/i,
  )?.[1];
  const title = (explicit || candidate.text).replace(/^《(.+)》$/, '$1').trim();
  if (
    !title ||
    title.length > 40 ||
    (!explicit &&
      !/^《(.+)》$/.test(candidate.text) &&
      !hasBlankLineAfter(text, candidate) &&
      !looksLikeUnmarkedChineseTitle(candidate.text)) ||
    (!explicit && (isSalutation(title) || /[，。！？；.,!?;]/.test(title)))
  ) {
    return undefined;
  }
  return {...candidate, title};
}

export function recognizedTitle(text: string) {
  return titleLine(text)?.title || '';
}

/** Title offsets are retained for annotations, but body numbering starts at 1. */
export function essaySections(text: string) {
  const title = titleLine(text);
  const lines = contentLines(text);
  const firstBodyLine = lines.find(line => line.start !== title?.start);
  let bodyIndex = 0;
  return lines.map(line => {
    const isTitle = line.start === title?.start;
    const salutation = line === firstBodyLine && isSalutation(line.text);
    return {
      ...line,
      kind: isTitle ? ('title' as const) : salutation ? ('salutation' as const) : ('paragraph' as const),
      index: isTitle || salutation ? 0 : ++bodyIndex,
    };
  });
}

export function essayParagraphs(text: string) {
  return essaySections(text).filter(section => section.kind === 'paragraph');
}

export function sectionLabel(
  section: ReturnType<typeof essaySections>[number],
) {
  return section.kind === 'title' ? '标题' : section.kind === 'salutation' ? '称呼' : `第 ${section.index} 段`;
}

function normalizeSalutationReviews(score: ScoreResult, text: string): ScoreResult {
  const oldBody = essaySections(text).filter(section => section.kind !== 'title');
  const salutationIndex = oldBody.findIndex(section => section.kind === 'salutation') + 1;
  if (!salutationIndex || score.salutationFeedback) {
    return score;
  }
  const reviews = score.paragraphReviews || [];
  const salutation = reviews.find(item => item.paragraphIndex === salutationIndex);
  return {
    ...score,
    salutationFeedback: salutation && {
      strengths: salutation.strengths,
      weaknesses: salutation.weaknesses,
      improvements: salutation.improvements,
    },
    paragraphReviews: reviews.filter(item => item.paragraphIndex !== salutationIndex)
      .map(item => ({...item, paragraphIndex: item.paragraphIndex > salutationIndex ? item.paragraphIndex - 1 : item.paragraphIndex})),
  };
}

/** Old saved scores numbered the title as paragraph 1. Adapt without rescoring
 * or rewriting the original essay, quotes, or stored feedback. */
export function normalizeSavedParagraphReviews(
  score: ScoreResult,
  text: string,
): ScoreResult {
  if (score.paragraphIndexing === 'body-v2') {
    return score;
  }
  if (score.paragraphIndexing === 'body-v1') {
    // v1 excluded titles but still counted a letter salutation as paragraph 1.
    const adapted = normalizeSalutationReviews(score, text);
    return adapted === score ? score : {...adapted, paragraphIndexing: 'body-v2'};
  }
  const sections = essaySections(text);
  const titlePosition = sections.findIndex(section => section.kind === 'title');
  if (titlePosition < 0) {
    return normalizeSalutationReviews({...score, paragraphIndexing: 'body-v1'}, text);
  }
  const reviews = score.paragraphReviews || [];
  const titleReview = reviews.find(
    item => item.paragraphIndex === titlePosition + 1,
  );
  return normalizeSalutationReviews({
    ...score,
    paragraphIndexing: 'body-v1',
    titleFeedback:
      score.titleFeedback ||
      (titleReview
        ? {
            strengths: titleReview.strengths,
            weaknesses: titleReview.weaknesses,
            improvements: titleReview.improvements,
          }
        : undefined),
    paragraphReviews: reviews
      .filter(item => item.paragraphIndex !== titlePosition + 1)
      .map(item => ({
        ...item,
        paragraphIndex:
          item.paragraphIndex > titlePosition + 1
            ? item.paragraphIndex - 1
            : item.paragraphIndex,
      })),
  }, text);
}

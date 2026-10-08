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
    /^(?:作文标题|标题|题目)[：:]\s*(.+)$/,
  )?.[1];
  const title = (explicit || candidate.text).replace(/^《(.+)》$/, '$1').trim();
  if (
    !title ||
    title.length > 40 ||
    (!explicit && /[，。！？；,!?;]/.test(title))
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
  let bodyIndex = 0;
  return contentLines(text).map(line => {
    const isTitle = line.start === title?.start;
    return {
      ...line,
      kind: isTitle ? ('title' as const) : ('paragraph' as const),
      index: isTitle ? 0 : ++bodyIndex,
    };
  });
}

export function essayParagraphs(text: string) {
  return essaySections(text).filter(section => section.kind === 'paragraph');
}

export function sectionLabel(
  section: ReturnType<typeof essaySections>[number],
) {
  return section.kind === 'title' ? '标题' : `第 ${section.index} 段`;
}

/** Old saved scores numbered the title as paragraph 1. Adapt without rescoring
 * or rewriting the original essay, quotes, or stored feedback. */
export function normalizeSavedParagraphReviews(
  score: ScoreResult,
  text: string,
): ScoreResult {
  if (score.paragraphIndexing === 'body-v1') {
    return score;
  }
  const sections = essaySections(text);
  const titlePosition = sections.findIndex(section => section.kind === 'title');
  if (titlePosition < 0) {
    return {...score, paragraphIndexing: 'body-v1'};
  }
  const reviews = score.paragraphReviews || [];
  const titleReview = reviews.find(
    item => item.paragraphIndex === titlePosition + 1,
  );
  return {
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
  };
}

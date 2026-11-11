import {ChallengeSubject, SubjectEvidence, SubjectTitleGuess} from './types';

const titles: Record<
  Exclude<ChallengeSubject, 'other'>,
  {name: string; pattern: RegExp}
> = {
  math: {name: '数学', pattern: /数学|mathematics|\bmath\b/i},
  english: {name: '英语', pattern: /英语|英文|english/i},
  chinese: {name: '语文', pattern: /语文|chinese/i},
  physics: {name: '物理', pattern: /物理|physics/i},
  chemistry: {name: '化学', pattern: /化学|chemistry/i},
  biology: {name: '生物', pattern: /生物|biology/i},
  history: {name: '历史', pattern: /历史|history/i},
  geography: {name: '地理', pattern: /地理|geography/i},
  politics: {
    name: '道德与法治/思想政治',
    pattern: /政治|道德与法治|思想品德|politics|civics/i,
  },
  science: {
    name: '科学',
    pattern: /科学|理综|理科综合|理化合卷|物理化学合卷|science/i,
  },
};

export function titleSupportsSubject(
  subject: ChallengeSubject,
  courseName: string,
  evidence: SubjectEvidence[],
) {
  const text = evidence.map(ref => ref.quote).join('\n');
  return subject === 'other'
    ? !!courseName.trim() &&
        text
          .normalize('NFKC')
          .toLowerCase()
          .includes(courseName.normalize('NFKC').toLowerCase())
    : !!titles[subject]?.pattern.test(text);
}

/** A title-only provisional identification, never inferred from file names. */
export function guessSubjectFromTitle(
  evidence: SubjectEvidence[],
): SubjectTitleGuess | undefined {
  if (!evidence.length) {return undefined;}
  const text = evidence.map(ref => ref.quote).join('\n');
  const compound = text.match(/物理化学合卷|理科综合|理化合卷|理综/);
  if (
    compound &&
    ![titles.math, titles.english, titles.chinese].some(item =>
      item.pattern.test(text),
    )
  ) {
    return {
      subject: 'science',
      courseName: compound[0],
      evidence: evidence.map(ref => ({...ref})),
    };
  }
  const matches = (
    Object.entries(titles) as [
      Exclude<ChallengeSubject, 'other'>,
      typeof titles.math,
    ][]
  ).filter(([, item]) => item.pattern.test(text));
  if (matches.length === 1) {
    const [subject, item] = matches[0];
    // Use a course name actually present in a politics title where possible.
    const name =
      subject === 'politics'
        ? text.match(/道德与法治|思想政治|思想品德|政治/)?.[0] || '政治'
        : item.name;
    return {
      subject,
      courseName: name,
      evidence: evidence.map(ref => ({...ref})),
    };
  }
  if (!matches.length) {
    const other = [
      ...new Set(
        text.match(
          /信息科技|信息技术|通用技术|美术|音乐|体育与健康|劳动|艺术/g,
        ) || [],
      ),
    ];
    if (other.length === 1)
      {return {
        subject: 'other',
        courseName: other[0],
        evidence: evidence.map(ref => ({...ref})),
      };}
  }
  return undefined;
}

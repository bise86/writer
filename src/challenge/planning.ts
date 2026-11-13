import {questionGenerationOrder, questionSuccessorIds} from './generation';
import {isReasoningQuestion, isWritingQuestion} from './rules';
import {challengeCoverage, requiredRetentionIds} from './selection';
import type {ChallengeLevel, ExamAnalysis} from './types';

/** Choose only the remaining upgrade work, without a model selection request.
 * A changed prerequisite requires its descendants to be selected too. Choosing
 * small successor-closed groups avoids rewriting questions that stay original. */
export function selectUpgradeQuestions(
  analysis: ExamAnalysis,
  level: ChallengeLevel,
  state: {
    upgradedQuestionIds?: readonly string[];
    attemptedQuestionIds?: readonly string[];
    pendingQuestionIds?: readonly string[];
  } = {},
): string[] {
  const forced = requiredRetentionIds(analysis);
  const eligible = questionGenerationOrder(
    analysis,
    analysis.questions
      .filter(question => !forced.has(question.id))
      .map(question => question.id),
  ).orderedIds;
  const allowed = new Set(eligible);
  const upgraded = new Set(
    (state.upgradedQuestionIds || []).filter(id => allowed.has(id)),
  );
  const attempted = new Set(state.attemptedQuestionIds || []);
  const pending = new Set(
    (state.pendingQuestionIds || []).filter(id => allowed.has(id)),
  );
  const declined = new Set(
    [...attempted].filter(id => !upgraded.has(id) && !pending.has(id)),
  );
  // Existing variants may come from an older, interrupted whole-paper queue.
  // Finish only their necessary descendants, plus explicitly invalidated work.
  for (const id of questionSuccessorIds(analysis, [...upgraded, ...pending])) {
    if (allowed.has(id) && !attempted.has(id) && !upgraded.has(id)) {
      pending.add(id);
    }
  }
  const target = challengeCoverage(analysis, level).required;
  const children = new Map(
    analysis.questions.map(question => [question.id, new Set<string>()]),
  );
  for (const question of analysis.questions) {
    for (const dependency of question.dependsOnQuestionIds || []) {
      children.get(dependency)?.add(question.id);
    }
  }
  const plannedCount = () => new Set([...upgraded, ...pending]).size;
  const questions = new Map(
    analysis.questions.map(question => [question.id, question]),
  );
  const positions = new Map(
    analysis.questions.map((question, index) => [question.id, index]),
  );
  const priority = (id: string, sections: Set<string>, points: Set<string>) => {
    const candidate = questions.get(id)!;
    return [
      isWritingQuestion(candidate) ? 1 : 0,
      sections.has(candidate.sectionId) ? 0 : 1,
      new Set(candidate.knowledgePoints.filter(point => !points.has(point)))
        .size,
      isReasoningQuestion(candidate) ? 1 : 0,
      -positions.get(id)!,
    ];
  };
  while (plannedCount() < target) {
    const covered = new Set([...upgraded, ...pending]);
    const coveredQuestions = [...covered].map(id => questions.get(id)!);
    const sections = new Set(
      coveredQuestions.map(question => question.sectionId),
    );
    const points = new Set(
      coveredQuestions.flatMap(question => question.knowledgePoints),
    );
    let best: string | undefined;
    let bestPriority: number[] | undefined;
    for (const id of eligible) {
      if (covered.has(id) || declined.has(id)) {
        continue;
      }
      // A parent enters only after all its dependent questions are already in
      // the plan; originals and previously declined children keep it frozen.
      if ([...children.get(id)!].some(child => !covered.has(child))) {
        continue;
      }
      const score = priority(id, sections, points);
      const difference = score.findIndex(
        (value, index) => value !== bestPriority?.[index],
      );
      if (
        !best ||
        (difference >= 0 && score[difference] > bestPriority![difference])
      ) {
        best = id;
        bestPriority = score;
      }
    }
    if (!best) {
      break;
    }
    pending.add(best);
  }
  return eligible.filter(id => pending.has(id));
}

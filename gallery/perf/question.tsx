/**
 * The question page: one production question card (`QuestionForm`) asking a
 * single-choice question with `size` options, each with a description and a
 * preview, in a message-width column. Its answers go nowhere.
 */
import { QuestionForm } from "../../src/app/question/question-form.tsx";
import type { Question } from "../../src/app/question/question-form-state.ts";
import { QUESTION_CARD_CLASS } from "../../src/app/question/question-presentation.tsx";
import type { PerfPage } from "./main.tsx";

export const questionPage: PerfPage = (size) => {
  const question: Question = {
    id: "fixture",
    shortLabel: "Layout",
    prompt: "Which summary should lead the release review?",
    details:
      "The reviewer compares the result, the checks that ran, and the work still awaiting a decision.\n\n- The summary must fit a narrow message pane.\n- Long paths such as `packages/release-tools/src/reports/quarterly-release-summary.tsx` stay readable.",
    multiSelect: false,
    allowFreeText: true,
    options: Array.from({ length: size }, (_, index) => ({
      value: `option-${index}`,
      label: `Summary layout ${index + 1}`,
      description:
        "Lead with the goal, then keep the essential review steps together so the reviewer reads the change before the longer report.",
      preview: `Release summary ${index + 1}\n  Goal: prepared a release report\n  Review\n    Read the narrow-pane report\n    Check long package paths`,
    })),
  };
  const questions = [question];
  return () => (
    <main className="perf-question" data-bb-plugin="workstreams">
      <div className={QUESTION_CARD_CLASS}>
        <QuestionForm
          questions={questions}
          disabled={false}
          cancelDisabled={false}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      </div>
    </main>
  );
};

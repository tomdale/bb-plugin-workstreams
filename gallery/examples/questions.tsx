import { useState } from "react";
import { Button } from "../../components/ui/button";
import { QuestionHistoryCard } from "../../src/app/question/QuestionHistory";
import { QuestionForm } from "../../src/app/question/question-form";
import type {
  Question,
  QuestionAnswer,
} from "../../src/app/question/question-form-state";
import { QUESTION_CARD_CLASS } from "../../src/app/question/question-presentation";
import type { QuestionHistory } from "../../src/server/questions/history";
import {
  GalleryControls,
  GalleryNotes,
  LiveExample,
  Variant,
  Variants,
} from "../ExampleFrame";
import type { GalleryExample } from "../examples";

const questionOptions = [
  {
    value: "compact",
    label: "Compact summary",
    description: "Keep the goal and essential review steps.",
    preview: "Release summary\n  Goal\n  Review steps",
  },
  {
    value: "full",
    label: "Full summary",
    description: "Include results beside the review steps.",
    preview: "Release summary\n  Goal\n  Done\n  Review steps",
  },
] as const;

const layoutQuestion: Question = {
  id: "gallery-layout",
  shortLabel: "Layout",
  prompt: "Which summary should we preview?",
  details: "Compare the compact and full summary layouts before choosing one.",
  multiSelect: false,
  allowFreeText: false,
  options: questionOptions,
};

const freeformQuestion: Question = {
  id: "gallery-context",
  shortLabel: "Context",
  prompt: "What should the release summary explain?",
  details: "Describe the reader and the decision they need to make.",
  multiSelect: false,
  allowFreeText: true,
  options: [],
};

const longQuestion: Question = {
  ...layoutQuestion,
  prompt: "Which summary should lead a release review across several packages?",
  details: `The reviewer needs to compare the result, the checks that ran, and the work still awaiting a decision. Keep each qualification beside the claim it limits.\n\n- The summary must fit a narrow message pane.\n- Long paths such as \`packages/release-tools/src/reports/quarterly-release-summary.tsx\` should remain readable.\n- Package owners need the receipt and discount changes reviewed together.`,
  options: [
    {
      ...questionOptions[0],
      description:
        "Lead with the goal, then keep the essential review steps together. The reviewer can read the proposed change before deciding whether to inspect the longer report.",
      preview: `Release summary\n  Goal: prepared a release report\n  Review\n    Read the narrow-pane report\n    Check long package paths\n    Confirm the release scope\n\n  Qualification\n    Payment integration awaits review\n    Deployment still needs approval`,
    },
    {
      ...questionOptions[1],
      description:
        "Show results and their qualifications beside the review steps. This uses more vertical space but keeps the context available while the reader compares the report.",
      preview: `Release summary\n  Goal: prepared a release report\n  Done\n    Report composition\n      packages/release-tools/src/reports/quarterly-release-summary.tsx\n    Review instructions\n      Keep qualifications beside each result\n  Review\n    Open the report in a narrow pane\n    Read all package paths\n    Compare the supporting details\n\n  Limits\n    Payment integration awaits review\n    Deployment needs approval`,
    },
    {
      value: "by-package",
      label: "Group by package",
      description:
        "Keep each package's result and review instructions together. Useful when separate reviewers own the release tools, shared components, and documentation.",
      preview:
        "Release tools\n  Result\n  Review steps\n\nShared components\n  Result\n  Review steps\n\nDocumentation\n  Result\n  Review steps",
    },
    {
      value: "by-stage",
      label: "Group by stage",
      description:
        "Read preparation, verification, and deployment in sequence. Keep pending approval visible so preparation cannot be mistaken for a completed release.",
      preview:
        "Preparation\n  Report drafted\nVerification\n  Awaiting review\nDeployment\n  Awaiting approval",
    },
  ],
};

type Preset = "options" | "freeform" | "mixed" | "questions" | "long";
type FormState =
  "ready" | "disabled" | "submitting" | "cancel-disabled" | "error";

function questionsFor(preset: Preset, multiple: boolean): Question[] {
  const layout = {
    ...layoutQuestion,
    multiSelect: multiple,
    prompt: multiple
      ? "Which summaries should we preview?"
      : layoutQuestion.prompt,
  };
  switch (preset) {
    case "freeform":
      return [freeformQuestion];
    case "mixed":
      return [{ ...layout, allowFreeText: true }];
    case "questions":
      return [
        layout,
        freeformQuestion,
        {
          id: "gallery-checks",
          shortLabel: "Checks",
          prompt: "Which checks should the summary include?",
          multiSelect: true,
          allowFreeText: true,
          options: [
            { value: "keyboard", label: "Keyboard selection" },
            { value: "wrapping", label: "Long path wrapping" },
          ],
        },
      ];
    case "long":
      return [{ ...longQuestion, multiSelect: multiple }];
    default:
      return [layout];
  }
}

function historyRecord(status: QuestionHistory["status"]): QuestionHistory {
  return {
    id: `gallery-history-${status}`,
    at: null,
    status,
    payload: {
      questions: [layoutQuestion, freeformQuestion].map((question) => ({
        ...question,
        options: [...question.options],
      })),
    },
    result:
      status === "answered"
        ? {
            questions: [layoutQuestion, freeformQuestion].map((question) => ({
              question: question.prompt,
              header: question.shortLabel,
              multiSelect: question.multiSelect,
              options: question.options.map((option) => ({
                label: option.label,
                description: option.description ?? "",
                preview: option.preview,
              })),
            })),
            answers: {
              [layoutQuestion.prompt]: "Compact summary",
              [freeformQuestion.prompt]: "Explain the remaining review steps.",
            },
            submission: {
              answers: {
                [layoutQuestion.id]: {
                  selected: ["compact"],
                  freeText: "Keep the qualification beside the result.",
                },
                [freeformQuestion.id]: {
                  selected: [],
                  freeText: "Explain the remaining review steps.",
                },
              },
            },
          }
        : null,
  };
}

type FormVariant = {
  label: string;
  preset: Preset;
  multiple?: boolean;
  state?: FormState;
  wide?: boolean;
  note?: string;
};

const formVariants: readonly FormVariant[] = [
  { label: "Single choice", preset: "options" },
  { label: "Multiple choices", preset: "options", multiple: true },
  { label: "Freeform only", preset: "freeform" },
  { label: "Options and freeform", preset: "mixed" },
  { label: "Multiple questions", preset: "questions", wide: true },
  { label: "Long details and previews", preset: "long", wide: true },
  {
    label: "All actions disabled",
    preset: "options",
    state: "disabled",
    note: "Cancel and Submit are both disabled.",
  },
  {
    label: "Submitting",
    preset: "options",
    state: "submitting",
    note: "Submit shows Submitting…; Cancel stays available.",
  },
  {
    label: "Cancel disabled",
    preset: "options",
    state: "cancel-disabled",
    note: "Only Cancel is disabled; Submit stays available.",
  },
  {
    label: "Submit error",
    preset: "options",
    state: "error",
    note: "An error message sits beside Cancel.",
  },
];

const historyVariants: readonly {
  label: string;
  status: QuestionHistory["status"];
}[] = [
  { label: "History, answered", status: "answered" },
  { label: "History, dismissed", status: "dismissed" },
  { label: "History, pending", status: "pending" },
  { label: "History, answer unavailable", status: "unknown" },
];

function QuestionExample() {
  const [reset, setReset] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const submit = (
    questions: readonly Question[],
    answers: Record<string, QuestionAnswer>,
  ) => {
    const labels = questions.flatMap((question) => {
      const answer = answers[question.id];
      if (!answer) return [];
      return [
        ...question.options
          .filter((item) => answer.selected.includes(item.value))
          .map((item) => item.label),
        ...(answer.freeText ? [answer.freeText] : []),
      ];
    });
    setResult(`Answer: ${labels.join(", ")}`);
  };
  return (
    <div className="space-y-5">
      <GalleryControls label="Question forms">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setReset(reset + 1);
            setResult("Form reset");
          }}
        >
          Reset form
        </Button>
      </GalleryControls>
      <LiveExample
        name="QuestionForm"
        sources={[
          "src/app/question/question-form.tsx",
          "src/app/question/question-presentation.tsx",
        ]}
      >
        <Variants>
          {formVariants.map((variant) => {
            const questions = questionsFor(
              variant.preset,
              variant.multiple ?? false,
            );
            const state = variant.state ?? "ready";
            return (
              <Variant
                key={variant.label}
                label={variant.label}
                wide={variant.wide}
                note={variant.note}
              >
                <div className={QUESTION_CARD_CLASS}>
                  <QuestionForm
                    key={`${variant.label}-${reset}`}
                    questions={questions}
                    disabled={state === "disabled" || state === "submitting"}
                    cancelDisabled={
                      state === "disabled" || state === "cancel-disabled"
                    }
                    error={
                      state === "error"
                        ? "Couldn’t submit the answer. Try again."
                        : null
                    }
                    onSubmit={(answers) => submit(questions, answers)}
                    onCancel={() => {
                      setReset(reset + 1);
                      setResult("Answer cancelled");
                    }}
                  />
                </div>
              </Variant>
            );
          })}
        </Variants>
      </LiveExample>
      <LiveExample
        name="QuestionHistoryCard"
        sources={["src/app/question/QuestionHistory.tsx"]}
      >
        <Variants>
          {historyVariants.map((variant) => (
            <Variant key={variant.status} label={variant.label}>
              <QuestionHistoryCard
                key={`${variant.status}-${reset}`}
                record={historyRecord(variant.status)}
              />
            </Variant>
          ))}
        </Variants>
      </LiveExample>
      {result && (
        <GalleryNotes>
          <p role="status">{result}</p>
        </GalleryNotes>
      )}
    </div>
  );
}

export const questionExample: GalleryExample = {
  id: "question-form",
  title: "Question form",
  group: "Components",
  description:
    "Options, freeform answers, multiple questions, long previews, history, and form states.",
  source: `import { QuestionForm } from "../../src/app/question/question-form";
import { QuestionHistoryCard } from "../../src/app/question/QuestionHistory";
import { QUESTION_CARD_CLASS } from "../../src/app/question/question-presentation";

const questions = ${JSON.stringify([layoutQuestion, freeformQuestion], null, 2)};

<div className={QUESTION_CARD_CLASS}>
  <QuestionForm questions={questions} disabled={false} cancelDisabled={false}
    onSubmit={submit} onCancel={reset} />
</div>
<QuestionHistoryCard record={historyRecord("answered")} />`,
  render: () => <QuestionExample />,
};

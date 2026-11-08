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
import { ExampleChoice } from "../ExampleChoice";
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
  details:
    "This is a local example. Nothing is sent to an agent or saved in BB.",
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
  details: `The reviewer needs to compare the result, the checks that ran, and the work still awaiting a decision. Keep each qualification beside the claim it limits.\n\n- The summary must fit a narrow message pane.\n- Long paths such as \`packages/release-tools/src/reports/quarterly-release-summary.tsx\` should remain readable.\n- Choose a layout to reveal its preview, then add notes about what you would change.\n\nThis is synthetic review content. No release, build, or deployment has run.`,
  options: [
    {
      ...questionOptions[0],
      description:
        "Lead with the goal, then keep the essential review steps together. The reviewer can read the proposed change before deciding whether to inspect the longer report.",
      preview: `Release summary\n  Goal: prepared a release report\n  Review\n    Read the narrow-pane report\n    Check long package paths\n    Confirm the release scope\n\n  Qualification\n    Local fixture, not a release report\n    No checks ran in this example\n    Deployment still needs approval`,
    },
    {
      ...questionOptions[1],
      description:
        "Show results and their qualifications beside the review steps. This uses more vertical space but keeps the context available while the reader compares the report.",
      preview: `Release summary\n  Goal: prepared a release report\n  Done\n    Report composition\n      packages/release-tools/src/reports/quarterly-release-summary.tsx\n    Review instructions\n      Keep qualifications beside each result\n  Review\n    Open the report in a narrow pane\n    Read all package paths\n    Compare the supporting details\n\n  Limits\n    Synthetic content\n    No build or deployment\n    No live files opened`,
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
        "Preparation\n  Report drafted\nVerification\n  Not run in this fixture\nDeployment\n  Awaiting approval",
    },
  ],
};

const presets = [
  { value: "options", label: "Options and notes" },
  { value: "freeform", label: "Freeform only" },
  { value: "mixed", label: "Options and freeform" },
  { value: "questions", label: "Multiple questions" },
  { value: "long", label: "Long details and previews" },
  { value: "history", label: "Question history" },
] as const;
type Preset = (typeof presets)[number]["value"];
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

function QuestionExample() {
  const [preset, setPreset] = useState<Preset>("options");
  const [mode, setMode] = useState<"single" | "multiple">("single");
  const [state, setState] = useState<FormState>("ready");
  const [historyStatus, setHistoryStatus] =
    useState<QuestionHistory["status"]>("answered");
  const [reset, setReset] = useState(0);
  const [result, setResult] = useState("No local answer submitted");
  const questions = questionsFor(preset, mode === "multiple");
  const submit = (answers: Record<string, QuestionAnswer>) => {
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
    setResult(`Local answer: ${labels.join(", ")}`);
  };
  const disabled = state === "disabled" || state === "submitting";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <ExampleChoice
          label="Question preset"
          value={preset}
          options={presets}
          onChange={(value) => {
            setPreset(value);
            setResult("No local answer submitted");
          }}
        />
        {preset === "history" ? (
          <ExampleChoice
            label="History status"
            value={historyStatus}
            onChange={setHistoryStatus}
            options={[
              { value: "answered", label: "Answered" },
              { value: "dismissed", label: "Dismissed" },
              { value: "pending", label: "Pending" },
              { value: "unknown", label: "Answer unavailable" },
            ]}
          />
        ) : (
          <>
            {preset !== "freeform" ? (
              <ExampleChoice
                label="Selection"
                value={mode}
                onChange={(value) => {
                  setMode(value);
                  setResult("No local answer submitted");
                }}
                options={[
                  { value: "single", label: "Single choice" },
                  { value: "multiple", label: "Multiple choices" },
                ]}
              />
            ) : null}
            <ExampleChoice
              label="Form state"
              value={state}
              onChange={setState}
              options={[
                { value: "ready", label: "Ready" },
                { value: "disabled", label: "All actions disabled" },
                { value: "submitting", label: "Submitting · Cancel available" },
                { value: "cancel-disabled", label: "Cancel disabled" },
                { value: "error", label: "Submit error" },
              ]}
            />
          </>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setReset(reset + 1);
            setResult("Local form reset");
          }}
        >
          Reset local form
        </Button>
      </div>
      {preset === "history" ? (
        <QuestionHistoryCard
          key={`${historyStatus}-${reset}`}
          record={historyRecord(historyStatus)}
        />
      ) : (
        <div className={QUESTION_CARD_CLASS}>
          <QuestionForm
            key={`${preset}-${mode}-${reset}`}
            questions={questions}
            disabled={disabled}
            cancelDisabled={state === "disabled" || state === "cancel-disabled"}
            error={
              state === "error"
                ? "Synthetic submit error. Your local selections are still available; reset or change the form state to continue."
                : null
            }
            onSubmit={submit}
            onCancel={() => {
              setReset(reset + 1);
              setResult("Local answer cancelled");
            }}
          />
        </div>
      )}
      <p role="status" className="text-xs text-muted-foreground">
        {result}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Submit and Cancel update local state. Multiple questions use the real
        tabs, Back, and Next controls; answers remain while navigating. History
        opens with its disclosure. Disabled forms use the production Submitting…
        label; the state selector does not start a request. Attachments need a
        project and are disabled here. No upload, live question, or saved BB
        answer is available.
      </p>
    </div>
  );
}

export const questionExample: GalleryExample = {
  id: "question-form",
  title: "Question form",
  group: "Components",
  description:
    "The real form and history card: options, freeform, multiple questions, long previews, disabled actions, and errors. Answers stay local; uploads are unavailable.",
  source: `import { QuestionForm } from "../../src/app/question/question-form";
import { QuestionHistoryCard } from "../../src/app/question/QuestionHistory";
import { QUESTION_CARD_CLASS } from "../../src/app/question/question-presentation";

// Fixture excerpts: no persistenceKey and no project for uploads.
const questions = ${JSON.stringify([layoutQuestion, freeformQuestion], null, 2)};

<div className={QUESTION_CARD_CLASS}>
  <QuestionForm questions={questions} disabled={false} cancelDisabled={false}
    onSubmit={submitLocally} onCancel={resetLocally} />
</div>
// historyRecord is the local typed fixture used by the history preset.
<QuestionHistoryCard record={historyRecord("answered")} />`,
  render: () => <QuestionExample />,
};

import {
  experimental_useQuestionFormHost,
  type ExperimentalQuestionShortcut,
} from "@get-bb/plugin-sdk/app";

export type QuestionShortcut = ExperimentalQuestionShortcut;
export const useQuestionFormHost = experimental_useQuestionFormHost;

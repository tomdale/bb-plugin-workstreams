import {
  buildInteractionPayload,
  buildToolResult,
} from "../../../src/server/questions/translate.ts";

export const original = {
  questions: [
    {
      question: "Which layout?",
      details: "Compare **both** designs.",
      header: "Layout",
      multiSelect: false,
      options: [
        {
          label: "Rows",
          description: "Compact rows",
          preview: "[ row one ]\n[ row two ]",
        },
        {
          label: "Cards",
          description: "Room for details",
          preview: "[ card ] [ card ]",
        },
      ],
    },
    {
      question: "Which checks?",
      header: "Checks",
      multiSelect: true,
      options: [
        { label: "Types, build", description: "Compile everything" },
        { label: "Tests", description: "Run regressions" },
      ],
    },
    {
      question: "Anything else?",
      header: "Notes",
      options: [],
      multiSelect: false,
    },
  ],
};
export const payload = buildInteractionPayload(original);
export const submission = {
  answers: {
    q0: { selected: ["q0o1"], freeText: "Keep the details visible." },
    q1: { selected: ["q1o0", "q1o1"] },
    q2: {
      selected: [],
      freeText: "Use the attached sample.",
      attachments: [
        {
          type: "localFile" as const,
          projectId: "project",
          path: "files/sample.txt",
          name: "sample.txt",
          mimeType: "text/plain",
          sizeBytes: 6,
        },
        {
          type: "localImage" as const,
          projectId: "project",
          path: "files/sample.png",
          name: "sample.png",
          mimeType: "image/png",
          sizeBytes: 12,
        },
      ],
    },
  },
};
export const result = buildToolResult(payload, submission);

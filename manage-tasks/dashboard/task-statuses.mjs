export const TASK_STATUS_INFO = Object.freeze({
  awaiting_decision: Object.freeze({ collection: "open", label: "Decision needed", order: 0, needsAttention: true }),
  waiting: Object.freeze({ collection: "open", label: "Waiting", order: 1, needsAttention: true }),
  in_progress: Object.freeze({ collection: "open", label: "In progress", order: 2, needsAttention: false }),
  todo: Object.freeze({ collection: "open", label: "To do", order: 3, needsAttention: false }),
  done: Object.freeze({ collection: "closed", label: "Done", order: 4, needsAttention: false }),
  canceled: Object.freeze({ collection: "closed", label: "Canceled", order: 5, needsAttention: false }),
});

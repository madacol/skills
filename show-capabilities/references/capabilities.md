# Capabilities

Use this when the user wants a plain-language menu of what the agent can do.

## Core capabilities

| Capability | What it means | Clear example |
|---|---|---|
| Work with a workspace | Use files, folders, repos, docs, spreadsheets, and trackers as the workbench. | “Organize this project folder and create an index of every important file.” |
| Use tools | Run commands, search, inspect files, process data, use connected apps, or operate available utilities. | “Read these CSVs, merge them, and show the mismatched rows.” |
| Use browser workflows | Open sites, inspect pages, fill forms, download files, capture screenshots, and hand control to the user at gated steps. | “Prepare this vendor portal submission and stop before final submit.” |
| Create artifacts | Produce files, checklists, reports, packets, spreadsheets, docs, images, dashboards, code changes, or zipped deliverables. | “Turn these receipts into a spreadsheet and a clean ZIP archive.” |
| Keep state | Maintain decisions, open questions, task lists, status, and repeated workflow instructions. | “Run this event project room and keep the owner list, purchases, and risks current.” |
| Split work | Use subagents for independent research, review, implementation, or critique. | “Have separate reviewers check this plan for cost, risk, operations, and user impact.” |
| Verify results | Run tests, compare counts, reconcile sources, capture evidence, review diffs, or perform dry runs. | “Process the files and prove the output count matches the input count.” |
| Pause at gates | Prepare work and ask before sensitive actions. | “Draft and prepare the email with evidence, then wait for my approval before sending.” |

## Useful starter prompt

```text
I have <materials/problem>. Help me turn it into <concrete result>. Use the available tools, verify the output, and ask me before sensitive actions.
```

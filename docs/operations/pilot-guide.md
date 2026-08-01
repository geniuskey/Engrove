# Community pilot guide

## Golden path

1. Sign in and open **Get started**.
2. Create a workspace and a project.
3. On the project overview, select **Install template & demo**. This creates the completed Test & Characterization v6 schema, synthetic engineering records, an immutable CSV file, a processed tabular dataset, a chart pinned to that exact dataset, and a task linked to both the dataset and test run.
4. Open **Charts & dashboards**, inspect **Engrove demo force distribution**, and follow its dataset source to **Files & datasets**. Download `engrove-demo-results.csv` and confirm the raw evidence is unchanged.
5. Open **Tasks** and complete **Review the Engrove demo result**, or create a new follow-up action with exact engineering links.
6. Return to **Get started**, mark the steps complete, then use **Pilot** to record what worked and what blocked the workflow.

All demo content is labelled synthetic and must not be treated as production test evidence. It can be archived after evaluation without physically deleting its traceability history.

## Moving to real work

Choose one bounded spreadsheet workflow. Install or upgrade the template in the real project, create records for the actual test item, samples, equipment, method, and run, then upload the original result file. Create an immutable dataset and chart, link the dataset to the test run, and create tasks from failed evaluations or investigation results.

Do not import secrets, regulated personal data, or production evidence until the administrator has completed the security, backup, access-control, and retention review.

## Measuring the pilot

Owners and Admins can open **Pilot** to see repeat users, records, ready datasets, evidence links, tasks, demo projects, and feedback. “Repeat user” means a user with audited activity on at least two distinct UTC dates in the last 30 days.

The release target remains field evidence, not seeded demo counts:

- at least 3 repeat users;
- at least 100 real records and 10 real datasets;
- at least one existing spreadsheet workflow partially replaced;
- engineers can trace a chart to its raw source and create follow-up tasks;
- no critical data-loss or permission issue.

Demo records help validate the software path but do not count as proof of real adoption. Record the workflow-replacement decision and any incident outside Engrove according to the organization’s pilot process, and submit product feedback in Engrove.

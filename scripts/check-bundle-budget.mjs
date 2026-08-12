import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const kibibyte = 1024;
const budgets = {
  maxJavaScriptChunk: 450 * kibibyte,
  // Calculated fields, revision history, metadata editing, the command surface, the project
  // dashboard, visual canvas, guided element picker, bilingual page dictionary, accessible
  // task-board drag-and-drop, editable task details, project milestones, external source
  // traceability, the searchable home command center, self-service group identity, scoped
  // personal API-token management with copy-once examples, signed record-webhook management and
  // delivery history, Jira-style task relationships, personal notification preferences,
  // transactional task automation with execution history, project-scoped workflow editing and
  // directed transitions, persistent optimistic-concurrency task ranking, permission-aware recovery
  // states, atomic record archive/restore lifecycle controls, task-local external evidence with
  // append-only link history, workspace-ranked project/task/table command search, and normalized
  // task labels with catalog, filtering, saved-filter, search, and audit support are product-level
  // capabilities. The task-label slice added 3.4 KiB to the prior 1,439.9 KiB baseline.
  // One-level task hierarchy, derived child completion, and parent-aware pickers/search added
  // 5.0 KiB to the resulting 1,443.3 KiB baseline. Consolidating the workspace overview into one
  // server snapshot later removed 1.1 KiB. The dense task list, keyboard navigation, and saved-view
  // contract and hierarchy-preserving task sort brought the measured bundle to 1,451.7 KiB.
  // Saved hierarchy-preserving list grouping and accessible collapse controls brought it to
  // 1,454.5 KiB. Saved visible-column ordering and its accessible popover bring it to 1,458.1 KiB.
  // Custom-workflow status filtering and the hide-completed preset bring it to 1,459.4 KiB.
  // Webhook test delivery, explicit failure diagnostics, and audited manual recovery bring the
  // measured bundle to 1,463.1 KiB. The workspace-wide personal work queue, URL-backed triage
  // filters, bilingual labels, and sidebar entry bring the measured bundle to 1,476.2 KiB while
  // remaining a separate 7.8 KiB lazy chunk. Key-date task linking, derived completion, and the
  // searchable link picker bring the measured bundle to 1,481.0 KiB while keeping the schedule in
  // a separate 15.3 KiB lazy chunk. Reverse key-date context in task detail and durable schedule
  // deep links bring the measured bundle to 1,483.2 KiB. Keep modest headroom while retaining the
  // stricter per-chunk limit. Retry-safe task and key-date creation brought it to 1,483.6 KiB;
  // visible least-privilege API-token capability selection brings it to 1,485.4 KiB. Bounded task
  // activity and lazy comment revisions bring it to 1,487.9 KiB. Server-searched parent and
  // relationship pickers remove a duplicate 5,000-task preload and bring it to 1,490.0 KiB.
  // Per-status paging, bounded list/calendar continuation, and mutation resynchronization bring it
  // to 1,492.2 KiB. The server-searched project picker and workspace project continuation bring it
  // to 1,496.7 KiB while removing unbounded project reads from primary navigation and overview.
  // Server-paged workspace management, exact workspace restoration, and the searchable workspace
  // picker bring it to 1,501.0 KiB while removing the remaining unbounded workspace reads.
  // Bounded project-reference resolution and reusable server-searched project selectors bring it
  // to 1,507.3 KiB while removing the full project portfolio from workspace data views. Server-
  // searched key-date task linking brings it to 1,508.5 KiB and removes the initial backlog slice.
  // Paged chart and dashboard catalogs bring it to 1,509.7 KiB. The bounded, searchable table
  // catalog, direct selected-table restoration, and table search inside the dashboard element
  // picker bring the measured total to 1,512.8 KiB. Bounded dataset and key-date catalogs,
  // selection-preserving source search, exact key-date restoration, and bilingual controls bring
  // it to 1,515.4 KiB; both user surfaces remain lazy chunks. Paged notification history and its
  // state-preserving inbox continuation bring it to 1,516.3 KiB. Paged record history and exact
  // older-snapshot restore access bring it to 1,517.3 KiB. The searchable, exactly counted review
  // inbox continuation brings it to 1,520.0 KiB. Searchable, exactly counted webhook delivery
  // history with bounded continuation brings it to 1,523.0 KiB. Filtered, exactly counted
  // automation execution history brings the measured total to 1,525.3 KiB in its existing lazy
  // settings chunk while leaving the initial chunk unchanged. Bounded, server-searched organization
  // audit history brings it to 1,526.8 KiB in the existing lazy audit chunk. The paged, searchable
  // saved-filter directory brings the measured total to 1,532.2 KiB in the existing lazy task
  // chunk while the initial chunk remains unchanged. Server-searched review participants and
  // bounded record-review thread/message continuation bring the measured total to 1,537.3 KiB;
  // the initial chunk remains unchanged. Bounded webhook and automation-rule catalogs followed by
  // paged saved-view discovery and exact deep-link restoration bring the measured total to
  // 1,540.6 KiB while the largest initial chunk remains 392.1 KiB. Server-searched saved-view and
  // saved-chart dashboard pickers plus collision-aware shared picker positioning bring it to
  // 1,542.5 KiB while the initial chunk remains 392.1 KiB. Reversible chart/canvas lifecycle
  // controls, archived read-only states, and contextual icon tooltips bring the measured total to
  // 1,545.2 KiB. Task creation/detail draft detection, baseline-aware field tracking, navigation
  // guards, and bilingual unsaved states bring it to 1,548.2 KiB; the largest chunk is still
  // 392.1 KiB. Canonical task-link sharing, activity filters and ordering, keyboard shortcuts,
  // tooltips, and bilingual labels bring it to 1,551.6 KiB while that largest chunk remains
  // unchanged. Collaborative, personal, and locked saved-view modes, ownership-aware controls,
  // lock notes, and bilingual guidance bring the measured total to 1,557.7 KiB. Public read-only
  // saved views, a separate signed-out exploration page, password/expiry/download management, and
  // bilingual guidance bring it to 1,584.7 KiB. The public surface remains a separate 14.8 KiB lazy
  // chunk and the initial chunk is 392.4 KiB. Checksum-verified task attachments, immutable exact-
  // version link metadata, drop/upload/download recovery, and bilingual guidance bring it to
  // 1,589.5 KiB. Public form intake, explicit anonymous provenance, protected retry handling, and
  // bilingual required/optional guidance bring it to 1,597.7 KiB in the existing lazy public-share
  // surface. Server-searched relation selection, linked display-name hydration, removable chips,
  // and archived-link context bring the measured total to 1,602.6 KiB. Bounded record comments,
  // author-only optimistic edits, drawer/full-detail discussion surfaces, member mentions, and
  // record-targeted notification navigation bring it to 1,613.6 KiB. Full-filter field summaries,
  // type-aware footer controls, saved-view persistence, and exact engineering-unit output bring
  // the optimized measured total to 1,616.4 KiB. Three-level Grid grouping, retained disabled
  // configuration, hierarchy counts, and accessible collapse/reorder controls bring it to
  // 1,623.9 KiB. Full-filter per-group summary badges and their accessible scope labels bring it
  // to 1,624.9 KiB. Project-wide WIP aging, stale-work drill-down, throughput, median/P85 cycle
  // metrics, and the accessible completed-work distribution bring it to 1,636.1 KiB without a new
  // chart dependency or a larger initial chunk. Daily cumulative-flow reconstruction, an accessible
  // native SVG area chart, lifecycle-aware labels, and bilingual guidance bring it to 1,640.1 KiB.
  // A compact native SVG created-versus-completed trend and explicit reopen/archive semantics bring
  // it to 1,644.3 KiB while the initial chunk remains unchanged. Application-wide session-expiry
  // recovery, accessible reauthentication guidance, and guarded deep-link continuation bring it to
  // 1,645.8 KiB. The application render boundary, chunk-specific recovery, and privacy-bounded
  // browser error signal bring it to 1,649.7 KiB. Retain narrow reviewed headroom without relaxing
  // the per-chunk limit. Editable task duplication, explicit copy-scope guidance, and source-link
  // affordances bring the measured total to 1,652.1 KiB while the initial chunk remains below the
  // existing per-chunk limit. Atomic failed-evaluation follow-up feedback and its durable task link
  // bring the measured total to 1,653.5 KiB without changing that initial chunk. Controlled
  // measurement field/unit drafts and local-time continuous entry bring it to 1,653.9 KiB.
  // Human-readable, server-searched user/file/dataset references and removal of raw task-link UUID
  // inputs bring it to 1,655.9 KiB without a dependency or per-chunk increase.
  // Bounded page-level reference-label hydration and truthful resource-field controls bring the
  // measured total to 1,656.4 KiB while keeping the same dependency graph and chunk ceiling.
  // Schema-label rendering for single- and multi-select reads brings the total to 1,656.6 KiB;
  // human-readable task evidence and exact record drill-downs bring it to 1,657.0 KiB. Compact
  // localized field-type icons and on-demand record-ID copy controls replace raw implementation
  // labels while removing redundant English-only metadata, leaving the measured total at
  // 1,656.5 KiB. Table-local typed-schema discovery completes the metadata-to-data API quickstart
  // and leaves the measured total at 1,656.6 KiB. Localized field-type icons replace repeated
  // grid-header type labels and bring the measured total to 1,656.8 KiB. Canonical task-key URLs
  // and in-drawer previous/next review navigation bring it to 1,657.5 KiB while the task surface
  // remains lazy and the initial chunk stays below its existing ceiling. Explicit task-conflict
  // recovery, draft-preserving latest-state review, and bilingual guidance bring the measured
  // total to 1,659.5 KiB without changing that initial-chunk ceiling. Localized task provenance
  // and unambiguous creation/status activity bring it to 1,660.3 KiB while preserving that ceiling.
  // Current-view CSV export adds explicit filter, sort, archive, project-context, and visible-field
  // scope while reusing the authenticated request path, bringing the measured total to 1,661.2 KiB.
  // Background export creation, polling, and signed-result download bring it to 1,662.5 KiB while
  // keeping the Data page lazy and every JavaScript chunk below the existing ceiling.
  // Atomic selected-record field editing, its table-local API example, conflict recovery, and
  // bilingual guidance bring the reviewed total to 1,671.9 KiB without changing the dependency
  // graph or per-chunk ceiling. Authored task work logs, explicit estimates, automatic remaining-
  // time adjustment, and optimistic edit/delete controls bring it to 1,688.9 KiB while keeping the
  // task surface lazy and every chunk below the unchanged ceiling. Server-enforced table visibility
  // and record-action policies, specific member/group administration, conflict-preserving edits,
  // and bilingual guidance bring the reviewed total to 1,700.7 KiB without a new dependency or an
  // increase to the unchanged per-chunk ceiling. Reviewable CSV preview, field mapping, duplicate
  // handling, and bilingual row feedback bring it to 1,708.5 KiB while remaining inside the lazy
  // Data page and preserving that per-chunk ceiling.
  // Fail-closed task visibility, member/group policy editing, create-time protection, and bilingual
  // guidance bring the reviewed total to 1,717.1 KiB. The task surface remains lazy, no dependency
  // was added, and the stricter per-chunk ceiling remains unchanged.
  // Inherited workspace/project access, searchable member/group policy editing, and create-time
  // protection bring the reviewed total to 1,728.3 KiB. The editor is a separate 6.4 KiB lazy
  // settings chunk, reduces the initial application chunk, adds no dependency, and leaves the
  // stricter per-chunk ceiling unchanged.
  // Application-wide, queued action confirmation and short-text prompts replace inaccessible,
  // unstyled browser-native dialogs across every lifecycle surface. Reusing the existing modal
  // and button styles keeps CSS inside its unchanged ceiling; the zero-dependency interaction
  // contract brings total JavaScript to 1,735.7 KiB while the largest chunk remains below 450 KiB.
  totalJavaScript: 1_737 * kibibyte,
  // Responsive home, workbench, detail drawer, timeline, settings popover, and dense task-list
  // presentation share one stylesheet; the personal work queue brings the measured asset to
  // 103.4 KiB. Compact table-catalog search and continuation controls bring it to 104.0 KiB.
  // Public-view exploration and share management bring it to 105.9 KiB; the responsive flow
  // insight cards, status-age bars, and cycle distribution bring the measured asset to 107.7 KiB.
  // The compact inline table-permission editor brings the measured shared asset to 109.9 KiB; the
  // responsive CSV preview/mapping grid brings it to 110.5 KiB. Theme-safe AA contrast tokens and
  // 24-pixel Grid targets bring the measured asset to 111.2 KiB; retain only 0.05 KiB of reviewed
  // headroom rather than weakening the accessibility regression gate.
  maxCssAsset: 111.25 * kibibyte,
};

const assetsDirectory = resolve(process.argv[2] ?? 'apps/web/dist/assets');
const entries = await readdir(assetsDirectory, { withFileTypes: true });
const assets = await Promise.all(
  entries
    .filter((entry) => entry.isFile() && /\.(?:css|js)$/.test(entry.name))
    .map(async (entry) => ({
      name: entry.name,
      size: (await stat(resolve(assetsDirectory, entry.name))).size,
    })),
);

const javascriptAssets = assets.filter((asset) => asset.name.endsWith('.js'));
const cssAssets = assets.filter((asset) => asset.name.endsWith('.css'));

if (javascriptAssets.length === 0) {
  throw new Error(`No JavaScript assets found in ${assetsDirectory}. Run the web build first.`);
}

const failures = [];
const chunkImports = new Map(
  await Promise.all(
    javascriptAssets.map(async (asset) => {
      const source = await readFile(resolve(assetsDirectory, asset.name), 'utf8');
      const imports = new Set(
        [...source.matchAll(/(?:from|import\()["']\.\/([^"']+\.js)["']/g)].map((match) => match[1]),
      );
      return [asset.name, imports];
    }),
  ),
);
const circularImport = findCircularImport(chunkImports);
if (circularImport) {
  failures.push(`Circular JavaScript chunk import: ${circularImport.join(' -> ')}.`);
}
for (const asset of javascriptAssets) {
  if (asset.size > budgets.maxJavaScriptChunk) {
    failures.push(
      `${asset.name} is ${formatKiB(asset.size)}; the per-chunk budget is ${formatKiB(budgets.maxJavaScriptChunk)}.`,
    );
  }
}

for (const asset of cssAssets) {
  if (asset.size > budgets.maxCssAsset) {
    failures.push(
      `${asset.name} is ${formatKiB(asset.size)}; the per-asset CSS budget is ${formatKiB(budgets.maxCssAsset)}.`,
    );
  }
}

const totalJavaScriptSize = javascriptAssets.reduce((total, asset) => total + asset.size, 0);
if (totalJavaScriptSize > budgets.totalJavaScript) {
  failures.push(
    `JavaScript totals ${formatKiB(totalJavaScriptSize)}; the total budget is ${formatKiB(budgets.totalJavaScript)}.`,
  );
}

if (failures.length > 0) {
  console.error('Web bundle budget exceeded:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const largestJavaScriptAsset = javascriptAssets.toSorted(
    (left, right) => right.size - left.size,
  )[0];
  console.log(
    `Web bundle budget passed: largest JS ${largestJavaScriptAsset.name} ${formatKiB(largestJavaScriptAsset.size)}, total JS ${formatKiB(totalJavaScriptSize)}.`,
  );
}

function formatKiB(bytes) {
  return `${(bytes / kibibyte).toFixed(1)} KiB`;
}

function findCircularImport(graph) {
  const visiting = new Set();
  const visited = new Set();
  const path = [];

  function visit(node) {
    if (visiting.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (visited.has(node)) return undefined;
    visiting.add(node);
    path.push(node);
    for (const dependency of graph.get(node) ?? []) {
      if (!graph.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
    return undefined;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return undefined;
}

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const kibibyte = 1024;
const budgets = {
  maxJavaScriptChunk: 450 * kibibyte,
  // Calculated fields, revision history, metadata editing, the command surface, the project
  // dashboard, visual canvas, guided element picker, bilingual page dictionary, accessible
  // task-board drag-and-drop, editable task details, project milestones, and the searchable
  // home command center are product-level capabilities. Keep modest headroom above that
  // baseline while retaining the stricter per-chunk limit.
  totalJavaScript: 1_280 * kibibyte,
  // Responsive home, workbench, detail drawer, and timeline presentation share one stylesheet.
  maxCssAsset: 96 * kibibyte,
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

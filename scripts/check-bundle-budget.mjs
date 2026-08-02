import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const kibibyte = 1024;
const budgets = {
  maxJavaScriptChunk: 450 * kibibyte,
  totalJavaScript: 1_100 * kibibyte,
  maxCssAsset: 64 * kibibyte,
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

#!/usr/bin/env node
/**
 * Read-only release check for every file verified-manifest.json depends on (the manifest itself plus each
 * asset): git state (committed / tracked-but-modified / untracked / ignored / missing), size, sha256 against
 * the manifest, and privacy-region sanity. A file that is not committed will not exist in the GitHub Actions
 * worker's clean checkout. Never stages or commits anything.
 *
 *   npx tsx scripts/video-factory/checkAssetsPortable.ts            # exits 1 unless every file is committed + verified
 *   npx tsx scripts/video-factory/checkAssetsPortable.ts --pre-commit  # accepts untracked/modified (content checks only)
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { relative, resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSETS_DIR, loadManifest, sha256File } from "../../src/shortform/scenePlan.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MAX_ASSET_BYTES = 5 * 1024 * 1024;

type GitState = "committed" | "tracked-but-modified" | "untracked" | "ignored" | "missing";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function gitState(absolutePath: string): GitState {
  if (!existsSync(absolutePath)) return "missing";
  const rel = relative(REPO_ROOT, absolutePath).replace(/\\/g, "/");
  let insideRepo = true;
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    insideRepo = false;
  }
  if (!insideRepo) return "untracked";
  const status = git(["status", "--porcelain", "--ignored", "--", rel]).trim();
  if (status.startsWith("!!")) return "ignored";
  if (status.startsWith("??")) return "untracked";
  if (status.length > 0) return "tracked-but-modified";
  return "committed";
}

function main() {
  const preCommit = process.argv.includes("--pre-commit");
  const manifest = loadManifest();
  const manifestPath = join(ASSETS_DIR, "verified-manifest.json");
  const rows: { label: string; rel: string; state: GitState; bytes: number | null; hash: string; privacy: string }[] = [];
  const problems: string[] = [];

  const files: { label: string; path: string; sha256: string | null; width?: number; height?: number; privateRegions?: { region: { x: number; y: number; w: number; h: number }; kind: string }[] }[] = [
    { label: "verified-manifest.json", path: manifestPath, sha256: null },
    ...manifest.assets.map((a) => ({ label: a.id, path: join(ASSETS_DIR, a.file), sha256: a.sha256, width: a.width, height: a.height, privateRegions: a.privateRegions })),
  ];

  for (const f of files) {
    const rel = relative(REPO_ROOT, f.path).replace(/\\/g, "/");
    const state = gitState(f.path);
    const bytes = state === "missing" ? null : statSync(f.path).size;
    let hash = "n/a";
    if (state !== "missing" && f.sha256) {
      hash = sha256File(f.path) === f.sha256 ? "ok" : "MISMATCH";
      if (hash === "MISMATCH") problems.push(`${rel}: sha256 does not match the manifest.`);
    }
    let privacy = "none declared";
    if (f.privateRegions && f.privateRegions.length > 0) {
      const bad = f.privateRegions.filter((p) => p.region.x < 0 || p.region.y < 0 || p.region.w <= 0 || p.region.h <= 0 || (f.width !== undefined && p.region.x + p.region.w > f.width) || (f.height !== undefined && p.region.y + p.region.h > f.height));
      privacy = bad.length ? "OUT OF BOUNDS" : `${f.privateRegions.length} region(s) in bounds`;
      if (bad.length) problems.push(`${rel}: private region outside the ${f.width}x${f.height} frame.`);
    }
    if (bytes !== null && bytes > MAX_ASSET_BYTES) problems.push(`${rel}: ${bytes} bytes exceeds the ${MAX_ASSET_BYTES}-byte per-asset budget.`);
    if (state === "missing") problems.push(`${rel}: missing on disk.`);
    if (state === "ignored") problems.push(`${rel}: gitignored -- a commit would silently leave it out.`);
    if (!preCommit && (state === "untracked" || state === "tracked-but-modified")) problems.push(`${rel}: ${state} -- a clean checkout would not have this exact content.`);
    rows.push({ label: f.label, rel, state, bytes, hash, privacy });
  }

  for (const r of rows) console.log(`${r.state.padEnd(21)} ${String(r.bytes ?? "-").padStart(9)} B  sha:${r.hash.padEnd(8)} privacy:${r.privacy.padEnd(22)} ${r.rel}`);
  const total = rows.reduce((s, r) => s + (r.bytes ?? 0), 0);
  console.log(`\n${rows.length} file(s), ${(total / 1024 / 1024).toFixed(2)} MB total.`);
  if (problems.length) {
    console.log("\nPROBLEMS:");
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log(preCommit ? "Content checks pass; commit these files for the worker to see them." : "All files committed and content-verified.");
  }
}

main();

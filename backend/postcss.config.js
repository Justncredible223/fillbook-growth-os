// Empty on purpose. This backend has no CSS pipeline; this file only exists
// so that postcss-load-config's upward directory search stops here instead
// of continuing to an unrelated file further up the temp directory tree
// (this worktree happens to be checked out under the OS temp dir in this
// sandboxed session).
export default {};

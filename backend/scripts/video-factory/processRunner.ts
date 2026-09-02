import { execFile } from "node:child_process";

/**
 * Thin wrapper around child_process, same injectable-for-tests shape as
 * the backend adapters' `fetchImpl` pattern (XSignalAdapter,
 * SearchConsoleAdapter) -- every module here takes a ProcessRunner
 * instead of calling execFile directly, so unit tests can assert exact
 * argv without actually invoking ffmpeg/edge-tts.
 */
export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProcessRunOptions {
  /**
   * Working directory for the child process. render.ts always sets this
   * to the render's own output directory and references the .ass/output
   * files by basename -- the known-good pipeline's fix for ffmpeg's
   * filter-syntax path escaping being fragile on Windows absolute paths
   * (~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md).
   */
  cwd?: string;
}

export interface ProcessRunner {
  run(command: string, args: string[], options?: ProcessRunOptions): Promise<ProcessResult>;
}

/** Real implementation -- never used directly in unit tests. */
export function createProcessRunner(): ProcessRunner {
  return {
    run(command: string, args: string[], options?: ProcessRunOptions): Promise<ProcessResult> {
      return new Promise((resolve, reject) => {
        execFile(command, args, { maxBuffer: 1024 * 1024 * 64, cwd: options?.cwd }, (err, stdout, stderr) => {
          if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(err);
            return;
          }
          const exitCode = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 0;
          resolve({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode });
        });
      });
    },
  };
}

/**
 * Fails clearly and immediately if a required executable isn't reachable
 * -- per spec, never let a missing ffmpeg/ffprobe/uvx surface as a
 * confusing downstream error.
 */
export async function requireExecutable(runner: ProcessRunner, command: string, versionArgs: string[]): Promise<void> {
  try {
    const result = await runner.run(command, versionArgs);
    if (result.exitCode !== 0) {
      throw new Error(`"${command}" exited with code ${result.exitCode}: ${result.stderr || result.stdout}`);
    }
  } catch (err) {
    const isMissing = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    throw new Error(
      isMissing
        ? `"${command}" was not found on PATH. Install it before running the video factory -- see docs/VIDEO_FACTORY.md's Prerequisites section.`
        : `"${command}" is on PATH but failed to run: ${(err as Error).message}`,
    );
  }
}

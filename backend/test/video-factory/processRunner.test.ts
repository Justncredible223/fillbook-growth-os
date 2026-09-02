import { describe, it, expect, vi } from "vitest";
import { requireExecutable, type ProcessRunner } from "../../scripts/video-factory/processRunner";

describe("requireExecutable", () => {
  it("resolves silently when the command runs and exits zero", async () => {
    const runner: ProcessRunner = { run: vi.fn().mockResolvedValue({ stdout: "ffmpeg version 9.0.1", stderr: "", exitCode: 0 }) };

    await expect(requireExecutable(runner, "ffmpeg", ["-version"])).resolves.toBeUndefined();
  });

  it("fails with a clear, actionable message when the command is missing (ENOENT)", async () => {
    const enoent = Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    const runner: ProcessRunner = { run: vi.fn().mockRejectedValue(enoent) };

    await expect(requireExecutable(runner, "ffmpeg", ["-version"])).rejects.toThrow(/was not found on PATH/);
    await expect(requireExecutable(runner, "ffmpeg", ["-version"])).rejects.toThrow(/docs\/VIDEO_FACTORY\.md/);
  });

  it("fails when the command exists but exits non-zero", async () => {
    const runner: ProcessRunner = { run: vi.fn().mockResolvedValue({ stdout: "", stderr: "bad flag", exitCode: 2 }) };

    await expect(requireExecutable(runner, "ffmpeg", ["--bogus"])).rejects.toThrow(/exited with code 2/);
  });

  it("fails when the command exists but throws a non-ENOENT error", async () => {
    const runner: ProcessRunner = { run: vi.fn().mockRejectedValue(new Error("permission denied")) };

    await expect(requireExecutable(runner, "ffmpeg", ["-version"])).rejects.toThrow(/is on PATH but failed to run/);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendOutreachEmail } from "../src/email/emailClient";

describe("sendOutreachEmail", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.OUTREACH_FROM_EMAIL;

  afterEach(() => {
    process.env.RESEND_API_KEY = originalKey;
    process.env.OUTREACH_FROM_EMAIL = originalFrom;
    vi.unstubAllGlobals();
  });

  it("returns sent:false without calling fetch when not configured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.OUTREACH_FROM_EMAIL;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendOutreachEmail({ to: "a@example.com", subject: "hi", body: "hello" });

    expect(result.sent).toBe(false);
    expect(result.skippedReason).toMatch(/not configured/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to Resend and returns the provider id when configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.OUTREACH_FROM_EMAIL = "growth@fillbookhq.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "email_123" }) }),
    );

    const result = await sendOutreachEmail({ to: "a@example.com", subject: "hi", body: "hello" });

    expect(result).toEqual({ sent: true, providerId: "email_123" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer re_test" }) }),
    );
  });

  it("throws with the response body when Resend rejects the send", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.OUTREACH_FROM_EMAIL = "growth@fillbookhq.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "invalid from address" }),
    );

    await expect(sendOutreachEmail({ to: "a@example.com", subject: "hi", body: "hello" })).rejects.toThrow(/422/);
  });
});

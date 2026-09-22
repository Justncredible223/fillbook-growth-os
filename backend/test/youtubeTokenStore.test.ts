import { describe, it, expect } from "vitest";
import {
  InMemoryYoutubeTokenStore,
  BootstrappingYoutubeTokenStore,
  bootstrapYoutubeTokenStateFromEnv,
} from "../src/signals/adapters/youtubeTokenStore";

describe("bootstrapYoutubeTokenStateFromEnv", () => {
  it("returns null when either env var is missing", () => {
    expect(bootstrapYoutubeTokenStateFromEnv({})).toBeNull();
    expect(bootstrapYoutubeTokenStateFromEnv({ YOUTUBE_ACCESS_TOKEN: "a" } as NodeJS.ProcessEnv)).toBeNull();
    expect(bootstrapYoutubeTokenStateFromEnv({ YOUTUBE_REFRESH_TOKEN: "r" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("builds a state treated as already-expired, forcing an immediate refresh", () => {
    const state = bootstrapYoutubeTokenStateFromEnv({
      YOUTUBE_ACCESS_TOKEN: "a",
      YOUTUBE_REFRESH_TOKEN: "r",
    } as NodeJS.ProcessEnv);

    expect(state).toEqual({ accessToken: "a", refreshToken: "r", expiresAt: new Date(0) });
  });
});

describe("BootstrappingYoutubeTokenStore", () => {
  it("seeds the inner store from the bootstrap value on first load", async () => {
    const inner = new InMemoryYoutubeTokenStore(null);
    const bootstrap = { accessToken: "boot-access", refreshToken: "boot-refresh", expiresAt: new Date(0) };
    const store = new BootstrappingYoutubeTokenStore(inner, bootstrap);

    const loaded = await store.load();

    expect(loaded).toEqual(bootstrap);
    expect(await inner.load()).toEqual(bootstrap);
  });

  it("prefers the inner store's existing state over the bootstrap value", async () => {
    const existing = { accessToken: "real-access", refreshToken: "real-refresh", expiresAt: new Date(Date.now() + 1000) };
    const inner = new InMemoryYoutubeTokenStore(existing);
    const bootstrap = { accessToken: "boot-access", refreshToken: "boot-refresh", expiresAt: new Date(0) };
    const store = new BootstrappingYoutubeTokenStore(inner, bootstrap);

    const loaded = await store.load();

    expect(loaded).toEqual(existing);
  });

  it("returns null when there's neither an existing state nor a bootstrap value", async () => {
    const inner = new InMemoryYoutubeTokenStore(null);
    const store = new BootstrappingYoutubeTokenStore(inner, null);

    expect(await store.load()).toBeNull();
  });

  it("passes save() straight through to the inner store", async () => {
    const inner = new InMemoryYoutubeTokenStore(null);
    const store = new BootstrappingYoutubeTokenStore(inner, null);
    const state = { accessToken: "new", refreshToken: "new-refresh", expiresAt: new Date(Date.now() + 1000) };

    await store.save(state);

    expect(await inner.load()).toEqual(state);
  });
});

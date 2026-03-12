import { describe, expect, it } from "vitest";

import { hasAuthenticatedSession } from "@/app/login/page";

describe("hasAuthenticatedSession", () => {
  it("does not treat a guest auth response as a signed-in session", () => {
    expect(hasAuthenticatedSession({
      ok: true,
      data: {
        userId: null,
        isGuest: true
      }
    })).toBe(false);
  });

  it("treats a resolved user session as authenticated", () => {
    expect(hasAuthenticatedSession({
      ok: true,
      data: {
        userId: 42,
        isGuest: false
      }
    })).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  it("accepts locale-prefixed app paths", () => {
    expect(safeNextPath("/es/claims/new")).toEqual({ path: "/es/claims/new", locale: "es" });
    expect(safeNextPath("/ca/claims/3f1c2b1e-0000-4000-8000-000000000000/flight")?.locale).toBe("ca");
  });
  it("rejects anything that could leave the site or isn't ours", () => {
    for (const bad of ["//evil.com", "/es//evil.com", "https://evil.com", "/es/../x", "/fr/claims", "/es\\evil", "/es?x=1", "", null]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });
});

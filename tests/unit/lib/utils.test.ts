import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges conditional class inputs", () => {
    expect(cn("px-2", { hidden: false }, ["font-sans"])).toBe("px-2 font-sans");
  });

  it("resolves conflicting tailwind utilities (last one wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});

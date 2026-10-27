import { afterEach, expect, it, vi } from "vitest";
import { newNodeId } from "../../src/client/id";
import { UUIDSchema } from "../../src/shared/schema";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("generates unique UUID v4 IDs on HTTP LAN origins without crypto.randomUUID", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  const values = Array.from({ length: 100 }, () => newNodeId());
  expect(new Set(values).size).toBe(100);
  for (const id of values) expect(UUIDSchema.safeParse(id).success).toBe(true);
});

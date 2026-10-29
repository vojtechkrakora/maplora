import fc from "fast-check";
import type { MapFile, MapNode } from "../src/shared/schema.js";
export const textArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);
const uuid = () => fc.uuid({ version: 4 });
const nodeArb: fc.Arbitrary<MapNode> = fc.letrec<{ node: MapNode }>((tie) => ({
  node: fc.record({
    id: uuid(),
    text: textArb,
    collapsed: fc.boolean(),
    children: fc.oneof(
      { depthSize: "small", maxDepth: 4 },
      fc.constant([] as MapNode[]),
      fc.array(tie("node"), { maxLength: 4 }),
    ),
  }),
})).node;
export const mapArb: fc.Arbitrary<MapFile> = fc.record({
  schemaVersion: fc.constant(1 as const),
  revision: fc.integer({ min: 1, max: 100 }),
  id: uuid(),
  title: textArb,
  tags: fc.array(
    textArb.filter((text) => text.length <= 32 && !text.includes(",")),
    { maxLength: 5 },
  ),
  createdAt: fc.constant("2026-01-01T00:00:00.000Z"),
  updatedAt: fc.constant("2026-01-02T00:00:00.000Z"),
  root: nodeArb,
});
export function fixture(): MapFile {
  return {
    schemaVersion: 1,
    revision: 1,
    id: "12345678-1234-4234-8234-123456789012",
    title: "Garden of ideas",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    root: {
      id: "12345678-1234-4234-8234-123456789013",
      text: "Garden of ideas",
      collapsed: false,
      children: [],
    },
  };
}

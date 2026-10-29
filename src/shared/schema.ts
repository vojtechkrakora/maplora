import { z } from "zod";
export const CURRENT_SCHEMA_VERSION = 1;
export const MIN_SCHEMA_VERSION = 1;
export const UUIDSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Expected a UUID v4",
  );
export const TitleSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((v) => v.trim().length > 0, "Enter a title");
export const NodeTextSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => v.trim().length > 0, "Enter node text");
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 32;
export const TagSchema = z
  .string()
  .min(1, "Enter a tag.")
  .max(MAX_TAG_LENGTH, "Tags must be 1–32 characters.")
  .refine(
    (tag) => tag.trim().length > 0,
    "Tags cannot contain only whitespace.",
  )
  .refine((tag) => !tag.includes(","), "Tags cannot contain commas.");
export const TagsSchema = z
  .array(TagSchema)
  .max(MAX_TAGS, "A map can have at most 20 tags.");
export const NodeStyleSchema = z
  .object({
    backgroundColor: z.string().optional(),
    textColor: z.string().optional(),
    borderColor: z.string().optional(),
    connectorColor: z.string().optional(),
    connectorStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
    connectorWidth: z.number().min(1).max(8).optional(),
  })
  .strict();
export type NodeStyle = z.infer<typeof NodeStyleSchema>;
export interface MapNode {
  id: string;
  text: string;
  collapsed: boolean;
  style?: NodeStyle;
  children: MapNode[];
}
export const MapNodeSchema: z.ZodType<MapNode> = z.lazy(() =>
  z
    .object({
      id: UUIDSchema,
      text: NodeTextSchema,
      collapsed: z.boolean(),
      style: NodeStyleSchema.optional(),
      children: z.array(MapNodeSchema),
    })
    .strict(),
);
export const MapFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().min(1),
    id: UUIDSchema,
    title: TitleSchema,
    tags: TagsSchema.default([]),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    root: MapNodeSchema,
  })
  .strict()
  .superRefine((map, ctx) => {
    const ids = new Set<string>();
    const nodes = [map.root];
    while (nodes.length) {
      const node = nodes.pop()!;
      if (ids.has(node.id))
        ctx.addIssue({
          code: "custom",
          path: ["root"],
          message: `Duplicate node ID: ${node.id}`,
        });
      ids.add(node.id);
      nodes.push(...node.children);
    }
  });
export type MapFile = z.infer<typeof MapFileSchema>;
export interface MapSummary {
  id: string;
  title: string;
  tags: string[];
  updatedAt?: string;
  error?: boolean;
}
export function summarize(map: MapFile): MapSummary {
  return {
    id: map.id,
    title: map.title,
    tags: map.tags,
    updatedAt: map.updatedAt,
  };
}

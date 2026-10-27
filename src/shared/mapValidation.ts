import {
  CURRENT_SCHEMA_VERSION,
  MIN_SCHEMA_VERSION,
  MapFileSchema,
  type MapFile,
} from "./schema.js";

export class SchemaVersionError extends Error {
  readonly status = 400;
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Shared by file loading and imports in both the browser and server.
export const migrations: Record<number, (old: unknown) => unknown> = {};
export function validateAndMigrate(input: unknown): MapFile {
  let value = input as Record<string, unknown>;
  const version = value?.schemaVersion;
  if (!Number.isInteger(version))
    throw new SchemaVersionError(
      "INVALID_SCHEMA",
      `Schema version ${String(version)} is not supported: schemaVersion must be an integer`,
    );
  if (Number(version) > CURRENT_SCHEMA_VERSION)
    throw new SchemaVersionError(
      "UNSUPPORTED_VERSION",
      `Schema version ${version} is not supported; exceeds supported maximum ${CURRENT_SCHEMA_VERSION}`,
    );
  if (Number(version) < MIN_SCHEMA_VERSION)
    throw new SchemaVersionError(
      "UNSUPPORTED_VERSION",
      `Schema version ${version} is not supported; too old to migrate; minimum is ${MIN_SCHEMA_VERSION}`,
    );
  for (let v = Number(version); v < CURRENT_SCHEMA_VERSION; v++) {
    if (!migrations[v])
      throw new SchemaVersionError(
        "UNSUPPORTED_VERSION",
        `Schema version ${v} is not supported: no migration is registered`,
      );
    value = migrations[v](value) as Record<string, unknown>;
  }
  return MapFileSchema.parse(value);
}

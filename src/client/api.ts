import type { MapFile, MapSummary } from "../shared/schema.js";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText, code: "REQUEST_FAILED" }));
    throw new ApiError(response.status, error.code, error.error);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const fetchMaps = () => request<MapSummary[]>("/maps");
export const createMap = (title: string) =>
  request<MapSummary>("/maps", "POST", { title });
export const fetchMap = (id: string) => request<MapFile>(`/maps/${id}`);
export const saveMap = (map: MapFile) =>
  request<MapFile>(`/maps/${map.id}`, "PUT", map);
export const renameMap = (id: string, title: string) =>
  request<MapSummary>(`/maps/${id}/title`, "PATCH", { title });
export const deleteMap = (id: string) => request<void>(`/maps/${id}`, "DELETE");
export const duplicateMap = (id: string) =>
  request<MapSummary>(`/maps/${id}/duplicate`, "POST");
export const fetchTrash = () => request<MapSummary[]>("/trash");
export const restoreMap = (id: string) =>
  request<void>(`/trash/${id}/restore`, "POST");
export const emptyTrash = () => request<void>("/trash", "DELETE");

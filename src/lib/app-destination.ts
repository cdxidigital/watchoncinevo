import type { Room } from "./cinevo-store";

export const APP_ROOMS = ["movies", "shows", "library", "tools", "browse"] as const;
export type AppRoomParam = (typeof APP_ROOMS)[number];

export const APP_CORES = ["libraries", "sharing", "stewardship", "ai"] as const;
export type AppCoreParam = (typeof APP_CORES)[number];

export type AppDestination = {
  room?: AppRoomParam;
  core?: AppCoreParam;
};

export function appDestination(search: Record<string, unknown>): AppDestination {
  const room = APP_ROOMS.includes(search.room as AppRoomParam) ? (search.room as AppRoomParam) : undefined;
  const core = APP_CORES.includes(search.core as AppCoreParam) ? (search.core as AppCoreParam) : undefined;
  return {
    ...(room ? { room } : {}),
    ...(core ? { core } : {}),
  };
}

export function roomFromParam(room: AppRoomParam | undefined): Room | undefined {
  if (!room) return undefined;
  if (room === "library") return "sidebar";
  return room;
}

export function paramFromRoom(room: Room): AppRoomParam | undefined {
  if (room === "stage") return undefined;
  if (room === "sidebar") return "library";
  return room;
}

export function isRoom(value: unknown): value is Room {
  return value === "stage" || value === "browse" || value === "movies" || value === "shows" || value === "sidebar" || value === "tools";
}

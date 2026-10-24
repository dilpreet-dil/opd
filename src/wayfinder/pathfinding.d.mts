export type HospitalEdge = [string, string, number, 'corridor' | 'lift' | 'stairs' | 'ramp'];
export type HospitalRoom = { id: string; name: string; type: string; floor: number; x: number; y: number; width: number; height: number; node: string; landmark: string };
export type HospitalMap = { hospital: string; floors: { id: string; label: string; level: number }[]; rooms: HospitalRoom[]; edges: HospitalEdge[]; corridors: { id: string; floor: number; path: string }[]; doors: { id: string; node: string; side: 'north' | 'south' | 'east' | 'west' }[] };
export function findRoute(hospital: HospitalMap, startId: string, goalId: string, accessible?: boolean): string[];
export function routeDistance(hospital: HospitalMap, route: string[]): number;

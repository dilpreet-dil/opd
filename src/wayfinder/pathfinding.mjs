/** Dijkstra shortest path over the walkable graph encoded in hospital-wayfinder.json. */
export function findRoute(hospital, startId, goalId, accessible = false) {
  const nodes = new Map(hospital.rooms.map((room) => [room.node, room]));
  if (!nodes.has(startId) || !nodes.has(goalId)) return [];
  if (startId === goalId) return [startId];

  // A zero heuristic makes this Dijkstra and guarantees minimum-distance routes.
  const heuristic = () => 0;
  const open = new Set([startId]);
  const cameFrom = new Map();
  const gScore = new Map([[startId, 0]]);
  const fScore = new Map([[startId, heuristic(startId)]]);
  while (open.size) {
    let current;
    for (const id of open) if (current === undefined || fScore.get(id) < fScore.get(current)) current = id;
    if (current === goalId) {
      const route = [current];
      while (cameFrom.has(route[0])) route.unshift(cameFrom.get(route[0]));
      return route;
    }
    open.delete(current);
    for (const [from, to, metres, kind] of hospital.edges) {
      if (accessible && kind === 'stairs') continue;
      const next = from === current ? to : to === current ? from : undefined;
      if (!next) continue;
      const candidate = gScore.get(current) + metres;
      if (candidate < (gScore.get(next) ?? Infinity)) {
        cameFrom.set(next, current);
        gScore.set(next, candidate);
        fScore.set(next, candidate + heuristic(next));
        open.add(next);
      }
    }
  }
  return [];
}

export function routeDistance(hospital, route) {
  let sum = 0;
  for (let i = 1; i < route.length; i++) {
    const edge = hospital.edges.find(([a, b]) => (a === route[i - 1] && b === route[i]) || (a === route[i] && b === route[i - 1]));
    if (edge) sum += edge[2];
  }
  return sum;
}

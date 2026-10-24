import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findRoute, routeDistance } from './pathfinding.mjs';

const hospital = JSON.parse(await readFile(new URL('../data/hospital-wayfinder.json', import.meta.url), 'utf8'));

test('routes between an entrance and OPD 3 across floors', () => {
  const route = findRoute(hospital, 'gate', 'room3');
  assert.equal(route[0], 'gate');
  assert.equal(route.at(-1), 'room3');
  assert.ok(route.includes('lift0') && route.includes('lift1'));
  assert.ok(routeDistance(hospital, route) > 0);
});

test('accessible route from the main gate to Ward 4 avoids stairs', () => {
  const route = findRoute(hospital, 'gate', 'ward4', true);
  assert.equal(route.at(-1), 'ward4');
  assert.ok(route.includes('lift0') && route.includes('lift1') && route.includes('lift2'));
  for (let i = 1; i < route.length; i++) {
    const edge = hospital.edges.find(([a, b]) => (a === route[i - 1] && b === route[i]) || (a === route[i] && b === route[i - 1]));
    assert.notEqual(edge?.[3], 'stairs');
  }
});

test('returns an empty route for an unknown or disconnected node', () => {
  assert.deepEqual(findRoute(hospital, 'missing', 'room1'), []);
  assert.deepEqual(findRoute({ ...hospital, edges: [] }, 'gate', 'room1'), []);
});

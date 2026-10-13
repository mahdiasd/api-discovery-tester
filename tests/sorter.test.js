import { test } from 'node:test';
import assert from 'node:assert';
import { sortEndpoints, getRiskLevelForMethod } from '../scripts/dependency-sorter.js';

test('getRiskLevelForMethod returns correct risk classifications', () => {
  assert.strictEqual(getRiskLevelForMethod('GET'), 'SAFE');
  assert.strictEqual(getRiskLevelForMethod('head'), 'SAFE');
  assert.strictEqual(getRiskLevelForMethod('OPTIONS'), 'SAFE');
  assert.strictEqual(getRiskLevelForMethod('POST'), 'MUTATING');
  assert.strictEqual(getRiskLevelForMethod('put'), 'MUTATING');
  assert.strictEqual(getRiskLevelForMethod('PATCH'), 'MUTATING');
  assert.strictEqual(getRiskLevelForMethod('DELETE'), 'DESTRUCTIVE');
});

test('sortEndpoints correctly orders linear dependencies and assigns executionOrder', () => {
  const rawEndpoints = [
    { id: 'delete-user', method: 'DELETE', path: '/users/:id', dependsOn: ['get-user'] },
    { id: 'get-user', method: 'GET', path: '/users/:id', dependsOn: ['post-user'] },
    { id: 'post-user', method: 'POST', path: '/users', dependsOn: [] },
    { id: 'get-health', method: 'GET', path: '/health', dependsOn: [] }
  ];

  const sorted = sortEndpoints(rawEndpoints);

  assert.strictEqual(sorted.length, 4);

  const orderMap = new Map();
  sorted.forEach(ep => orderMap.set(ep.id, ep.executionOrder));

  // post-user must precede get-user
  assert.ok(orderMap.get('post-user') < orderMap.get('get-user'), 'post-user must come before get-user');
  // get-user must precede delete-user
  assert.ok(orderMap.get('get-user') < orderMap.get('delete-user'), 'get-user must come before delete-user');

  // Verify safe vs mutating default selection
  const postEp = sorted.find(ep => ep.id === 'post-user');
  const getEp = sorted.find(ep => ep.id === 'get-health');
  assert.strictEqual(postEp.defaultSelected, false, 'Mutating must not be selected by default');
  assert.strictEqual(getEp.defaultSelected, true, 'Safe must be selected by default');
});

test('sortEndpoints safely handles circular dependencies without hanging', () => {
  const circularEndpoints = [
    { id: 'ep-a', method: 'GET', path: '/a', dependsOn: ['ep-b'] },
    { id: 'ep-b', method: 'GET', path: '/b', dependsOn: ['ep-a'] }
  ];

  const sorted = sortEndpoints(circularEndpoints);
  assert.strictEqual(sorted.length, 2);
  assert.strictEqual(sorted[0].executionOrder, 1);
  assert.strictEqual(sorted[1].executionOrder, 2);
});

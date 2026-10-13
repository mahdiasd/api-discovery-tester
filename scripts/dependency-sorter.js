/**
 * Dependency Sorter for API Endpoints using Topological Sorting (DAG)
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const DESTRUCTIVE_METHODS = new Set(['DELETE']);

/**
 * Determines risk level based on HTTP method.
 * @param {string} method 
 * @returns {'SAFE' | 'MUTATING' | 'DESTRUCTIVE'}
 */
export function getRiskLevelForMethod(method) {
  const upper = (method || '').toUpperCase();
  if (SAFE_METHODS.has(upper)) return 'SAFE';
  if (DESTRUCTIVE_METHODS.has(upper)) return 'DESTRUCTIVE';
  return 'MUTATING';
}

/**
 * Sorts API endpoints based on dependency relationships (DAG) and risk levels.
 * @param {Array<object>} endpoints 
 * @returns {Array<object>}
 */
export function sortEndpoints(endpoints = []) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return [];
  }

  // Clone endpoints and normalize attributes
  const nodeMap = new Map();
  endpoints.forEach((ep, idx) => {
    const id = ep.id || `ep-${idx + 1}`;
    const method = (ep.method || 'GET').toUpperCase();
    const riskLevel = ep.riskLevel || getRiskLevelForMethod(method);
    const dependsOn = Array.isArray(ep.dependsOn) ? [...ep.dependsOn] : [];
    
    // SAFE endpoints default to selected; MUTATING/DESTRUCTIVE must default to false
    const defaultSelected = riskLevel === 'SAFE';

    nodeMap.set(id, {
      ...ep,
      id,
      method,
      riskLevel,
      dependsOn,
      defaultSelected
    });
  });

  // Build dependency graph
  // If A depends on B, then B must precede A (directed edge B -> A)
  const inDegree = new Map();
  const adj = new Map();

  for (const id of nodeMap.keys()) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const [id, node] of nodeMap.entries()) {
    for (const depId of node.dependsOn) {
      if (nodeMap.has(depId)) {
        adj.get(depId).push(id);
        inDegree.set(id, inDegree.get(id) + 1);
      }
    }
  }

  // Priority Queue / Kahn's algorithm
  // For nodes with inDegree 0:
  // SAFE methods come first, then alphabetical or original order
  const getPriority = (id) => {
    const node = nodeMap.get(id);
    if (node.riskLevel === 'SAFE') return 1;
    if (node.riskLevel === 'MUTATING') return 2;
    return 3;
  };

  const available = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      available.push(id);
    }
  }

  available.sort((a, b) => getPriority(a) - getPriority(b));

  const sortedOrder = [];
  const visited = new Set();

  while (available.length > 0) {
    const currentId = available.shift();
    sortedOrder.push(currentId);
    visited.add(currentId);

    const neighbors = adj.get(currentId) || [];
    for (const neighborId of neighbors) {
      inDegree.set(neighborId, inDegree.get(neighborId) - 1);
      if (inDegree.get(neighborId) === 0) {
        available.push(neighborId);
      }
    }

    available.sort((a, b) => getPriority(a) - getPriority(b));
  }

  // Detect and resolve any cycle
  if (sortedOrder.length < nodeMap.size) {
    for (const id of nodeMap.keys()) {
      if (!visited.has(id)) {
        sortedOrder.push(id);
        visited.add(id);
      }
    }
  }

  // Assign executionOrder
  return sortedOrder.map((id, index) => {
    const node = nodeMap.get(id);
    return {
      ...node,
      executionOrder: index + 1
    };
  });
}

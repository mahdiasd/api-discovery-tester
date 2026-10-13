/**
 * Dependency Sorter for API Endpoints using Topological Sorting (DAG)
 * Prioritizes Authentication/Login endpoints first, followed by config, safe reads, mutations, and logout/destructions.
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
 * Checks if endpoint is an authentic primary authentication / login endpoint.
 */
export function isAuthLoginEndpoint(ep) {
  const p = (ep.path || '').toLowerCase();
  const id = (ep.id || '').toLowerCase();

  if (p.includes('event') || p.includes('history') || p.includes('summary')) {
    return false;
  }

  return (
    p.endsWith('/login') ||
    p.includes('/auth/login') ||
    p.includes('/oauth/token') ||
    id === 'post-v1-auth-login' ||
    id === 'post-auth-login' ||
    id === 'post-login'
  );
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
    const isLogin = isAuthLoginEndpoint({ ...ep, id, path: ep.path });
    
    // SAFE endpoints default to selected (true); mutating/destructive default to false
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

  // Priority Score:
  // -1: Primary User Login (ALWAYS FIRST to obtain token/session)
  //  0: Session exchange / replace / refresh
  //  1: Config / Settings / Metadata
  //  2: Safe Collection GET
  //  3: Parameterized GET
  //  4: Mutating (POST / PUT)
  //  8: Logout / Teardown
  //  9: Destructive (DELETE)
  const getPriority = (id) => {
    const node = nodeMap.get(id);
    const p = (node.path || '').toLowerCase();
    const isPrimaryLogin = isAuthLoginEndpoint(node);
    const isLogout = p.includes('/logout') || node.id.includes('logout');

    if (isPrimaryLogin) return -1;
    if (p.includes('/replace') || p.includes('/refresh')) return 0;
    if (p.includes('/config')) return 1;
    if (node.riskLevel === 'SAFE' && !p.includes(':') && !p.includes('{')) return 2;
    if (node.riskLevel === 'SAFE') return 3;
    if (node.riskLevel === 'MUTATING' && !isLogout) return 4;
    if (isLogout) return 8;
    if (node.riskLevel === 'DESTRUCTIVE') return 9;
    return 5;
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

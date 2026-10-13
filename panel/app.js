let currentManifest = null;
let eventSource = null;
let totalSelected = 0;
let passedCount = 0;
let failedCount = 0;

// Store execution results for inspection drawer: endpointId -> executionResult
const executionResults = new Map();

// DOM Elements
const projectTitle = document.getElementById('project-title');
const statusPill = document.getElementById('status-pill');
const themeToggleBtn = document.getElementById('theme-toggle-btn');

const baseUrlInput = document.getElementById('base-url-input');
const envUrlsSelect = document.getElementById('env-urls-select');
const authModeSelect = document.getElementById('auth-mode-select');
const authTokenGroup = document.getElementById('auth-token-group');
const authTokenLabel = document.getElementById('auth-token-label');
const authTokenInput = document.getElementById('auth-token-input');
const authOtpGroup = document.getElementById('auth-otp-group');
const authOtpInput = document.getElementById('auth-otp-input');

const endpointSearchInput = document.getElementById('endpoint-search-input');
const endpointsTbody = document.getElementById('endpoints-tbody');
const masterCheckbox = document.getElementById('master-checkbox');
const selectSafeBtn = document.getElementById('select-safe-btn');
const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');

const startTestBtn = document.getElementById('start-test-btn');
const stopTestBtn = document.getElementById('stop-test-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');

const statTotal = document.getElementById('stat-total');
const statSelected = document.getElementById('stat-selected');
const statPassed = document.getElementById('stat-passed');
const statFailed = document.getElementById('stat-failed');

// Inspector Drawer Elements
const inspectorDrawer = document.getElementById('inspector-drawer');
const closeDrawerBtn = document.getElementById('close-drawer-btn');
const inspectMethodBadge = document.getElementById('inspect-method-badge');
const inspectTitle = document.getElementById('inspect-title');
const inspectDiagCard = document.getElementById('inspect-diag-card');
const inspectDiagCategory = document.getElementById('inspect-diag-category');
const inspectDiagMsg = document.getElementById('inspect-diag-msg');
const inspectDiagFix = document.getElementById('inspect-diag-fix');
const inspectUrl = document.getElementById('inspect-url');
const inspectFilePath = document.getElementById('inspect-file-path');
const inspectReqHeaders = document.getElementById('inspect-req-headers');
const inspectReqBody = document.getElementById('inspect-req-body');
const inspectRespStatus = document.getElementById('inspect-resp-status');
const inspectRespHeaders = document.getElementById('inspect-resp-headers');
const inspectRespBody = document.getElementById('inspect-resp-body');

// Summary Modal Elements
const summaryModal = document.getElementById('summary-modal');
const modalSummaryText = document.getElementById('modal-summary-text');
const modalDismissBtn = document.getElementById('modal-dismiss-btn');

/**
 * Initializes workbench state and binds event handlers.
 */
async function initApp() {
  setupTheme();
  setupAuthModeSwitcher();
  setupSelectionHandlers();
  setupExecutionHandlers();
  setupSearchFilter();
  setupDrawer();

  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load config`);
    currentManifest = await res.json();
    renderManifest(currentManifest);
  } catch (err) {
    projectTitle.textContent = 'Failed to load project manifest';
    endpointsTbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:var(--status-failed)">${err.message}</td></tr>`;
  }
}

/**
 * Handles Dark/Light Theme Switching.
 */
function setupTheme() {
  const savedTheme = localStorage.getItem('api_workbench_theme') || 'theme-dark';
  document.body.className = savedTheme;

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const isDark = document.body.classList.contains('theme-dark');
      const newTheme = isDark ? 'theme-light' : 'theme-dark';
      document.body.className = newTheme;
      localStorage.setItem('api_workbench_theme', newTheme);
    });
  }
}

/**
 * Updates auth input fields based on selected auth mode.
 */
function updateAuthVisibility() {
  const mode = authModeSelect.value;
  if (mode === 'none') {
    authTokenGroup.classList.add('hidden');
    authOtpGroup.classList.add('hidden');
  } else if (mode === 'two_factor_otp') {
    authTokenGroup.classList.remove('hidden');
    authTokenLabel.textContent = 'Token / Password';
    authOtpGroup.classList.remove('hidden');
  } else if (mode === 'custom_header') {
    authTokenGroup.classList.remove('hidden');
    authTokenLabel.textContent = 'API Key / Secret';
    authOtpGroup.classList.add('hidden');
  } else {
    // bearer_token or login_credentials
    authTokenGroup.classList.remove('hidden');
    authTokenLabel.textContent = 'Bearer Token';
    authOtpGroup.classList.add('hidden');
  }
}

function setupAuthModeSwitcher() {
  authModeSelect.addEventListener('change', updateAuthVisibility);
}

/**
 * Renders loaded manifest in the workbench.
 */
function renderManifest(manifest) {
  projectTitle.textContent = manifest.projectName || 'Frontend Application';

  // Base URLs
  baseUrlInput.value = manifest.defaultBaseUrl || '';
  envUrlsSelect.innerHTML = '<option value="">-- Discovered Targets --</option>';
  (manifest.baseUrls || []).forEach(url => {
    const opt = document.createElement('option');
    opt.value = url;
    opt.textContent = url;
    envUrlsSelect.appendChild(opt);
  });

  envUrlsSelect.addEventListener('change', () => {
    if (envUrlsSelect.value) {
      baseUrlInput.value = envUrlsSelect.value;
    }
  });

  // Auth setup
  if (manifest.auth) {
    authModeSelect.value = manifest.auth.mode || 'bearer_token';
    authTokenInput.value = manifest.auth.token || '';
    if (manifest.auth.requiresOtp) {
      authModeSelect.value = 'two_factor_otp';
    }
    updateAuthVisibility();
  }

  // Endpoints list
  renderEndpointsTable(manifest.endpoints || []);
}

/**
 * Renders the table of endpoints.
 */
function renderEndpointsTable(endpoints) {
  if (endpoints.length === 0) {
    endpointsTbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-8">No endpoints discovered in project.</td></tr>';
    updateStats();
    return;
  }

  endpointsTbody.innerHTML = '';
  endpoints.forEach(ep => {
    const tr = document.createElement('tr');
    tr.id = `row-${ep.id}`;
    tr.dataset.endpointId = ep.id;
    tr.dataset.search = `${ep.name} ${ep.path} ${ep.method}`.toLowerCase();

    const methodLower = (ep.method || 'get').toLowerCase();
    const riskBadgeClass = ep.riskLevel === 'SAFE' 
      ? 'badge-risk-safe' 
      : ep.riskLevel === 'MUTATING' 
        ? 'badge-risk-mutating' 
        : 'badge-risk-destructive';
    
    const riskLabel = ep.riskLevel === 'SAFE' ? 'SAFE' : ep.riskLevel === 'MUTATING' ? 'MUTATING' : 'DESTRUCTIVE';

    const depsText = (ep.dependsOn && ep.dependsOn.length > 0)
      ? ep.dependsOn.map(d => `<span class="badge text-xs">${d}</span>`).join(' ')
      : '<span class="text-muted text-xs">None</span>';

    tr.innerHTML = `
      <td><input type="checkbox" class="endpoint-checkbox" data-id="${ep.id}" data-risk="${ep.riskLevel}" ${ep.defaultSelected ? 'checked' : ''}></td>
      <td class="text-center text-muted font-mono">${ep.executionOrder || '-'}</td>
      <td><span class="badge badge-method badge-method-${methodLower}">${ep.method}</span></td>
      <td>
        <div class="endpoint-name">${ep.name}</div>
        <div class="code-font text-muted text-xs">${ep.path}</div>
      </td>
      <td><span class="badge ${riskBadgeClass}">${riskLabel}</span></td>
      <td>${depsText}</td>
      <td id="status-${ep.id}" class="status-cell text-muted"><span class="status-tag status-idle">Pending</span></td>
      <td class="text-center">
        <button class="btn btn-sm btn-secondary inspect-btn" data-id="${ep.id}" title="Inspect Request & Response">Inspect</button>
      </td>
    `;

    // Row click inspect trigger (when clicking inspect button or row)
    tr.querySelector('.inspect-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openInspector(ep.id);
    });

    endpointsTbody.appendChild(tr);
  });

  updateStats();
}

/**
 * Filter table rows dynamically based on user search term.
 */
function setupSearchFilter() {
  if (!endpointSearchInput) return;
  endpointSearchInput.addEventListener('input', () => {
    const term = endpointSearchInput.value.toLowerCase().trim();
    const rows = endpointsTbody.querySelectorAll('tr[data-search]');
    rows.forEach(row => {
      if (!term || row.dataset.search.includes(term)) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
  });
}

/**
 * Sets up checklist handlers and metrics recalculation.
 */
function setupSelectionHandlers() {
  masterCheckbox.addEventListener('change', () => {
    const checked = masterCheckbox.checked;
    document.querySelectorAll('.endpoint-checkbox').forEach(cb => {
      cb.checked = checked;
    });
    updateStats();
  });

  endpointsTbody.addEventListener('change', (e) => {
    if (e.target.classList.contains('endpoint-checkbox')) {
      updateStats();
    }
  });

  selectSafeBtn.addEventListener('click', () => {
    document.querySelectorAll('.endpoint-checkbox').forEach(cb => {
      cb.checked = (cb.dataset.risk === 'SAFE');
    });
    updateStats();
  });

  selectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.endpoint-checkbox').forEach(cb => cb.checked = true);
    masterCheckbox.checked = true;
    updateStats();
  });

  deselectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.endpoint-checkbox').forEach(cb => cb.checked = false);
    masterCheckbox.checked = false;
    updateStats();
  });
}

function updateStats() {
  const allCheckboxes = document.querySelectorAll('.endpoint-checkbox');
  const checkedBoxes = document.querySelectorAll('.endpoint-checkbox:checked');

  statTotal.textContent = allCheckboxes.length;
  statSelected.textContent = checkedBoxes.length;
  totalSelected = checkedBoxes.length;
}

/**
 * Slide-over Inspector Drawer controls
 */
function setupDrawer() {
  closeDrawerBtn.addEventListener('click', () => {
    inspectorDrawer.classList.add('hidden');
  });

  modalDismissBtn.addEventListener('click', () => {
    summaryModal.classList.add('hidden');
  });
}

function openInspector(endpointId) {
  const ep = (currentManifest?.endpoints || []).find(e => e.id === endpointId);
  if (!ep) return;

  const result = executionResults.get(endpointId);

  inspectMethodBadge.textContent = ep.method;
  inspectMethodBadge.className = `badge badge-method badge-method-${ep.method.toLowerCase()}`;
  inspectTitle.textContent = `${ep.name} (${ep.path})`;

  if (result) {
    inspectUrl.textContent = result.url || '-';
    inspectFilePath.textContent = result.savedFilePath || 'In-memory / Unsaved';
    inspectReqHeaders.textContent = JSON.stringify(result.requestHeaders || {}, null, 2);
    inspectReqBody.textContent = result.requestBody ? JSON.stringify(result.requestBody, null, 2) : 'None';
    
    inspectRespStatus.textContent = result.httpStatus ? `HTTP ${result.httpStatus} (${result.latencyMs}ms)` : 'Network Error';
    inspectRespStatus.className = result.success ? 'status-badge badge-risk-safe' : 'status-badge badge-risk-destructive';

    inspectRespHeaders.textContent = JSON.stringify(result.responseHeaders || {}, null, 2);
    inspectRespBody.textContent = result.responseBody ? JSON.stringify(result.responseBody, null, 2) : 'No response content';

    if (result.diagnostics) {
      inspectDiagCard.classList.remove('hidden');
      inspectDiagCategory.textContent = result.diagnostics.category;
      inspectDiagMsg.textContent = result.diagnostics.message;
      inspectDiagFix.textContent = result.diagnostics.suggestedFix;
    } else {
      inspectDiagCard.classList.add('hidden');
    }
  } else {
    // Has not been run yet
    inspectUrl.textContent = `${baseUrlInput.value.replace(/\/+$/, '')}${ep.path.startsWith('/') ? '' : '/'}${ep.path}`;
    inspectFilePath.textContent = 'Not executed yet';
    inspectReqHeaders.textContent = JSON.stringify(ep.defaultHeaders || {}, null, 2);
    inspectReqBody.textContent = ep.defaultBody ? JSON.stringify(ep.defaultBody, null, 2) : 'None';
    inspectRespStatus.textContent = 'Not Executed';
    inspectRespStatus.className = 'status-badge';
    inspectRespHeaders.textContent = '{}';
    inspectRespBody.textContent = 'Run this endpoint to capture live response.';
    inspectDiagCard.classList.add('hidden');
  }

  inspectorDrawer.classList.remove('hidden');
}

/**
 * Handles test run start, stop, and SSE streaming.
 */
function setupExecutionHandlers() {
  startTestBtn.addEventListener('click', startTestExecution);
  stopTestBtn.addEventListener('click', stopTestExecution);
}

async function startTestExecution() {
  const baseUrl = baseUrlInput.value.trim();
  if (!baseUrl) {
    alert('Please enter a target Base URL.');
    return;
  }

  const selectedIds = Array.from(document.querySelectorAll('.endpoint-checkbox:checked'))
    .map(cb => cb.dataset.id);

  if (selectedIds.length === 0) {
    alert('Please select at least one endpoint to test.');
    return;
  }

  // Reset counters & state
  passedCount = 0;
  failedCount = 0;
  statPassed.textContent = '0';
  statFailed.textContent = '0';
  executionResults.clear();

  document.querySelectorAll('.status-cell').forEach(cell => {
    cell.innerHTML = '<span class="status-tag status-idle">Pending</span>';
  });

  const authPayload = {
    mode: authModeSelect.value,
    token: authTokenInput.value.trim(),
    otpCode: authOtpInput.value.trim() || null
  };

  // Switch UI to running
  startTestBtn.classList.add('hidden');
  stopTestBtn.classList.remove('hidden');
  progressContainer.classList.remove('hidden');
  progressBar.style.width = '0%';
  statusPill.textContent = '● Running...';
  statusPill.className = 'pill pill-running';

  // Connect SSE
  connectSSE();

  try {
    const res = await fetch('/api/test/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl,
        auth: authPayload,
        selectedEndpointIds: selectedIds
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to start test execution');
    }
  } catch (err) {
    alert(`Execution failed: ${err.message}`);
    finishExecutionUI('error');
  }
}

async function stopTestExecution() {
  try {
    await fetch('/api/test/stop', { method: 'POST' });
  } catch (err) {
    console.error(err);
  }
  finishExecutionUI('aborted');
}

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/test/events');

  eventSource.addEventListener('step_start', (e) => {
    const data = JSON.parse(e.data);
    const cell = document.getElementById(`status-${data.endpointId}`);
    if (cell) {
      cell.innerHTML = '<span class="status-tag status-running"><span class="status-spinner"></span> Running...</span>';
    }
  });

  eventSource.addEventListener('step_finish', (e) => {
    const data = JSON.parse(e.data);
    executionResults.set(data.endpointId, data);

    const cell = document.getElementById(`status-${data.endpointId}`);

    if (data.success) {
      passedCount++;
      statPassed.textContent = passedCount;
      if (cell) {
        cell.innerHTML = `<span class="status-tag status-passed">✓ ${data.httpStatus} <span class="badge text-xs">${data.latencyMs}ms</span></span>`;
      }
    } else {
      failedCount++;
      statFailed.textContent = failedCount;
      if (cell) {
        cell.innerHTML = `<span class="status-tag status-failed">✗ ${data.httpStatus || 'ERR'} <span class="badge text-xs">${data.latencyMs}ms</span></span>`;
      }
    }

    // Update progress
    const completed = passedCount + failedCount;
    const pct = Math.min(100, Math.round((completed / (totalSelected || 1)) * 100));
    progressBar.style.width = `${pct}%`;
  });

  eventSource.addEventListener('run_complete', (e) => {
    const data = JSON.parse(e.data);
    finishExecutionUI(data.status);
    showSummaryModal();
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  });

  eventSource.onerror = () => {
    // SSE auto-reconnect handled by browser
  };
}

function showSummaryModal() {
  const total = passedCount + failedCount;
  modalSummaryText.innerHTML = `
    Executed <strong>${total}</strong> selected endpoints.<br>
    Passed: <strong style="color:var(--status-passed)">${passedCount}</strong> | 
    Failed: <strong style="color:var(--status-failed)">${failedCount}</strong>
  `;
  summaryModal.classList.remove('hidden');
}

function finishExecutionUI(status = 'completed') {
  startTestBtn.classList.remove('hidden');
  stopTestBtn.classList.add('hidden');
  
  if (status === 'aborted') {
    statusPill.textContent = '● Aborted';
    statusPill.className = 'pill pill-aborted';
  } else if (status === 'error') {
    statusPill.textContent = '● Error';
    statusPill.className = 'pill pill-error';
  } else {
    statusPill.textContent = '● Ready';
    statusPill.className = 'pill pill-idle';
  }
}

// Kick off
initApp();

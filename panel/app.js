let currentManifest = null;
let eventSource = null;
let totalSelected = 0;
let successCount = 0;
let errorCount = 0;

// DOM Elements
const projectTitle = document.getElementById('project-title');
const baseUrlInput = document.getElementById('base-url-input');
const envUrlsSelect = document.getElementById('env-urls-select');
const authModeSelect = document.getElementById('auth-mode-select');
const authTokenGroup = document.getElementById('auth-token-group');
const authTokenLabel = document.getElementById('auth-token-label');
const authTokenInput = document.getElementById('auth-token-input');
const authOtpGroup = document.getElementById('auth-otp-group');
const authOtpInput = document.getElementById('auth-otp-input');

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
const statSuccess = document.getElementById('stat-success');
const statError = document.getElementById('stat-error');

const diagSection = document.getElementById('diagnostics-section');
const diagCloseBtn = document.getElementById('diag-close-btn');
const diagCategoryBadge = document.getElementById('diag-category-badge');
const diagUrl = document.getElementById('diag-url');
const diagMessage = document.getElementById('diag-message');
const diagSuggestion = document.getElementById('diag-suggestion');
const diagFilePath = document.getElementById('diag-file-path');

const summarySection = document.getElementById('summary-section');
const summaryMetricsText = document.getElementById('summary-metrics-text');
const summaryDismissBtn = document.getElementById('summary-dismiss-btn');
const themeToggleBtn = document.getElementById('theme-toggle');

/**
 * Initializes app state and binds event handlers.
 */
async function initApp() {
  setupTheme();
  setupAuthModeSwitcher();
  setupSelectionHandlers();
  setupExecutionHandlers();

  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    currentManifest = await res.json();
    renderManifest(currentManifest);
  } catch (err) {
    projectTitle.textContent = 'خطا در بارگذاری اطلاعات پروژه';
    endpointsTbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--danger)">${err.message}</td></tr>`;
  }
}

/**
 * Handles Dark/Light Theme Switching.
 */
function setupTheme() {
  const savedTheme = localStorage.getItem('api_tester_theme') || 'theme-light';
  document.body.className = savedTheme;

  themeToggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.contains('theme-dark');
    const newTheme = isDark ? 'theme-light' : 'theme-dark';
    document.body.className = newTheme;
    localStorage.setItem('api_tester_theme', newTheme);
  });
}

/**
 * Renders loaded manifest in the UI.
 */
function renderManifest(manifest) {
  projectTitle.textContent = manifest.projectName || 'پروژه فرانت‌اند';

  // Base URLs
  baseUrlInput.value = manifest.defaultBaseUrl || '';
  envUrlsSelect.innerHTML = '<option value="">-- آدرس‌های محیطی --</option>';
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
 * Updates auth input fields based on selected auth mode.
 */
function updateAuthVisibility() {
  const mode = authModeSelect.value;
  if (mode === 'none') {
    authTokenGroup.classList.add('hidden');
    authOtpGroup.classList.add('hidden');
  } else if (mode === 'two_factor_otp') {
    authTokenGroup.classList.remove('hidden');
    authTokenLabel.textContent = 'توکن موقت یا اولیه:';
    authOtpGroup.classList.remove('hidden');
  } else if (mode === 'custom_header') {
    authTokenGroup.classList.remove('hidden');
    authTokenLabel.textContent = 'مقدار کلید (API Key):';
    authOtpGroup.classList.add('hidden');
  } else {
    // bearer_token or login_credentials
    authTokenGroup.classList.remove('hidden');
    authTokenLabel.textContent = 'توکن احراز هویت (Bearer):';
    authOtpGroup.classList.add('hidden');
  }
}

function setupAuthModeSwitcher() {
  authModeSelect.addEventListener('change', updateAuthVisibility);
}

/**
 * Renders the table of endpoints.
 */
function renderEndpointsTable(endpoints) {
  if (endpoints.length === 0) {
    endpointsTbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">هیچ وب‌سرویسی یافت نشد.</td></tr>';
    updateStats();
    return;
  }

  endpointsTbody.innerHTML = '';
  endpoints.forEach(ep => {
    const tr = document.createElement('tr');
    tr.id = `row-${ep.id}`;

    const methodLower = (ep.method || 'get').toLowerCase();
    const riskBadgeClass = ep.riskLevel === 'SAFE' ? 'badge-risk-safe' : ep.riskLevel === 'MUTATING' ? 'badge-risk-mutating' : 'badge-risk-destructive';
    const riskLabel = ep.riskLevel === 'SAFE' ? 'ایمن' : ep.riskLevel === 'MUTATING' ? 'نوشتنی' : 'حذف داده';
    const depsText = (ep.dependsOn && ep.dependsOn.length > 0) ? ep.dependsOn.map(d => `<span class="badge">${d}</span>`).join(' ') : '<span class="text-muted">-</span>';

    tr.innerHTML = `
      <td><input type="checkbox" class="endpoint-checkbox" data-id="${ep.id}" data-risk="${ep.riskLevel}" ${ep.defaultSelected ? 'checked' : ''}></td>
      <td class="text-center text-muted">${ep.executionOrder || '-'}</td>
      <td><span class="badge badge-method badge-method-${methodLower}">${ep.method}</span></td>
      <td>
        <strong>${ep.name}</strong>
        <div class="code-font text-muted text-sm" dir="ltr" style="text-align:right">${ep.path}</div>
      </td>
      <td><span class="badge ${riskBadgeClass}">${riskLabel}</span></td>
      <td>${depsText}</td>
      <td id="status-${ep.id}" class="status-cell text-muted">-</td>
    `;

    endpointsTbody.appendChild(tr);
  });

  updateStats();
}

/**
 * Sets up checklist buttons.
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
 * Handles test run start, stop, and SSE streaming.
 */
function setupExecutionHandlers() {
  startTestBtn.addEventListener('click', startTestExecution);
  stopTestBtn.addEventListener('click', stopTestExecution);

  diagCloseBtn.addEventListener('click', () => {
    diagSection.classList.add('hidden');
  });

  summaryDismissBtn.addEventListener('click', () => {
    summarySection.classList.add('hidden');
  });
}

async function startTestExecution() {
  const baseUrl = baseUrlInput.value.trim();
  if (!baseUrl) {
    alert('لطفاً آدرس پایه (Base URL) را وارد کنید.');
    return;
  }

  const selectedIds = Array.from(document.querySelectorAll('.endpoint-checkbox:checked'))
    .map(cb => cb.dataset.id);

  if (selectedIds.length === 0) {
    alert('حداقل یک وب‌سرویس را برای تست انتخاب کنید.');
    return;
  }

  // Reset status indicators
  successCount = 0;
  errorCount = 0;
  statSuccess.textContent = '0';
  statError.textContent = '0';
  diagSection.classList.add('hidden');
  summarySection.classList.add('hidden');

  document.querySelectorAll('.status-cell').forEach(cell => {
    cell.innerHTML = '<span class="text-muted">-</span>';
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

  // Connect to SSE stream
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
      throw new Error(err.error || 'خطا در شروع تست');
    }
  } catch (err) {
    alert(`شروع تست با خطا مواجه شد: ${err.message}`);
    finishExecutionUI();
  }
}

async function stopTestExecution() {
  try {
    await fetch('/api/test/stop', { method: 'POST' });
  } catch (err) {
    console.error(err);
  }
  finishExecutionUI();
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
      cell.innerHTML = '<span class="status-tag"><span class="status-spinner"></span> در حال اجرا...</span>';
    }
  });

  eventSource.addEventListener('step_finish', (e) => {
    const data = JSON.parse(e.data);
    const cell = document.getElementById(`status-${data.endpointId}`);

    if (data.success) {
      successCount++;
      statSuccess.textContent = successCount;
      if (cell) {
        cell.innerHTML = `<span class="status-tag status-passed">✓ ${data.httpStatus} <span class="badge text-sm">${data.latencyMs}ms</span></span>`;
      }
    } else {
      errorCount++;
      statError.textContent = errorCount;
      if (cell) {
        cell.innerHTML = `<span class="status-tag status-failed">✗ ${data.httpStatus || 'ERR'} <span class="badge text-sm">${data.latencyMs}ms</span></span>`;
      }
      showDiagnostics(data);
    }

    // Update progress
    const completed = successCount + errorCount;
    const pct = Math.min(100, Math.round((completed / (totalSelected || 1)) * 100));
    progressBar.style.width = `${pct}%`;
  });

  eventSource.addEventListener('run_complete', (e) => {
    const data = JSON.parse(e.data);
    finishExecutionUI();
    showSummary(data);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  });

  eventSource.onerror = () => {
    // Graceful reconnect handled by browser
  };
}

function showDiagnostics(data) {
  diagSection.classList.remove('hidden');
  diagUrl.textContent = `${data.method} ${data.url}`;
  diagFilePath.textContent = data.savedFilePath || '';

  if (data.diagnostics) {
    diagCategoryBadge.textContent = data.diagnostics.category;
    diagMessage.textContent = data.diagnostics.message;
    diagSuggestion.textContent = data.diagnostics.suggestedFix;
  } else {
    diagCategoryBadge.textContent = `STATUS_${data.httpStatus}`;
    diagMessage.textContent = `پاسخ با کد ${data.httpStatus} خاتمه یافت.`;
    diagSuggestion.textContent = 'فایل پاسخ را بررسی نمایید.';
  }
}

function showSummary(data) {
  summarySection.classList.remove('hidden');
  summaryMetricsText.innerHTML = `
    تعداد کل تست‌های اجراشده: <strong>${successCount + errorCount}</strong> | 
    موفق: <span style="color:var(--success)">${successCount}</span> | 
    ناموفق: <span style="color:var(--danger)">${errorCount}</span>
  `;
}

function finishExecutionUI() {
  startTestBtn.classList.remove('hidden');
  stopTestBtn.classList.add('hidden');
}

// Kick off
initApp();

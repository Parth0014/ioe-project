(() => {
  const STORAGE_KEY = 'gridscope.value-recording.v1';
  const MAX_ENTRIES = 4000;
  const LABELS = {
    BOTH_OFF: 'Both bulbs off',
    ZONE_A_ON: 'Zone A on',
    ZONE_B_ON: 'Zone B on',
    ALL_ZONES_ON: 'All zones on'
  };
  const $ = id => document.getElementById(id);
  let entries = [];
  let recording = false;
  let currentState = '';
  let sessionId = '';
  let latest = null;
  let storageError = '';

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    entries = Array.isArray(saved.entries) ? saved.entries.slice(-MAX_ENTRIES) : [];
    recording = saved.recording === true;
    currentState = LABELS[saved.currentState] ? saved.currentState : '';
    sessionId = typeof saved.sessionId === 'string' ? saved.sessionId : '';
    if (recording && !sessionId) recording = false;
  } catch {
    storageError = 'Saved recording data could not be read. Export may be unavailable.';
  }

  function persist() {
    entries = entries.slice(-MAX_ENTRIES);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, recording, currentState, sessionId }));
      storageError = '';
    } catch {
      storageError = 'Browser storage is full or unavailable. Export your flow to keep a copy.';
    }
  }

  const clearInput = $('recorder-clear-confirm');
  const clearButton = $('recorder-clear-button');
  const clearStatus = $('recorder-clear-status');
  clearInput.addEventListener('input', () => {
    clearButton.hidden = clearInput.value.trim().toLowerCase() !== 'clear data';
    clearStatus.textContent = '';
  });
  clearButton.addEventListener('click', () => {
    if (clearInput.value.trim().toLowerCase() !== 'clear data') return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      clearStatus.textContent = 'Could not clear browser storage. Check browser storage permissions and try again.';
      return;
    }
    entries = [];
    recording = false;
    currentState = '';
    sessionId = '';
    storageError = '';
    clearInput.value = '';
    clearButton.hidden = true;
    clearStatus.textContent = 'Recording data cleared from this browser.';
    render();
  });

  function readingFields(state) {
    const r = state?.latest || state?.last_known || {};
    return {
      mode: state?.mode || '',
      source: state?.source || state?.transport || '',
      connection: state?.connection || '',
      port: state?.port || '',
      main_ma: r.main_ma ?? '',
      zone_a_ma: r.branch_a_ma ?? '',
      zone_b_ma: r.branch_b_ma ?? '',
      total_w: r.main_w ?? '',
      zone_a_w: r.branch_a_w ?? '',
      zone_b_w: r.branch_b_w ?? '',
      raw_packet: state?.last_packet || ''
    };
  }

  function addEntry(kind, message, state = latest) {
    entries.push({
      timestamp: Date.now(),
      session_id: sessionId,
      kind,
      state: currentState,
      message,
      ...readingFields(state)
    });
    persist();
    render();
  }

  function localTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function render() {
    const start = $('record-toggle');
    const status = $('recorder-status');
    const list = $('recorder-flow');
    if (!start || !status || !list) return;

    start.textContent = recording ? 'Stop recording' : 'Start recording';
    start.classList.toggle('is-recording', recording);
    start.setAttribute('aria-pressed', String(recording));
    const waitingForUsb = recording && (!latest || (latest.mode === 'LIVE' && latest.connection !== 'CONNECTED'));
    status.textContent = storageError || (recording ? waitingForUsb ? 'Recording · Waiting for USB readings' : 'Recording' : 'Not recording');
    status.classList.toggle('is-recording', recording && !waitingForUsb);
    status.classList.toggle('is-waiting', waitingForUsb);
    status.classList.toggle('has-error', Boolean(storageError));
    const hint = $('recorder-hint');
    hint.classList.toggle('is-waiting', waitingForUsb);
    if (!recording) {
      hint.textContent = 'Set the bulbs yourself; these buttons add notes and do not control the circuits. A reading is captured on each dashboard refresh. This browser keeps up to 4,000 recent entries.';
    } else if (waitingForUsb) {
      const port = latest?.port ? ` on ${latest.port}` : '';
      const reason = latest?.error || `No fresh readings are arriving${port}.`;
      hint.textContent = `${reason} Check that the ESP8266 is powered by a USB data cable, its USB firmware is running, and Arduino Serial Monitor is closed. Stored chart history is not copied into this live recording.`;
    } else {
      hint.textContent = 'Live values are being saved on each dashboard refresh. Use the markers when you change the physical bulbs. This browser keeps up to 4,000 recent entries.';
    }

    document.querySelectorAll('[data-record-state]').forEach(button => {
      button.disabled = !recording;
      button.setAttribute('aria-pressed', String(button.dataset.recordState === currentState));
    });

    const samples = entries.filter(entry => entry.kind === 'reading').length;
    $('recorder-count').textContent = `${entries.length} entries · ${samples} readings`;
    $('recorder-current-state').textContent = LABELS[currentState] || 'No state marked';
    $('record-export').disabled = entries.length === 0;

    list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'recorder-empty';
      empty.textContent = 'Start recording, then add a marker when you change a bulb.';
      list.append(empty);
      return;
    }

    entries.slice(-40).reverse().forEach(entry => {
      const row = document.createElement('li');
      row.className = `recorder-entry recorder-entry--${entry.kind}`;
      const time = document.createElement('time');
      time.dateTime = new Date(entry.timestamp).toISOString();
      time.textContent = localTime(entry.timestamp);
      const description = document.createElement('span');
      description.className = 'recorder-entry__message';
      description.textContent = entry.kind === 'reading'
        ? `Reading · ${LABELS[entry.state] || 'No state marker'}`
        : entry.message;
      const values = document.createElement('span');
      values.className = 'recorder-entry__values';
      values.textContent = entry.main_ma === ''
        ? 'No live reading at this marker'
        : `A ${Number(entry.zone_a_ma).toFixed(0)} mA · B ${Number(entry.zone_b_ma).toFixed(0)} mA · ${Number(entry.total_w).toFixed(1)} W`;
      row.append(time, description, values);
      list.append(row);
    });
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    if (!entries.length) return;
    const columns = ['timestamp', 'session_id', 'kind', 'message', 'state', 'mode', 'source', 'connection', 'port',
      'main_ma', 'zone_a_ma', 'zone_b_ma', 'total_w', 'zone_a_w', 'zone_b_w', 'raw_packet'];
    const csv = [columns.join(','), ...entries.map(entry => columns.map(key => csvCell(
      key === 'timestamp' ? new Date(entry.timestamp).toISOString() : entry[key]
    )).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `gridscope-value-recording-${new Date().toISOString().replaceAll(':', '-').slice(0, 16)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('record-toggle').addEventListener('click', () => {
    if (recording) {
      addEntry('session', 'Recording stopped');
      recording = false;
      currentState = '';
      sessionId = '';
      persist();
      render();
      return;
    }
    recording = true;
    currentState = '';
    sessionId = globalThis.crypto?.randomUUID?.() || `session-${Date.now()}`;
    addEntry('session', 'Recording started');
  });

  document.querySelectorAll('[data-record-state]').forEach(button => {
    button.addEventListener('click', () => {
      if (!recording) return;
      currentState = button.dataset.recordState;
      addEntry('marker', LABELS[currentState]);
    });
  });

  $('record-export').addEventListener('click', exportCsv);

  window.addEventListener('gridscope:telemetry', event => {
    latest = event.detail;
    if (!recording || !latest?.latest || !['CONNECTED', 'SIMULATION'].includes(latest.connection)) {
      render();
      return;
    }
    addEntry('reading', 'Reading captured');
  });

  if (recording) addEntry('session', 'Recording resumed after page reload');
  else render();
})();

/* ================= app.js — Footfall Prediction (frontend) =================
 - This file contains all JavaScript for the Footfall Prediction demo.
 - It programmatically generates a large embedded SAMPLE_DATA set (1000 days)
   so you don't need to upload a CSV to try the app.
 - Attach this file at the end of your HTML body:
     <script src="app.js"></script>

 NOTE: This keeps the file size reasonable while still "including" the full
 dataset inside the script (it's programmatically produced at runtime).
 ===========================================================================*/

/* ------------------------ SAMPLE DATA GENERATOR (1000 days) -------------- */
function generateSampleData(startISO = '2022-01-01', days = 1000) {
  const start = new Date(startISO + 'T00:00:00');
  const out = [];
  // base visitor counts change by location; we add seasonality and noise
  let base = 80 + Math.random() * 60; // between 80 and 140

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    // weekly pattern: weekends higher
    const weekday = d.getDay(); // 0 sun .. 6 sat
    const weeklyFactor = (weekday === 0 || weekday === 6) ? 1.6 : 0.95;
    // monthly/seasonal pattern: simulate travel seasons with a sine wave
    const month = d.getMonth();
    const seasonal = 1 + 0.25 * Math.sin((2 * Math.PI * (i / 365)) + (month * 0.15));
    // festival spikes (roughly every 90 days) to mimic temple festivals / events
    const festivalSpike = (i % 90 === 5) ? (30 + Math.random() * 120) : 0;
    // slow trend and random walk
    const trend = 1 + (i / days) * 0.35; // up to +35% over dataset
    const noise = (Math.random() - 0.5) * 30; // +/-15 on average

    const value = Math.max(0, base * weeklyFactor * seasonal * trend + noise + festivalSpike);
    out.push({ date: d.toISOString().slice(0, 10), count: Math.round(value) });

    // small random drift in base occasionally
    if (Math.random() < 0.02) base *= 0.95 + Math.random() * 0.08;
  }
  return out;
}

// create global SAMPLE_DATA of 1000 days
const SAMPLE_DATA = generateSampleData('2022-01-01', 1000);

/* ------------------------------- UTILITIES ------------------------------- */
function parseCSVText(text) {
  const rows = text.trim().split(/\r?\n/).map(r => r.trim()).filter(r => r.length > 0);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i].split(/,|\t/).map(c => c.trim());
    if (i === 0) {
      const head = cols.map(c => c.toLowerCase());
      if (head.includes('date') && (head.includes('count') || head.includes('footfall') || head.includes('value'))) continue;
    }
    const d = new Date(cols[0]);
    const v = parseFloat(cols[1]);
    if (!isNaN(d.getTime()) && !Number.isNaN(v)) out.push({ date: d.toISOString().slice(0, 10), count: v });
  }
  // sort
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

function csvFromArray(arr) {
  const lines = ['date,count'];
  for (const r of arr) lines.push(`${r.date},${r.count}`);
  return lines.join('\n');
}

function downloadCSV(filename, text) {
  const a = document.createElement('a');
  const blob = new Blob([text], { type: 'text/csv' });
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ------------------------------- MODELS --------------------------------- */
function linearRegressionFitArray(data) {
  const n = data.length;
  if (n === 0) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = data[i].count;
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { a: 0, b: data[0].count };
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  return { a, b };
}

function linearPredictFromFit(fit, startIndex, steps) {
  const preds = [];
  for (let k = 0; k < steps; k++) {
    const x = startIndex + k;
    const y = fit.a * x + fit.b;
    preds.push(Math.max(0, y));
  }
  return preds;
}

function movingAveragePredictArray(data, window, steps) {
  const arr = data.map(d => d.count).slice();
  const preds = [];
  for (let s = 0; s < steps; s++) {
    const start = Math.max(0, arr.length - window);
    const win = arr.slice(start);
    const avg = win.reduce((a, b) => a + b, 0) / win.length;
    preds.push(Math.max(0, avg));
    arr.push(avg);
  }
  return preds;
}

function expSmoothingPredictArray(data, alpha, steps) {
  if (data.length === 0) return [];
  let s = data[0].count;
  for (let i = 1; i < data.length; i++) s = alpha * data[i].count + (1 - alpha) * s;
  const preds = new Array(steps).fill(s);
  return preds;
}

/* ----------------------------- CHART HELPERS ----------------------------- */
// The HTML previously used Chart.js; this script expects Chart.js to be loaded
// by the HTML page (CDN link). It looks for a <canvas id="footfallChart">.
let __fp_chart = null;

function ensureChartHasContext() {
  const canvas = document.getElementById('footfallChart');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (__fp_chart) { __fp_chart.destroy(); __fp_chart = null; }
  __fp_chart = new Chart(ctx, {
    type: 'line',
    data: { datasets: [] },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { x: { type: 'time', time: { unit: 'day' } }, y: { beginAtZero: true } },
      plugins: { legend: { display: true } }
    }
  });
  return __fp_chart;
}

function plotObservedAndPred(dataset, predDates, predValues) {
  if (!__fp_chart) ensureChartHasContext();
  const obsData = dataset.map(d => ({ x: d.date, y: d.count }));
  const predData = predDates.map((d, i) => ({ x: d, y: predValues[i] }));
  __fp_chart.data.datasets = [
    { label: 'Observed footfall', data: obsData, tension: 0.25, borderWidth: 2, pointRadius: 2 },
  ];
  if (predData.length > 0) {
    __fp_chart.data.datasets.push({ label: 'Predicted', data: predData, borderDash: [6, 4], pointRadius: 3, borderWidth: 2 });
  }
  __fp_chart.update();
  // store predictions for export
  __fp_chart._predictions = predDates.map((d, i) => ({ date: d, count: predValues[i] }));
}

/* ------------------------------- UI BINDING ------------------------------- */
// This file assumes the HTML uses the same ids as in the prototype HTML.
// If you changed ids, update these selectors.

function initAppWithDataset(initialData) {
  // dataset array with {date:'YYYY-MM-DD', count:number}
  let dataset = initialData ? initialData.slice() : [];

  const fileInput = document.getElementById('fileInput');
  const sampleBtn = document.getElementById('sampleBtn');
  const clearBtn = document.getElementById('clearBtn');
  const trainBtn = document.getElementById('trainBtn');
  const exportBtn = document.getElementById('exportBtn');
  const dataTableBody = document.querySelector('#dataTable tbody');
  const lastRecordEl = document.getElementById('lastRecord');
  const avgRecordEl = document.getElementById('avgRecord');
  const predSummaryEl = document.getElementById('predSummary');
  const modelSelect = document.getElementById('modelSelect');
  const horizonInput = document.getElementById('horizon');
  const maWindowInput = document.getElementById('maWindow');

  function renderTable() {
    if (!dataTableBody) return;
    dataTableBody.innerHTML = '';
    for (const row of dataset) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td'); td1.textContent = row.date;
      const td2 = document.createElement('td'); td2.textContent = row.count;
      tr.appendChild(td1); tr.appendChild(td2); dataTableBody.appendChild(tr);
    }
  }

  function updateMetrics(preds) {
    if (!lastRecordEl) return;
    if (dataset.length === 0) { lastRecordEl.textContent = '—'; avgRecordEl.textContent = '—'; predSummaryEl.textContent = '—'; return; }
    lastRecordEl.textContent = `${dataset[dataset.length - 1].count} (on ${dataset[dataset.length - 1].date})`;
    const avg = dataset.reduce((a, b) => a + b.count, 0) / dataset.length;
    avgRecordEl.textContent = `${avg.toFixed(1)}`;
    if (preds && preds.length > 0) {
      const sum = preds.reduce((a, b) => a + b, 0);
      predSummaryEl.textContent = `Next ${preds.length} days — avg ${(sum / preds.length).toFixed(1)}`;
    } else predSummaryEl.textContent = '—';
  }

  function loadDatasetFromCSVText(text) {
    const arr = parseCSVText(text);
    if (arr.length === 0) alert('No valid rows found in CSV. Expecting date,count');
    dataset = arr; renderTable(); updateMetrics(); plotObservedAndPred(dataset, [], []);
  }

  if (fileInput) fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => loadDatasetFromCSVText(ev.target.result);
    reader.readAsText(f);
  });

  if (sampleBtn) sampleBtn.addEventListener('click', () => {
    dataset = SAMPLE_DATA.slice(); renderTable(); updateMetrics(); plotObservedAndPred(dataset, [], []);
  });

  if (clearBtn) clearBtn.addEventListener('click', () => { dataset = []; renderTable(); updateMetrics(); plotObservedAndPred(dataset, [], []); });

  if (trainBtn) trainBtn.addEventListener('click', () => {
    if (dataset.length < 3) { alert('Need at least 3 data points to train.'); return; }
    const horizon = parseInt(horizonInput.value || '14', 10);
    const model = modelSelect.value;
    let preds = [];
    if (model === 'linear') {
      const fit = linearRegressionFitArray(dataset);
      preds = linearPredictFromFit(fit, dataset.length, horizon);
    } else if (model === 'ma') {
      const w = Math.max(2, parseInt(maWindowInput.value || '7', 10));
      preds = movingAveragePredictArray(dataset, w, horizon);
    } else if (model === 'exp') {
      const alpha = 0.35;
      preds = expSmoothingPredictArray(dataset, alpha, horizon);
    }
    const lastDate = new Date(dataset[dataset.length - 1].date + 'T00:00:00');
    const predDates = [];
    for (let i = 1; i <= horizon; i++) {
      const d = new Date(lastDate); d.setDate(d.getDate() + i); predDates.push(d.toISOString().slice(0, 10));
    }
    plotObservedAndPred(dataset, predDates, preds);
    updateMetrics(preds);
  });

  if (exportBtn) exportBtn.addEventListener('click', () => {
    const combined = dataset.slice();
    const preds = (__fp_chart && __fp_chart._predictions) ? __fp_chart._predictions : [];
    for (const p of preds) combined.push({ date: p.date, count: Math.round(p.count) });
    if (combined.length === 0) { alert('No data to export'); return; }
    downloadCSV('footfall_export.csv', csvFromArray(combined));
  });

  // initial render if dataset provided
  renderTable(); updateMetrics(); ensureChartHasContext();
}

/* ----------------------------- AUTO-INIT -------------------------------- */
// Wait for DOM ready and Chart.js availability
(function autoInit() {
  function ready() {
    // init UI with sample data only if the expected elements exist
    if (document.getElementById('footfallChart')) {
      ensureChartHasContext();
      initAppWithDataset([]); // start empty; user can click "Load Sample Dataset"
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();

/* ----------------------------- EXPORTS (dev) ----------------------------- */
// Attach to window for console access
window.FP = {
  SAMPLE_DATA, generateSampleData, parseCSVText,
  linearRegressionFitArray, movingAveragePredictArray, expSmoothingPredictArray
};

/* ==========================================================================
  End of app.js
   - This script creates SAMPLE_DATA with 1000 records and wires UI elements.
   - To use: include it after Chart.js and after the HTML elements in your page.
   Example in HTML:
     <link rel="stylesheet" href="styles.css">
     <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
     <script src="app.js"></script>
=============================================================================*/

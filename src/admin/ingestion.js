/**
 * Data ingestion console.
 *
 * The pipeline, exposed as six explicit steps. Nothing here runs on its own -
 * particularly not the paid one. Before analysis can start, the console shows
 * the exact number of model calls the run would make, what today's budget has
 * left, and how many of those frames are already cached; the button only then
 * becomes meaningful.
 */

import { el, mount, on } from '../utils/dom.js';
import { renderAdminShell, activeRegionId } from './shell.js';
import { icon } from '../components/icons.js';
import { button, banner, spinner, sectionTitle, field, stat, emptyState } from '../components/ui.js';
import { formatNumber, formatDateTime } from '../utils/format.js';
import { startIngestionJob, startAnalysisJob, estimateAnalysis, cancelJob, generateExport } from '../services/api.js';
import { watchJobs } from '../services/db.js';
import { describeError } from '../services/errors.js';
import { toastSuccess, toastError } from '../services/toast.js';
import { appState } from '../app.js';
import { bboxAreaKm2 } from '@shared/geo.js';
import { MAX_IMPORT_AREA_KM2, MAX_AI_ANALYSES_PER_JOB, DEFAULT_REGION } from '@shared/config.js';
import { JobStatus } from '@shared/constants.js';

export async function render() {
  const content = await renderAdminShell({ nav: 'ingestion', title: 'Data ingestion' });
  if (!content) return {};

  const regionId = activeRegionId();
  const region = appState.bootstrap?.regions?.find((r) => r.id === regionId);

  const state = {
    bbox: region?.bbox || DEFAULT_REGION.bbox,
    regionId,
    regionName: region?.name || DEFAULT_REGION.name
  };

  const mapHost = el('div', {
    style: {
      height: '320px', borderRadius: 'var(--r-lg)', overflow: 'hidden',
      border: '1px solid var(--border)', position: 'relative'
    }
  });
  const bboxReadout = el('p.small.muted');
  const estimateSlot = el('div');
  const jobsSlot = el('div', {}, spinner());

  mount(content, el('div.stack-lg', {}, [
    el('section.stack-sm', {}, [
      sectionTitle('1 · Region'),
      el('p.small.muted', {}, 'Pan and zoom to the area you want, then use the current view as the region. Imports are capped at ' + MAX_IMPORT_AREA_KM2 + ' km² — a whole city at once is both slow and expensive.'),
      mapHost,
      el('div.row.row--wrap', { style: { gap: '8px' } }, [
        button('Use current map view', { variant: 'secondary', size: 'sm', icon: 'layers', onClick: useCurrentView }),
        button('Reset to pilot area', { variant: 'ghost', size: 'sm', onClick: resetToPilot })
      ]),
      el('div.row.row--wrap', { style: { gap: '10px' } }, [
        field('Region ID', el('input.input', {
          value: state.regionId, id: 'region-id',
          onInput: (e) => { state.regionId = e.target.value.trim().replace(/[^\w-]/g, '-'); }
        }), { id: 'region-id', hint: 'Re-importing the same ID updates in place.' }),
        field('Region name', el('input.input', {
          value: state.regionName, id: 'region-name',
          onInput: (e) => { state.regionName = e.target.value; }
        }), { id: 'region-name' })
      ]),
      bboxReadout
    ]),

    el('section.stack-sm', {}, [
      sectionTitle('2 · Import the pedestrian network'),
      el('p.small.muted', {}, 'Downloads footways, pavements, crossings, steps and walkable streets from OpenStreetMap via Overpass, splits them into segments at junctions, and computes a first assessment from the OSM tags alone. Most segments will come out grey: OSM rarely carries kerb and surface tags for a whole city, and that is the honest starting point.'),
      button('Import OSM network', {
        variant: 'primary', icon: 'download',
        onClick: () => startJob('import_osm', { bbox: state.bbox, regionName: state.regionName })
      })
    ]),

    el('section.stack-sm', {}, [
      sectionTitle('3 · Discover street-level imagery'),
      el('p.small.muted', {}, 'Finds which Mapillary frames exist over the region and picks at most three genuinely informative ones per segment — recent, close, well-angled and spatially spread. Discovery is free; it stops before anything is analysed.'),
      button('Discover Mapillary imagery', {
        variant: 'secondary', icon: 'camera',
        onClick: () => startJob('discover_mapillary', { bbox: state.bbox })
      })
    ]),

    el('section.stack-sm', {}, [
      sectionTitle('4 · Analyse imagery with AI'),
      el('p.small.muted', {}, 'The only step that spends money. Check the estimate before starting.'),
      el('div.row', { style: { gap: '8px' } }, [
        button('Estimate cost', { variant: 'secondary', size: 'sm', icon: 'chart', onClick: loadEstimate })
      ]),
      estimateSlot
    ]),

    el('section.stack-sm', {}, [
      sectionTitle('5 · Recalculate and publish'),
      el('p.small.muted', {}, 'Recalculation re-runs the deterministic assessment over stored evidence and re-ranks municipal priorities. Rebuilding the graph and publishing the bundle is what makes the results visible in the public app.'),
      el('div.row.row--wrap', { style: { gap: '8px' } }, [
        button('Recalculate assessments', { variant: 'secondary', size: 'sm', icon: 'refresh', onClick: () => startJob('recalculate') }),
        button('Rebuild routing graph', { variant: 'secondary', size: 'sm', icon: 'route', onClick: () => startJob('rebuild_graph') }),
        button('Publish map bundle', { variant: 'primary', size: 'sm', icon: 'layers', onClick: () => startJob('publish_bundle') })
      ])
    ]),

    el('section.stack-sm', {}, [
      sectionTitle('6 · Exports'),
      el('div.row.row--wrap', { style: { gap: '8px' } }, [
        exportButton('segments', 'Segments GeoJSON'),
        exportButton('issues', 'Priority issues CSV'),
        exportButton('reports', 'Reports CSV'),
        exportButton('coverage', 'Coverage CSV')
      ])
    ]),

    el('section.stack-sm', {}, [
      sectionTitle('Recent jobs'),
      jobsSlot
    ])
  ]));

  updateBboxReadout();

  // --- map -----------------------------------------------------------------
  let map = null;
  let mapModule = null;
  try {
    mapModule = await import('../maps/map.js');
    map = await mapModule.createMap(mapHost, { controls: true, maxBounds: null });
    await mapModule.whenReady(map);
    mapModule.fitToBbox(map, state.bbox, 30);
    drawBbox();
    map.on('moveend', drawBbox);
  } catch {
    mount(mapHost, emptyState('Map preview unavailable.'));
  }

  function drawBbox() {
    if (!map) return;
    const data = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [state.bbox[0], state.bbox[1]], [state.bbox[2], state.bbox[1]],
          [state.bbox[2], state.bbox[3]], [state.bbox[0], state.bbox[3]],
          [state.bbox[0], state.bbox[1]]
        ]]
      },
      properties: {}
    };
    if (map.getSource('region-bbox')) {
      map.getSource('region-bbox').setData(data);
      return;
    }
    map.addSource('region-bbox', { type: 'geojson', data });
    map.addLayer({
      id: 'region-bbox-fill', type: 'fill', source: 'region-bbox',
      paint: { 'fill-color': '#176B87', 'fill-opacity': 0.1 }
    });
    map.addLayer({
      id: 'region-bbox-line', type: 'line', source: 'region-bbox',
      paint: { 'line-color': '#176B87', 'line-width': 2, 'line-dasharray': [2, 1.5] }
    });
  }

  function useCurrentView() {
    if (!map) return;
    const bounds = map.getBounds();
    state.bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    drawBbox();
    updateBboxReadout();
  }

  function resetToPilot() {
    state.bbox = DEFAULT_REGION.bbox;
    if (map) mapModule.fitToBbox(map, state.bbox, 30);
    drawBbox();
    updateBboxReadout();
  }

  function updateBboxReadout() {
    const area = bboxAreaKm2(state.bbox);
    const tooBig = area > MAX_IMPORT_AREA_KM2;
    bboxReadout.textContent =
      `${state.bbox.map((n) => n.toFixed(4)).join(', ')} — ${area.toFixed(2)} km²` +
      (tooBig ? ` (above the ${MAX_IMPORT_AREA_KM2} km² limit)` : '');
    bboxReadout.style.color = tooBig ? 'var(--inaccessible-ink)' : 'var(--muted)';
  }

  // --- jobs ----------------------------------------------------------------
  async function startJob(type, extra = {}) {
    try {
      const result = await startIngestionJob({
        type, regionId: state.regionId, ...extra
      });
      toastSuccess(`Job queued (${type.replace(/_/g, ' ')}). Progress appears below.`);
      return result;
    } catch (error) {
      toastError(describeError(error));
      return null;
    }
  }

  async function loadEstimate() {
    mount(estimateSlot, spinner());
    try {
      const estimate = await estimateAnalysis(state.regionId);
      mount(estimateSlot, renderEstimate(estimate));
    } catch (error) {
      mount(estimateSlot, banner(describeError(error), { tone: 'danger' }));
    }
  }

  function renderEstimate(estimate) {
    const willAnalyse = estimate.willAnalyse ?? 0;
    return el('div.cost-panel.stack-sm', {}, [
      el('div.row.row--between', {}, [
        el('div', {}, [
          el('div.cost-panel__figure', {}, formatNumber(willAnalyse)),
          el('div.small', {}, 'model calls this run would make')
        ]),
        icon('warning', 22)
      ]),
      el('div.metric-grid', {}, [
        stat(formatNumber(estimate.segments), 'Segments with pending frames'),
        stat(formatNumber(estimate.frames), 'Frames not yet analysed'),
        stat(formatNumber(estimate.dailyBudget?.remaining ?? 0), 'Daily budget remaining'),
        stat(formatNumber(estimate.perJobLimit ?? MAX_AI_ANALYSES_PER_JOB), 'Per-job cap')
      ]),
      el('p.xs', {}, 'Frames already analysed by this model and analysis version are served from cache and cost nothing.'),
      willAnalyse > 0
        ? button(`Start analysis (${willAnalyse} calls)`, {
          variant: 'primary', icon: 'play',
          onClick: async () => {
            try {
              await startAnalysisJob({ regionId: state.regionId, limit: willAnalyse });
              toastSuccess('Analysis job queued.');
              loadEstimate();
            } catch (error) {
              toastError(describeError(error));
            }
          }
        })
        : banner('Nothing to analyse: every selected frame already has a current observation, or the daily budget is spent.', { tone: 'info' })
    ]);
  }

  function exportButton(kind, label) {
    return button(label, {
      variant: 'ghost', size: 'sm', icon: 'download',
      onClick: async () => {
        try {
          const result = await generateExport({ kind, regionId: state.regionId });
          window.open(result.url, '_blank', 'noopener');
          toastSuccess(`${formatNumber(result.rows)} rows exported.`);
        } catch (error) {
          toastError(describeError(error));
        }
      }
    });
  }

  // --- live job list -------------------------------------------------------
  const unsubscribers = [];
  for (const kind of ['ingestion', 'analysis']) {
    const unsubscribe = await watchJobs({
      kind, regionId: state.regionId,
      onChange: (jobs) => renderJobs(kind, jobs)
    });
    unsubscribers.push(unsubscribe);
  }

  const jobsByKind = { ingestion: [], analysis: [] };
  function renderJobs(kind, jobs) {
    jobsByKind[kind] = jobs;
    const all = [...jobsByKind.ingestion, ...jobsByKind.analysis]
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .slice(0, 10);

    if (!all.length) { mount(jobsSlot, emptyState('No jobs have been run for this region yet.')); return; }
    mount(jobsSlot, el('div.stack-sm', {}, all.map(jobCard)));
  }

  function jobCard(job) {
    const total = job.total || 0;
    const processed = job.processed || 0;
    const percent = total > 0 ? Math.min(100, (processed / total) * 100)
      : (job.status === JobStatus.COMPLETED ? 100 : 8);
    const barClass = job.status === JobStatus.FAILED ? 'job-card__bar--failed'
      : job.status === JobStatus.COMPLETED ? 'job-card__bar--completed' : '';

    return el('div.job-card', {}, [
      el('div.row.row--between', {}, [
        el('div', {}, [
          el('div.strong.small', {}, (job.type || job.kind).replace(/_/g, ' ')),
          el('div.xs.muted', {}, formatDateTime(job.createdAt))
        ]),
        el('span.pill.pill--neutral', {}, job.status)
      ]),
      job.message ? el('p.xs.muted', { style: { marginTop: '6px' } }, job.message) : null,
      el('div.job-card__progress', {}, el(`div.job-card__bar.${barClass}`, { style: { width: `${percent}%` } })),
      el('div.row.row--between', { style: { marginTop: '6px' } }, [
        el('span.xs.muted', {}, total ? `${formatNumber(processed)} / ${formatNumber(total)}` : ''),
        job.errorCount ? el('span.xs', { style: { color: 'var(--inaccessible-ink)' } }, `${job.errorCount} error(s)`) : null
      ]),
      job.result ? el('details', {}, [
        el('summary.xs.muted', { style: { cursor: 'pointer' } }, 'Result'),
        el('pre.xs', {
          style: { overflowX: 'auto', background: 'var(--surface-sunk)', padding: '8px', borderRadius: '8px' }
        }, JSON.stringify(job.result, null, 2))
      ]) : null,
      [JobStatus.QUEUED, JobStatus.RUNNING].includes(job.status)
        ? button('Cancel', {
          variant: 'ghost', size: 'sm',
          onClick: async () => {
            try {
              await cancelJob({ jobId: job.id, kind: job.kind });
              toastSuccess('Job cancelled.');
            } catch (error) { toastError(describeError(error)); }
          }
        })
        : null
    ]);
  }

  return {
    destroy() {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
      if (map) map.remove();
    }
  };
}

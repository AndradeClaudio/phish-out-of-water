const POLL_INTERVAL_MS = 1000;
const DEMO_SCAM_LINK = 'https://andradeclaudio.github.io/phish-out-of-water-demo/';

const VERDICT_LABELS = {
  dangerous: 'Scam detected',
  suspicious: 'Suspicious',
  'no-threats-found': 'No threats found',
  inconclusive: 'Could not check',
};

const STATUS_TITLES = {
  detonating: 'Opening the link in a disposable sandbox…',
  analyzing: 'Sandbox destroyed. Analysing what we saw…',
  concluded: 'Inspection complete',
  failed: 'The inspection could not be completed',
};

const elements = Object.fromEntries(
  [
    'inspect-form', 'link-input', 'inspect-button', 'form-error', 'inspection', 'status-dot', 'status-title',
    'inspected-link', 'timeline', 'result', 'verdict-banner', 'verdict-label', 'report-headline', 'report-explanation',
    'report-advice', 'signals', 'signals-title', 'downloads-block', 'downloads', 'navigation-path',
    'screenshot-figure', 'screenshot', 'screenshot-caption', 'check-another', 'try-demo',
  ].map((id) => [id, document.getElementById(id)]),
);

let pollTimer = null;

elements['inspect-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  await startInspection(elements['link-input'].value);
});

elements['try-demo'].addEventListener('click', async () => {
  elements['link-input'].value = DEMO_SCAM_LINK;
  await startInspection(DEMO_SCAM_LINK);
});

elements['check-another'].addEventListener('click', () => {
  elements.inspection.hidden = true;
  elements['link-input'].value = '';
  elements['link-input'].focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function startInspection(link) {
  clearTimeout(pollTimer);
  showFormError(null);
  setSubmitting(true);
  try {
    const response = await fetch('/api/inspections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link }),
    });
    const body = await response.json();
    if (!response.ok) {
      showFormError(body.error ?? 'Could not start the inspection.');
      return;
    }
    resetInspectionPanel();
    await followInspection(body.id);
  } catch {
    showFormError('Could not reach the server. Check your connection and try again.');
  } finally {
    setSubmitting(false);
  }
}

async function followInspection(id) {
  const response = await fetch(`/api/inspections/${id}`);
  if (!response.ok) {
    showFormError('The inspection was lost. Please try again.');
    return;
  }
  const inspection = await response.json();
  renderProgress(inspection);
  if (inspection.status === 'concluded') {
    renderResult(inspection);
    return;
  }
  if (inspection.status !== 'failed') {
    pollTimer = setTimeout(() => followInspection(id), POLL_INTERVAL_MS);
  }
}

function resetInspectionPanel() {
  elements.inspection.hidden = false;
  elements.result.hidden = true;
  elements.timeline.replaceChildren();
  elements['status-dot'].closest('.panel').classList.remove('finished');
  elements.inspection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderProgress(inspection) {
  elements['inspected-link'].textContent = inspection.link;
  elements['status-title'].textContent = STATUS_TITLES[inspection.status];
  elements['status-dot'].className = `status-dot ${inspection.status === 'concluded' ? 'done' : inspection.status === 'failed' ? 'failed' : ''}`;
  const isFinished = inspection.status === 'concluded' || inspection.status === 'failed';
  elements['status-dot'].closest('.panel').classList.toggle('finished', isFinished);

  const alreadyShown = elements.timeline.children.length;
  inspection.timeline.slice(alreadyShown).forEach((entry) => {
    const item = document.createElement('li');
    if (/download|destroyed/i.test(entry.message)) {
      item.classList.add('containment');
    }
    const time = document.createElement('time');
    time.textContent = new Date(entry.at).toLocaleTimeString();
    item.append(time, entry.message);
    elements.timeline.append(item);
  });
}

function renderResult(inspection) {
  const { conclusion, evidence } = inspection;
  elements.result.hidden = false;
  elements['verdict-banner'].className = `verdict-banner verdict-${conclusion.verdict}`;
  elements['verdict-label'].textContent = VERDICT_LABELS[conclusion.verdict];
  elements['report-headline'].textContent = conclusion.report.headline;
  elements['report-explanation'].textContent = conclusion.report.explanation;

  fillList(elements['report-advice'], conclusion.report.advice, (tip) => tip);

  elements['signals-title'].hidden = conclusion.signals.length === 0;
  fillList(elements.signals, conclusion.signals, (signal) => {
    const badge = document.createElement('span');
    badge.className = `severity severity-${signal.severity}`;
    badge.textContent = signal.severity;
    return [badge, signal.explanation];
  });

  elements['downloads-block'].hidden = evidence.blockedDownloads.length === 0;
  fillList(elements.downloads, evidence.blockedDownloads, (download) => {
    const fingerprint = document.createElement('span');
    fingerprint.className = 'mono';
    fingerprint.textContent = download.sha256 ? `sha256 ${download.sha256.slice(0, 24)}…` : 'not fingerprinted';
    return [`${download.fileName}: caught and destroyed with the sandbox`, fingerprint];
  });

  fillList(elements['navigation-path'], evidence.navigationPath, (address) => address);

  const [screenshot] = evidence.screenshots;
  elements['screenshot-figure'].hidden = screenshot === undefined;
  if (screenshot !== undefined) {
    elements.screenshot.src = screenshot.url;
    elements['screenshot-caption'].textContent = conclusion.pageDescription || screenshot.caption;
  }
  elements.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fillList(list, items, toContent) {
  list.replaceChildren(
    ...items.map((item) => {
      const entry = document.createElement('li');
      const content = toContent(item);
      entry.append(...(Array.isArray(content) ? content : [content]));
      return entry;
    }),
  );
}

function setSubmitting(isSubmitting) {
  elements['inspect-button'].disabled = isSubmitting;
  elements['try-demo'].disabled = isSubmitting;
  elements['inspect-button'].querySelector('.button-label').textContent = isSubmitting ? 'Opening…' : 'Open it safely';
}

function showFormError(message) {
  elements['form-error'].hidden = message === null;
  elements['form-error'].textContent = message ?? '';
}

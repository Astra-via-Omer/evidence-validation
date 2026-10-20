const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const icons = {
  evidence: '<path d="M7 3h7l4 4v14H7zM14 3v5h5M10 12h5M10 16h5"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  event: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 11h16M8 15h3"/>',
  note: '<path d="M4 4h16v12l-5 5H4zM15 21v-5h5M8 9h8M8 13h4"/>',
};
const icon = kind => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${icons[kind] || icons.note}</svg>`;
const blank = () => ({ title: 'Untitled investigation', reference: '', summary: '', nodes: [], links: [], meeting: { title: '', date: '', participants: '', objective: '', agenda: '', notes: '', questions: [] } });

export function createCaseWorkspace({ api, modal, notice, onTask, onReview, onAssist, onNewTask, onNavigate }) {
  let account, jobs = [], records = [], current = null, draft = blank(), dirty = false, loaded = false, loadError = '', total = 0;
  let mode = 'investigation', selected = null, filter = 'all', search = '', zoom = .8, library = true, bundle = null, bundleError = '', epoch = 0, saving = false, dragMoved = false;
  const jobFor = node => jobs.find(job => job.id === node?.jobId);
  const changed = () => { dirty = true; const badge = document.querySelector('#case-save-state'); if (badge) badge.textContent = 'Unsaved changes'; };
  const selectedNode = () => draft.nodes.find(node => node.id === selected);
  const evidence = () => draft.nodes.filter(node => node.kind === 'evidence');
  const button = (action, label, cls = '') => `<button class="btn ${cls}" data-cw-action="${action}" type="button">${label}</button>`;
  const status = () => dirty ? 'Unsaved changes' : current ? 'All changes saved' : 'New case · not saved';

  function clear() { epoch++; account = null; jobs = []; records = []; current = null; draft = blank(); loaded = false; loadError = ''; dirty = false; selected = null; bundle = null; bundleError = ''; saving = false; }
  async function load(user, items, force = false) {
    if (account && account !== user.id) clear();
    account = user.id; jobs = items;
    if (loaded && !force) return;
    const token = ++epoch;
    try {
      const result = await api('/api/cases');
      if (token !== epoch || account !== user.id) return;
      records = result.items; total = result.totalItems; loaded = true; loadError = '';
      if (!current && !dirty && records.length) { current = records[0]; draft = structuredClone(current.document); }
    } catch (error) { if (token === epoch && account === user.id) loadError = error.message; }
  }
  function repaint() {
    const root = document.querySelector('.case-workspace'); if (!root || !account) return;
    const viewport = root.querySelector('.case-board-viewport');
    const scroll = viewport ? [viewport.scrollLeft, viewport.scrollTop] : null;
    root.outerHTML = markup(mode); mount(mode);
    const next = document.querySelector('.case-board-viewport'); if (next && scroll) { next.scrollLeft = scroll[0]; next.scrollTop = scroll[1]; }
  }
  function toolbar() {
    return `<div class="case-toolbar"><label class="case-switch"><span>CASE FILE</span><select id="case-select" aria-label="Select case file"><option value="" ${!current ? 'selected' : ''}>New unsaved case</option>${records.map(record => `<option value="${esc(record.id)}" ${current?.id === record.id ? 'selected' : ''}>${esc(record.document.title)}</option>`).join('')}</select></label><span class="case-save-state" id="case-save-state" role="status">${status()}</span><div class="case-toolbar-actions">${button('new-case', '+ New case')}${button('save', saving ? 'Saving…' : 'Save case', 'primary')}</div></div>${loadError ? `<div class="banner">Case storage is unavailable: ${esc(loadError)}. Changes remain in this tab until saved. ${button('retry', 'Retry connection')}</div>` : ''}${total > records.length ? `<p class="workflow-note">Showing the ${records.length} most recently updated cases of ${total}.</p>` : ''}`;
  }
  function markup(page = 'investigation') {
    mode = page;
    return `<section class="case-workspace" aria-label="${page === 'legal' ? 'Lawyer meeting preparation' : 'Police investigation workspace'}">${toolbar()}<div class="case-heading"><div><div class="eyebrow">${page === 'legal' ? 'Counsel / Meeting preparation' : 'Police / Investigation room'}</div><h1>${esc(draft.title)}</h1><p>${esc(draft.reference || 'Private case file')} <span class="case-heading-divider">/</span> ${evidence().length} evidence items <span class="case-heading-divider">/</span> ${draft.links.length} connections</p></div>${button('edit-case', 'Edit case details')}</div><div class="case-view-tabs" role="group" aria-label="Case views"><button class="${page === 'investigation' ? 'active' : ''}" data-cw-action="investigation">${icon('note')}Investigation board</button><button class="${page === 'legal' ? 'active' : ''}" data-cw-action="legal">${icon('evidence')}Lawyer meeting prep</button><span class="private-label">● PRIVATE CASE</span></div>${page === 'legal' ? legalMarkup() : investigationMarkup()}</section>`;
  }
  function investigationMarkup() {
    const kinds = [['all', 'All cards'], ['evidence', 'Evidence'], ['person', 'People'], ['event', 'Events'], ['note', 'Notes']];
    return `<div class="case-board-layout"><section class="case-board-panel" aria-label="Investigation board"><div class="board-tools"><div class="board-filters" role="group" aria-label="Filter board cards">${kinds.map(([kind, label]) => `<button data-cw-filter="${kind}" aria-pressed="${filter === kind}">${label}</button>`).join('')}</div><div class="board-actions">${button('add-card', '+ Add card')}${button('add-link', 'Connect cards')}${button('library', '+ Evidence')}</div></div><div class="case-board-viewport" tabindex="0" aria-label="Scrollable case board"><div class="case-board-sizer"><div class="case-canvas"><svg class="case-edges" viewBox="0 0 1500 1080" aria-label="Connections between case cards">${draft.links.map(link => {
      const from = draft.nodes.find(n => n.id === link.from), to = draft.nodes.find(n => n.id === link.to);
      if (!from || !to) return '';
      const x = from.x + 110, y = from.y + 72, x2 = to.x + 110, y2 = to.y + 72;
      return `<g class="case-edge ${link.relationship}" data-edge-from="${esc(from.id)}" data-edge-to="${esc(to.id)}"><line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}"/><text x="${(x + x2) / 2}" y="${(y + y2) / 2 - 9}" text-anchor="middle">${esc(link.label || link.relationship)}</text></g>`;
    }).join('')}</svg><div class="board-case-label"><span>CASE BOARD</span><strong>${esc(draft.reference || 'INVESTIGATION')}</strong><small>Connections are working assessments.</small></div>${draft.nodes.length ? draft.nodes.map(node => {
      const job = jobFor(node), isEvidence = node.kind === 'evidence';
      return `<button class="case-node ${node.kind} ${selected === node.id ? 'selected' : ''}" data-cw-node="${esc(node.id)}" aria-pressed="${selected === node.id}" aria-label="${esc(node.kind + ': ' + node.title)}"><span class="node-pin"></span><span class="node-kind">${icon(node.kind)}${isEvidence ? 'EVIDENCE' : esc(node.kind.toUpperCase())}<span>${isEvidence ? String(evidence().indexOf(node) + 1).padStart(2, '0') : ''}</span></span><strong>${esc(node.title)}</strong><span class="node-excerpt">${esc(isEvidence ? job?.quote || 'Source not currently accessible' : node.body || 'Select to add context')}</span><span class="node-footer">${isEvidence ? `<span class="relation-dot ${esc(job?.relationship)}"></span>${esc(job?.relationship || 'unavailable')}<span>↗ Review</span>` : 'Investigator note · unverified'}</span></button>`;
    }).join('') : `<div class="board-empty">${icon('note')}<h2>Every investigation starts with a connection.</h2><p>Pin an evidence item from your library, then add people, events and questions around it.</p>${button('library', 'Open evidence library', 'primary')}${button('add-card', 'Add your first card')}</div>`}</div></div></div><div class="board-footer"><div class="board-legend"><span><i class="supports"></i>Supports</span><span><i class="challenges"></i>Challenges</span><span><i class="context"></i>Context</span><span><i class="question"></i>Open question</span></div><div class="board-zoom">${button('zoom-out', '−')}<span>${Math.round(zoom * 100)}%</span>${button('zoom-in', '+')}</div></div><p class="board-hint">Drag cards to arrange. Select a card and use arrow keys to move it; hold Shift for larger steps.</p></section><aside class="case-inspector" aria-label="Evidence and card details">${inspectorMarkup()}</aside></div>`;
  }
  function inspectorMarkup() {
    const node = selectedNode(), job = jobFor(node);
    if (!library && node) return `<div class="inspector-head"><div><div class="eyebrow">${esc(node.kind)} / Detail</div><h2>${esc(node.title)}</h2></div><button class="textbtn" data-cw-action="library">Library ↗</button></div><div class="inspector-body">${node.kind === 'evidence' ? `<span class="tag ${job?.relationship === 'supports' ? 'mint' : 'neutral'}">${esc(job?.relationship || 'Unavailable')}</span><h3>Claim under review</h3><p>${esc(job?.claim || 'This source is not currently accessible to your account.')}</p><h3>Source quotation</h3><blockquote>${esc(job?.quote || 'Unavailable')}</blockquote><p class="source-location">${esc(job?.location)}</p>${safeSource(job?.sourceUrl)}<div class="inspector-buttons">${job ? button('open-task', 'Open evidence review', 'primary') + button('assist', 'Ask AI for review assistance') : ''}${job?.status === 'open' && job.owner !== account ? button('review', 'Submit independent review') : ''}${button('refresh-reviews', 'Refresh accessible reviews')}</div><h3>Independent reviews</h3><div aria-live="polite">${bundleError ? `<p class="formerror">${esc(bundleError)}</p>` : bundle ? bundle.payload.reviews.length ? bundle.payload.reviews.map(review => `<article class="case-review"><span class="tag neutral">${esc(review.verdict)}</span><p>${esc(review.reasoning)}</p><blockquote>${esc(review.quote)}</blockquote><small>${esc(review.location)}</small></article>`).join('') : '<p>No reviews accessible to this account yet.</p>' : '<p>Loading accessible reviews…</p>'}</div>${bundle ? `<p class="workflow-note">${bundle.payload.coverage.includedReviews} of ${bundle.payload.coverage.accessibleReviews} accessible reviews included. ${bundle.payload.coverage.completeForThisAccount ? '' : 'Review coverage is incomplete.'} Reviews follow the existing blind-review permissions.</p>` : ''}` : `<p class="annotation-label">Investigator annotation · unverified</p><p class="preserve-lines">${esc(node.body || 'No context added yet.')}</p>${button('edit-card', 'Edit card')}`}<div class="node-connections"><h3>Connections</h3>${draft.links.filter(link => link.from === node.id || link.to === node.id).map(link => `<div class="connection-row"><p><span class="tag neutral">${esc(link.relationship)}</span><br>${esc(draft.nodes.find(n => n.id === (link.from === node.id ? link.to : link.from))?.title)}${link.label ? `<small>${esc(link.label)}</small>` : ''}</p><button class="textbtn" data-cw-unlink="${esc(link.id)}" aria-label="Remove connection ${esc(link.label || link.relationship)}">×</button></div>`).join('') || '<p>No connections yet.</p>'}${button('add-link', 'Connect this card')}</div><button class="textbtn danger-text" data-cw-action="remove-card">Remove from case</button></div>`;
    return `<div class="inspector-head"><div><div class="eyebrow">Source material</div><h2>Evidence library <span>${jobs.length}</span></h2></div></div><div class="inspector-body"><label class="board-search-label"><span>Find an evidence item</span><input type="search" id="case-library-search" placeholder="Search claims or sources…" value="${esc(search)}"></label><div id="case-library-results">${libraryResults()}</div><div class="inspector-new-task">${button('new-task', '+ Create evidence review task')}<p>Pin existing review tasks here. Original evidence and independent reviews remain connected.</p></div></div>`;
  }
  function libraryResults() {
    const items = jobs.filter(job => `${job.title} ${job.claim} ${job.location}`.toLowerCase().includes(search.toLowerCase()));
    return items.length ? items.map(job => `<article class="library-evidence"><div><span class="tag ${job.relationship === 'supports' ? 'mint' : 'neutral'}">${esc(job.relationship)}</span><small>${esc(job.visibility)} · ${esc(job.status)}</small></div><h3>${esc(job.title)}</h3><p>${esc(job.location)}</p><button class="textbtn" data-cw-pin="${esc(job.id)}">${evidence().some(n => n.jobId === job.id) ? '↗ View on board' : '+ Pin to case'}</button></article>`).join('') : `<p class="empty">${search ? 'No evidence matches this search.' : 'No accessible evidence tasks yet. Create a review task to add your first source.'}</p>`;
  }
  function safeSource(url) {
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) return ''; return `<a class="source-link" href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">${esc(parsed.hostname)} ↗</a>`; } catch { return ''; }
  }
  function field(name, label, textarea = false, limit = 3000) {
    return `<div class="meeting-field"><label for="meeting-${name}">${label}</label>${textarea ? `<textarea id="meeting-${name}" data-meeting-field="${name}" maxlength="${limit}">${esc(draft.meeting[name])}</textarea>` : `<input id="meeting-${name}" data-meeting-field="${name}" ${name === 'date' ? 'type="datetime-local"' : ''} maxlength="${limit}" value="${esc(draft.meeting[name])}">`}</div>`;
  }
  function legalMarkup() {
    const questions = draft.meeting.questions;
    return `<div class="meeting-layout"><div><section class="panel meeting-panel"><div class="panelhead"><h2>Prepare the conversation.</h2><span class="tag mint">CASE-LINKED</span></div><div class="panelbody"><p>Bring the evidence, unresolved questions and next decisions into one meeting.</p><div class="meeting-fields">${field('title', 'Meeting title', false, 180)}${field('date', 'Date & time · your local time', false, 40)}${field('participants', 'Participants', false, 1000)}${field('objective', 'Meeting objective', true)}${field('agenda', 'Agenda · one item per line', true, 5000)}</div></div></section><section class="panel meeting-panel"><div class="panelhead"><h2>Questions to resolve</h2><span class="tag neutral">${questions.filter(q => q.done).length} / ${questions.length}</span></div><div class="panelbody"><div class="meeting-questions">${questions.map(q => `<div class="meeting-question"><label class="check"><input type="checkbox" data-cw-question="${esc(q.id)}" ${q.done ? 'checked' : ''}><span class="${q.done ? 'completed' : ''}">${esc(q.text)}</span></label><button class="textbtn" data-cw-remove-question="${esc(q.id)}" aria-label="Remove question ${esc(q.text)}">×</button></div>`).join('') || '<p>No questions added yet. Record what counsel should help resolve.</p>'}</div><form id="case-question-form"><label>Add a question<input name="question" required maxlength="1000" placeholder="What evidence is still needed?"></label><button class="btn" type="submit">+ Add question</button></form></div></section><section class="panel meeting-panel"><div class="panelhead"><h2>Meeting notes & next actions</h2></div><div class="panelbody">${field('notes', 'Decisions, owners and follow-up actions', true, 10000)}<p class="workflow-note">Private working notes. Saving or exporting a case does not publish it to IPFS.</p></div></section></div><aside class="meeting-exhibits"><section class="panel"><div class="panelhead"><h2>Evidence for the meeting</h2><span class="tag neutral">${evidence().length} EXHIBITS</span></div><div class="panelbody">${evidence().map((node, i) => `<article class="meeting-exhibit"><span class="exhibit-number">EXHIBIT ${String(i + 1).padStart(2, '0')}</span><h3>${esc(node.title)}</h3><p>${esc(jobFor(node)?.location || 'Source currently unavailable')}</p>${jobFor(node) ? `<button class="textbtn" data-cw-task="${esc(node.jobId)}">Review evidence ↗</button>` : ''}</article>`).join('') || '<p>Pin evidence on the investigation board to include it here.</p>'}${button('investigation', 'Open investigation board')}</div></section><section class="panel meeting-export"><div class="panelbody"><div class="eyebrow">Ready for the room</div><h2>One case. A clear brief.</h2><p>Export the agenda, questions, source quotations, connections and working notes as a private text brief.</p>${button('export-brief', '↓ Export meeting brief', 'primary')}<p class="workflow-note">Investigative notes and proposed connections remain labeled as unverified assessments.</p></div></section></aside></div>`;
  }
  function caseDialog(isNew = false) {
    modal(`<div class="eyebrow">Private investigation</div><h2>${isNew ? 'Open a new case.' : 'Case details.'}</h2><form id="case-details-form"><label>Case title<input name="title" minlength="3" maxlength="180" required value="${isNew ? '' : esc(draft.title)}" placeholder="Name this investigation"></label><label>Case reference<input name="reference" maxlength="100" value="${isNew ? '' : esc(draft.reference)}" placeholder="Optional case number"></label><label>Investigation scope<textarea name="summary" maxlength="3000">${isNew ? '' : esc(draft.summary)}</textarea></label><div class="formerror" role="alert"></div><button type="submit" class="btn primary">${isNew ? 'Create private case' : 'Update details'}</button></form>`);
    document.querySelector('#case-details-form').onsubmit = event => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
      if (isNew) { draft = blank(); current = null; selected = null; library = true; bundle = null; }
      Object.assign(draft, values); changed(); document.querySelector('#modal').close(); repaint();
    };
  }
  function cardDialog(node = null) {
    if (!node && draft.nodes.length >= 80) return notice('The pilot supports up to 80 cards per case.');
    modal(`<div class="eyebrow">Investigator annotation</div><h2>${node ? 'Edit this card.' : 'Add a thread to the board.'}</h2><form id="case-card-form"><label>Card type<select name="kind">${['person', 'event', 'note'].map(kind => `<option value="${kind}" ${node?.kind === kind ? 'selected' : ''}>${kind === 'person' ? 'Person / organization' : kind === 'event' ? 'Event / timeline' : 'Note / hypothesis'}</option>`).join('')}</select></label><label>Title<input name="title" maxlength="180" required value="${esc(node?.title)}"></label><label>Context, timing or open questions<textarea name="body" maxlength="3000">${esc(node?.body)}</textarea></label><p>Working annotations do not count as independent evidence.</p><button class="btn primary" type="submit">${node ? 'Update card' : 'Add to board'}</button></form>`);
    document.querySelector('#case-card-form').onsubmit = event => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
      if (node) Object.assign(node, values); else { const item = { id: crypto.randomUUID(), ...values, ...nextPosition() }; draft.nodes.push(item); selected = item.id; }
      library = false; changed(); document.querySelector('#modal').close(); repaint();
    };
  }
  const nextPosition = () => ({ x: 90 + (draft.nodes.length % 4) * 300, y: 130 + Math.floor((draft.nodes.length % 16) / 4) * 220 });
  function linkDialog() {
    if (draft.nodes.length < 2) return notice('Add at least two cards before connecting them.');
    if (draft.links.length >= 160) return notice('The pilot supports up to 160 connections per case.');
    const options = id => draft.nodes.map(node => `<option value="${esc(node.id)}" ${node.id === id ? 'selected' : ''}>${esc(node.title)}</option>`).join('');
    modal(`<div class="eyebrow">Map the relationship</div><h2>Connect two cards.</h2><form id="case-link-form"><label>From<select name="from">${options(selected || draft.nodes[0].id)}</select></label><label>To<select name="to">${options(draft.nodes.find(n => n.id !== selected)?.id || draft.nodes[1].id)}</select></label><label>Working relationship<select name="relationship"><option value="context">Context</option><option value="supports">Supports</option><option value="challenges">Challenges</option><option value="question">Open question</option></select></label><label>Connection note<input name="label" maxlength="180" placeholder="What links these cards?"></label><p>This is your working assessment. It does not alter independent review verdicts.</p><div class="formerror" role="alert"></div><button class="btn primary" type="submit">Add connection</button></form>`);
    document.querySelector('#case-link-form').onsubmit = event => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.target));
      if (values.from === values.to) { event.target.querySelector('.formerror').textContent = 'Select two different cards.'; return; }
      draft.links.push({ id: crypto.randomUUID(), ...values }); changed(); document.querySelector('#modal').close(); repaint();
    };
  }
  async function save() {
    if (saving) return;
    const owner = account, token = epoch, snapshot = JSON.stringify(draft), recordId = current?.id;
    saving = true; repaint();
    try {
      const record = await api(recordId ? '/api/cases/' + encodeURIComponent(recordId) : '/api/cases', { method: recordId ? 'PUT' : 'POST', body: JSON.stringify({ document: JSON.parse(snapshot), revision: current?.revision || 0 }) });
      if (account !== owner || token !== epoch) return;
      records = [record, ...records.filter(item => item.id !== record.id)]; current = record;
      dirty = JSON.stringify(draft) !== snapshot; loadError = ''; loaded = true; notice('Private case saved. Evidence publication and payment status are unchanged.');
    } catch (error) { if (account === owner && token === epoch) notice(error.status === 409 ? error.message + ' Export your meeting brief to preserve unsaved work, then reload the saved case.' : 'Case was not saved: ' + error.message); }
    finally { if (account === owner && token === epoch) { saving = false; repaint(); } }
  }
  async function loadReviews() {
    const node = selectedNode(); if (!node?.jobId) return;
    const id = node.id, owner = account, token = epoch; bundle = null; bundleError = ''; repaint();
    try { const result = await api('/api/v1/jobs/' + encodeURIComponent(node.jobId) + '/bundle'); if (token === epoch && owner === account && selected === id) bundle = result; }
    catch (error) { if (token === epoch && owner === account && selected === id) bundleError = error.message; }
    if (token === epoch && owner === account && selected === id) repaint();
  }
  function downloadBrief() {
    const meeting = draft.meeting;
    const body = ['ASTRA-VIA · PRIVATE MEETING BRIEF', draft.title, 'Case reference: ' + (draft.reference || 'Not specified'), 'Scope: ' + draft.summary, '', 'MEETING', meeting.title || 'Untitled meeting', 'Local date/time: ' + (meeting.date || 'Not scheduled'), 'Participants: ' + meeting.participants, 'Objective: ' + meeting.objective, '', 'AGENDA', meeting.agenda, '', 'QUESTIONS', ...meeting.questions.map(q => `[${q.done ? 'x' : ' '}] ${q.text}`), '', 'EVIDENCE EXHIBITS', ...evidence().map((node, i) => { const job = jobFor(node); return `\nExhibit ${i + 1}: ${node.title}\nTask: ${node.jobId}\nClaim: ${job?.claim || 'Currently unavailable'}\nQuotation: ${job?.quote || 'Currently unavailable'}\nLocation: ${job?.location || 'Unavailable'}\nSource: ${job?.sourceUrl || 'Unavailable'}\nProposed relationship: ${job?.relationship || 'Unavailable'}\nIndependent review status: open the evidence review; reviews are not included in this brief.`; }), '', 'WORKING ANNOTATIONS · UNVERIFIED', ...draft.nodes.filter(n => n.kind !== 'evidence').map(n => `${n.kind}: ${n.title}\n${n.body}`), '', 'PROPOSED CONNECTIONS · WORKING ASSESSMENTS', ...draft.links.map(link => `${draft.nodes.find(n => n.id === link.from)?.title} → ${link.relationship} → ${draft.nodes.find(n => n.id === link.to)?.title}${link.label ? ': ' + link.label : ''}`), '', 'NOTES & NEXT ACTIONS', meeting.notes, '', 'This private working brief is not a verified finding or an independent review. No IPFS publication, ledger attestation or payment is initiated by this export.'].join('\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'astra-case-meeting-brief.txt'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function mount(page) {
    mode = page;
    const root = document.querySelector('.case-workspace'); if (!root) return;
    const canvas = root.querySelector('.case-canvas'), sizer = root.querySelector('.case-board-sizer');
    if (canvas) { canvas.style.transform = `scale(${zoom})`; sizer.style.width = `${1500 * zoom}px`; sizer.style.height = `${1080 * zoom}px`; }
    for (const el of root.querySelectorAll('[data-cw-node]')) {
      const node = draft.nodes.find(n => n.id === el.dataset.cwNode); el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; el.hidden = filter !== 'all' && node.kind !== filter;
    }
    for (const edge of root.querySelectorAll('[data-edge-from]')) edge.toggleAttribute('hidden', filter !== 'all' && ![edge.dataset.edgeFrom, edge.dataset.edgeTo].every(id => draft.nodes.find(n => n.id === id)?.kind === filter));
    root.querySelector('[data-cw-action="save"]').disabled = saving;
    root.querySelector('[data-cw-action="new-case"]').disabled = saving;
    root.querySelector('#case-select').disabled = saving;
    root.onclick = async event => {
      const target = event.target.closest('button'); if (!target) return;
      if (target.dataset.cwNode) {
        if (dragMoved) { dragMoved = false; return; }
        selected = target.dataset.cwNode; library = false; bundle = null; bundleError = ''; repaint(); if (selectedNode()?.jobId) void loadReviews(); return;
      }
      if (target.dataset.cwFilter) { filter = target.dataset.cwFilter; repaint(); return; }
      if (target.dataset.cwPin) {
        const pinned = evidence().find(n => n.jobId === target.dataset.cwPin);
        if (pinned) selected = pinned.id;
        else { if (draft.nodes.length >= 80) return notice('The pilot supports up to 80 cards per case.'); const job = jobs.find(j => j.id === target.dataset.cwPin); if (!job) return; const node = { id: crypto.randomUUID(), kind: 'evidence', jobId: job.id, title: job.title, body: '', ...nextPosition() }; draft.nodes.push(node); selected = node.id; changed(); }
        library = false; bundleError = ''; repaint(); void loadReviews(); return;
      }
      if (target.dataset.cwTask) return onTask(target.dataset.cwTask);
      if (target.dataset.cwUnlink) { draft.links = draft.links.filter(l => l.id !== target.dataset.cwUnlink); changed(); repaint(); return; }
      if (target.dataset.cwRemoveQuestion) { draft.meeting.questions = draft.meeting.questions.filter(q => q.id !== target.dataset.cwRemoveQuestion); changed(); repaint(); return; }
      const node = selectedNode();
      switch (target.dataset.cwAction) {
        case 'new-case': if (!dirty || window.confirm('Discard unsaved case changes and create another case?')) caseDialog(true); break;
        case 'edit-case': caseDialog(); break;
        case 'save': await save(); break;
        case 'retry': await load({ id: account }, jobs, true); repaint(); break;
        case 'add-card': cardDialog(); break;
        case 'edit-card': cardDialog(node); break;
        case 'add-link': linkDialog(); break;
        case 'library': library = true; repaint(); break;
        case 'remove-card': draft.nodes = draft.nodes.filter(n => n.id !== selected); draft.links = draft.links.filter(l => l.from !== selected && l.to !== selected); selected = null; library = true; bundle = null; changed(); repaint(); break;
        case 'zoom-in': zoom = Math.min(1.25, Math.round((zoom + .1) * 100) / 100); repaint(); break;
        case 'zoom-out': zoom = Math.max(.5, Math.round((zoom - .1) * 100) / 100); repaint(); break;
        case 'open-task': if (node?.jobId) onTask(node.jobId); break;
        case 'review': if (node?.jobId) onReview(node.jobId); break;
        case 'assist': if (node?.jobId) onAssist(node.jobId); break;
        case 'refresh-reviews': void loadReviews(); break;
        case 'new-task': onNewTask(); break;
        case 'investigation': case 'legal': onNavigate(target.dataset.cwAction); break;
        case 'export-brief': downloadBrief(); break;
      }
    };
    root.oninput = event => {
      if (event.target.dataset.meetingField) { draft.meeting[event.target.dataset.meetingField] = event.target.value; changed(); }
      if (event.target.id === 'case-library-search') { search = event.target.value; root.querySelector('#case-library-results').innerHTML = libraryResults(); }
    };
    root.onchange = event => {
      if (event.target.dataset.cwQuestion) { const q = draft.meeting.questions.find(q => q.id === event.target.dataset.cwQuestion); if (q) q.done = event.target.checked; changed(); repaint(); }
      if (event.target.id === 'case-select') {
        if (dirty && !window.confirm('Discard unsaved changes and open another case?')) { event.target.value = current?.id || ''; return; }
        current = records.find(r => r.id === event.target.value) || null; draft = current ? structuredClone(current.document) : blank(); dirty = false; selected = null; library = true; bundle = null; epoch++; repaint();
      }
    };
    const form = root.querySelector('#case-question-form');
    if (form) form.onsubmit = event => { event.preventDefault(); const text = form.elements.question.value.trim(); if (!text) return; if (draft.meeting.questions.length >= 60) return notice('The pilot supports up to 60 meeting questions.'); draft.meeting.questions.push({ id: crypto.randomUUID(), text, done: false }); changed(); repaint(); };
    root.onkeydown = event => {
      const el = event.target.closest('[data-cw-node]'); if (!el || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); const node = draft.nodes.find(n => n.id === el.dataset.cwNode), step = event.shiftKey ? 40 : 10;
      node.x = Math.max(0, Math.min(1260, node.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)));
      node.y = Math.max(0, Math.min(880, node.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)));
      changed(); repaint(); document.querySelector(`[data-cw-node="${node.id}"]`)?.focus();
    };
    root.onpointerdown = event => {
      const el = event.target.closest('[data-cw-node]'); if (!el || event.button !== 0) return;
      const node = draft.nodes.find(n => n.id === el.dataset.cwNode), start = { x: event.clientX, y: event.clientY, nx: node.x, ny: node.y }; dragMoved = false;
      el.setPointerCapture?.(event.pointerId);
      el.onpointermove = move => {
        if (Math.abs(move.clientX - start.x) + Math.abs(move.clientY - start.y) < 5 && !dragMoved) return;
        dragMoved = true;
        node.x = Math.max(0, Math.min(1260, Math.round(start.nx + (move.clientX - start.x) / zoom)));
        node.y = Math.max(0, Math.min(880, Math.round(start.ny + (move.clientY - start.y) / zoom)));
        el.style.left = `${node.x}px`; el.style.top = `${node.y}px`;
        for (const edge of root.querySelectorAll('[data-edge-from]')) {
          const from = draft.nodes.find(n => n.id === edge.dataset.edgeFrom), to = draft.nodes.find(n => n.id === edge.dataset.edgeTo), line = edge.querySelector('line'), label = edge.querySelector('text');
          line.setAttribute('x1', from.x + 110); line.setAttribute('y1', from.y + 72); line.setAttribute('x2', to.x + 110); line.setAttribute('y2', to.y + 72); label.setAttribute('x', (from.x + to.x) / 2 + 110); label.setAttribute('y', (from.y + to.y) / 2 + 63);
        }
      };
      const finish = () => { el.onpointermove = null; el.onpointerup = null; el.onpointercancel = null; if (dragMoved) changed(); };
      el.onpointerup = finish; el.onpointercancel = finish;
    };
  }
  window.addEventListener('beforeunload', event => { if (dirty && account) { event.preventDefault(); event.returnValue = ''; } });
  return { load, markup, mount, clear, updateJobs(items) { jobs = items; } };
}

export function web3Markup(jobs, feeBps) {
  const owned = jobs, gross = owned.reduce((sum, job) => sum + job.fee.grossCents, 0), fee = owned.reduce((sum, job) => sum + job.fee.feeCents, 0);
  return `<section class="web3-process"><div class="eyebrow">Evidence / Review / Provenance / Rewards</div><h2>The Web3 review process</h2><p class="workflow-intro">A review budget follows its evidence from the source to the reviewer. Funding, ledger attestations and settlement require a connected payment and chain integration.</p><div class="web3-stages">${[
    ['01', 'Create & scope', 'Available', 'Save a claim, exact quotation, source and proposed review budget.', 'tasks'],
    ['02', 'Investigate', 'Available', 'Connect evidence, people, events and open questions in a private case.', 'investigation'],
    ['03', 'Independent review', 'Pilot', 'An independent account explains whether a source supports or challenges the claim.', 'tasks'],
    ['04', 'Bundle & store', 'IPFS available', 'Export a SHA-256 bundle. Eligible public tasks can be published with explicit approval.', 'storage'],
    ['05', 'Anchor & attest', 'Planned', 'Anchor the content digest and review provenance to a selected ledger.', null],
    ['06', 'Accept & settle', 'Planned', `Fund an agreed review, resolve acceptance, then split reviewer rewards and the ${feeBps / 100}% service fee.`, null],
  ].map(([n, title, status, text, page]) => `<article class="web3-stage ${page ? '' : 'planned'}"><span class="stage-number">${n}</span><span class="tag ${page ? 'mint' : 'neutral'}">${status}</span><h3>${title}</h3><p>${text}</p>${page ? `<button class="textbtn" data-page="${page}">Open ${page === 'investigation' ? 'case board' : page === 'storage' ? 'files & network' : 'review tasks'} ↗</button>` : '<span class="stage-pending">Integration pending</span>'}</article>`).join('')}</div><section class="panel"><div class="panelhead"><h2>Your proposed review budgets</h2><span class="tag neutral">UNFUNDED QUOTES</span></div>${owned.length ? `<div class="tablewrap"><table><thead><tr><th>EVIDENCE TASK</th><th>BUDGET</th><th>ASTRA-VIA FEE</th><th>REVIEWER ALLOCATION</th><th>SETTLEMENT</th></tr></thead><tbody>${owned.map(job => `<tr><td><button class="task-link" data-task="${esc(job.id)}">${esc(job.title)}</button><small>${esc(job.status)}</small></td><td>${money(job.fee.grossCents)}</td><td>${money(job.fee.feeCents)}</td><td>${money(job.fee.validatorCents)}</td><td><span class="tag neutral">Not connected</span></td></tr>`).join('')}<tr><td>Total quoted</td><td>${money(gross)}</td><td>${money(fee)}</td><td>${money(gross - fee)}</td><td>Unfunded</td></tr></tbody></table></div>` : '<div class="empty">Create a review task to set its proposed reviewer budget.</div>'}</section><p class="workflow-note">Private case files and meeting notes stay separate from publishable evidence bundles. A stored digest or ledger receipt records provenance; it does not establish that a claim is true.</p></section>`;
}

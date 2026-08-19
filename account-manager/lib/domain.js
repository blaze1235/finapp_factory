// Shared domain vocabulary. Anything both a route and a surface need to agree
// on lives here rather than being restated in each.

// Internally there are six states. A client is shown three buckets, because
// which of our internal stages a thing is sitting in is our business, not
// theirs — except when the ball is in their court, which is an action rather
// than a status and gets pulled out of the buckets entirely.
const CLIENT_BUCKET = {
  todo:            'coming_up',
  in_progress:     'in_progress',
  in_review:       'in_progress',   // "in review" is internal business
  awaiting_client: 'needs_you',     // surfaced as an action, not a bucket
  approved:        'done',
  completed:       'done',
};

const STAGES = ['brief', 'production', 'review', 'delivered', 'archived'];

// Open question 2: stages are set by hand, but the UI proposes the next one
// once nothing in the current stage is outstanding. Automatic stages lie (a
// project is not "delivered" because its tasks closed); unattended manual ones
// rot. A proposal the owner accepts with one click is the honest middle.
function suggestStage(project, tasks) {
  const live = tasks.filter(t => t.is_deliverable);
  if (!live.length) return null;
  const all = s => live.every(t => s.includes(t.status));
  const some = s => live.some(t => s.includes(t.status));
  if (project.stage === 'brief' && some(['in_progress', 'in_review', 'awaiting_client'])) return 'production';
  if (project.stage === 'production' && all(['in_review', 'awaiting_client', 'approved', 'completed'])) return 'review';
  if (project.stage === 'review' && all(['approved', 'completed'])) return 'delivered';
  return null;
}

// What a client is allowed to know about a task, assembled explicitly.
// Building the client's view by *listing* fields rather than deleting them
// means a column added later is private until someone chooses otherwise.
function clientTaskView(t, memberNames = {}) {
  return {
    id: t.id,
    title: t.title,
    description: t.description || '',
    bucket: CLIENT_BUCKET[t.status] || 'coming_up',
    needs_you: t.status === 'awaiting_client',
    due: t.client_due_date,                 // never t.due_date
    assignee: memberNames[t.assignee_id] || null,  // the client asked for names
    revision_round: t.revision_round,
    version: t.latest_version || null,
    updated_at: t.updated_at || t.created_at,
  };
}

const money = (n, currency = 'UZS') =>
  `${Number(n || 0).toLocaleString('en-US')} ${currency}`;

module.exports = { CLIENT_BUCKET, STAGES, suggestStage, clientTaskView, money };

// Writes the frozen, made-up test vault in tests/fixtures/vault. Every name in it is invented.
// `node tests/fixtures/make-vault.js` (rewrites the notes; keeps the saved TaskNotes snapshot).
const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, 'vault');
const w = (p, s) => { const f = path.join(OUT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const yv = (v) => (v === null ? '' : typeof v === 'string' && /^\[\[|^#|['"]|: /.test(v) && !/^\d{4}-\d\d-\d\dT/.test(v) ? JSON.stringify(v) : String(v));
const fmText = (fm) => Object.entries(fm).map(([k, v]) => {
  if (Array.isArray(v)) return v.length ? `${k}:\n${v.map((x) => typeof x === 'object' ? '  - ' + Object.entries(x).map(([a, b], i) => `${i ? '    ' : ''}${a}: ${yv(b)}`).join('\n') : `  - ${yv(x)}`).join('\n')}` : `${k}: []`;
  return v === null ? `${k}:` : `${k}: ${yv(v)}`;
}).join('\n');
const note = (fm, body) => `---\n${fmText(fm)}\n---\n${body ? '\n' + body + '\n' : ''}`;
const PJ = '04 Inner World/My Life/Projects';
const link = (n) => `[[${PJ}/${n}]]`;

// Projects: every sphere (work, personal, none = unsorted) and every kind of status.
const projects = [
  ['Bakery Website', 'work', 'active'], ['Shop Inventory', 'work', 'paused'], ['Newsletter', 'work', 'backlog'],
  ['Delivery Routes', 'work', 'waiting'], ['Van Repairs', 'work', 'blocked'], ['Old Booking Form', 'work', 'done'], ['Print Catalog', 'work', 'failed'],
  ['Pricing Calculator', 'work', 'idea'], ['Market Stall', 'work', 'cold-storage'],
  ['Home Repairs', 'personal', 'active'], ['Learn Spanish', 'personal', 'paused'], ['Fitness', 'personal', 'active'],
  ['Bike Trip', 'personal', 'dropped'], ['Book Club', 'personal', 'idea'], ['Woodworking', 'personal', 'cold-storage'],
  ['Odds and Ends', null, 'active'], ['Loose Ends', null, 'backlog'],
];
for (const [name, sphere, status] of projects) {
  const fm = { type: 'project', name, status }; if (sphere) fm.sphere = sphere;
  if (['done', 'failed', 'dropped'].includes(status)) fm.end_date = '2026-09-20';
  w(`${PJ}/${name}.md`, note(fm, `Status: [[${status}]]\n\n## Notes\n\nMade-up project for the test data.`));
}

// Tasks.
const base = (o) => ({ status: 'open', priority: 'normal', dateCreated: '2026-09-10T09:00:00.000-06:00', dateModified: '2026-10-01T09:00:00.000-06:00', tags: ['task'], ...o });
const T = '02 Planner/TaskNotes/Tasks'; const A = '02 Planner/TaskNotes/Archive';
const open = [
  ['Buy flour', { projects: [link('Bakery Website')], due: '2026-10-02' }],
  ['Fix the menu photos', { projects: [link('Bakery Website')], scheduled: '2026-10-09', planned_day: '2026-10-09', planned_half: 'am', planned_order: 10 }],
  ['Write the about page', { projects: [link('Bakery Website')], title: 'Write the About page (short version)' }],
  ['Order boxes', { projects: [link('Shop Inventory')], due: '2026-10-20T15:00', reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: '-PT15M' }] }],
  ['Count the jars', { projects: [link('Shop Inventory')], status: 'in-progress' }],
  ['Draft first issue', { projects: [link('Newsletter')], priority: 'high', scheduled: '2026-10-05' }],
  ['Pick a mailing tool', { projects: [link('Newsletter')], status: 'blocked', blockedBy: [{ uid: '[[Draft first issue]]', reltype: 'FINISHTOSTART' }] }],
  ['Map the north route', { projects: [link('Delivery Routes')], scheduled: '2026-12-01' }],
  ['Call the van rental', { projects: [link('Delivery Routes')], due: '2026-10-08T10:30', contexts: ['phone'] }],
  ['Patch the fence', { projects: [link('Home Repairs')], planned_day: '2026-10-04', planned_half: 'pm', planned_order: 20 }],
  ['Paint the shed door', { projects: [link('Home Repairs')], timeEstimate: 90 }],
  ['Replace kitchen tap', { projects: [link('Home Repairs')], title: 'Replace the kitchen tap' }],
  ['Practice verbs', { projects: [link('Learn Spanish')], scheduled: '2026-10-07' }],
  ['Watch a film in Spanish', { projects: [link('Learn Spanish')] }],
  ['Book a running shoe fitting', { projects: [link('Fitness')], due: '2026-10-15' }],
  ['Sort the garage', { projects: [link('Odds and Ends')] }],
  ['Return library books', { projects: [link('Odds and Ends')], due: '2026-10-03' }],
  ['Check the tyre pressure', { projects: [link('Loose Ends')] }],
  ['Renew the parking permit', { due: '2026-10-30' }],
  ['Send thank-you cards', {}],
  ['Clean the gutters', { scheduled: '2026-10-11' }],
  ['Look into a new kettle', { title: 'Look into a new kettle (quiet one)' }],
  ['Try the bread recipe', { status: 'someday' }],
  ['Learn to juggle', { status: 'someday', projects: [link('Fitness')] }],
  ['Check the smoke alarms', { priority: 'high', due: '2026-10-06' }],
  ['Back up the photos', { scheduled: '2026-10-04T18:00' }],
  ['Update the price list', { projects: [link('Bakery Website')], due: '2026-10-12' }],
  ['Plan the weekend market', { projects: [link('Shop Inventory')], planned_day: '2026-10-10', planned_half: 'am', planned_order: 30 }],
  ['Choose a newsletter name', { projects: [link('Newsletter')], title: 'Choose a name for the newsletter' }],
  ['Fix the bike light', {}],
];
const repeats = [
  ['Water the plants', { recurrence: 'DTSTART:20260905;FREQ=DAILY;INTERVAL=2', scheduled: '2026-10-15', planned_day: '2026-09-05', planned_half: 'am', planned_order: 20, projects: [link('Odds and Ends')], complete_instances: ['2026-09-05', '2026-09-07', '2026-10-01', '2026-10-03', '2026-10-05'], skipped_instances: [] }],
  ['Log the mood of the day', { recurrence: 'DTSTART:20260901;FREQ=DAILY', scheduled: '2026-10-06', complete_instances: ['2026-10-01', '2026-10-02', '2026-10-04'], skipped_instances: ['2026-10-03'] }],
  ['Weekly review', { recurrence: 'DTSTART:20260907;FREQ=WEEKLY;BYDAY=MO', scheduled: '2026-10-05', due: '2026-10-05', complete_instances: ['2026-09-07', '2026-09-14', '2026-09-28'], skipped_instances: [] }],
  ['Pay the water bill', { recurrence: 'DTSTART:20260815;FREQ=MONTHLY;BYMONTHDAY=15', scheduled: '2026-10-15T09:30', complete_instances: ['2026-08-15', '2026-09-15'], skipped_instances: [] }],
];
for (const [n, o] of [...open, ...repeats]) w(`${T}/${n}.md`, note(base(o), 'Made-up task for the test data.'));
// Finished tasks still in Tasks, and archived ones.
const doneHere = ['Measure the windows', 'Buy stamps', 'Wash the car', 'Email the printer', 'Sweep the porch', 'Tidy the desk', 'Bake test loaves', 'Choose paint colour', 'Call the plumber', 'Sharpen the knives', 'Water the lawn', 'Fold the laundry', 'Recycle the boxes', 'Oil the hinges'];
doneHere.forEach((n, i) => w(`${T}/${n}.md`, note(base({ status: i % 5 ? 'done' : 'closed', completedDate: `2026-10-0${1 + (i % 9)}`, projects: i % 2 ? [link('Home Repairs')] : [] }))));
const archived = ['Set up the shop page', 'Print flyers', 'Order business cards', 'Photograph the cakes', 'Fix the oven door', 'Buy a tent', 'Plan the bike route', 'Renew passport', 'Pick a gym', 'Clear the attic', 'Test the booking form', 'Write the welcome email', 'Old watering schedule', 'Reply to the landlord', 'Find a tailor', 'Order a new mattress', 'Buy running socks', 'Clean the windows', 'Check the boiler', 'Donate old clothes'];
archived.forEach((n, i) => {
  const o = { status: i % 7 ? 'done' : 'closed', completedDate: '2026-09-0' + (1 + (i % 9)), archived: true, projects: [link(['Old Booking Form', 'Bike Trip', 'Print Catalog', 'Bakery Website'][i % 4])] };
  if (n === 'Old watering schedule') Object.assign(o, { recurrence: 'DTSTART:20260801;FREQ=WEEKLY;BYDAY=SA', complete_instances: ['2026-08-01', '2026-08-08'], skipped_instances: [] });
  if (i === 3) o.title = 'Photograph the cakes for the shop';
  w(`${A}/${n}.md`, note(base(o)));
});

// Settings and the other files the checks look for.
const snap = JSON.parse(fs.readFileSync(path.join(OUT, '.obsidian/plugins/a4-projects/data.json'), 'utf8')).tnSnapshot;
w('.obsidian/plugins/tasknotes/data.json', JSON.stringify({ ...snap, enableNotifications: false }, null, 2) + '\n');
w('.obsidian/plugins/a4-projects/data.json', JSON.stringify({ tnSnapshot: snap }, null, 2) + '\n');
// Obsidian's Daily notes setting and LifeWorld's "Your vault" folders, shaped like the owner's.
w('.obsidian/daily-notes.json', JSON.stringify({ folder: '00 Daily Scratchpad', format: 'MM-DD-YYYY', autorun: false, template: '06 AI Team/AI Team Knowledge/Templates/Daily Scratchpad' }, null, 2) + '\n');
w('.obsidian/plugins/lifeworld/data.json', JSON.stringify({ lifeworld: { vault: { folders: { tasks: '02 Planner/TaskNotes/Tasks', archive: '02 Planner/TaskNotes/Archive', projects: PJ, goals: '04 Inner World/My Life/Goals', habits: '04 Inner World/My Life/Habits', journal: '04 Inner World/Journal' }, feeds: { calendar: '02 Planner/Calendar Events.md', weather: '02 Planner/Weather Today.md' } } } }, null, 2) + '\n');
w('.obsidian/zk-prefixer.json', JSON.stringify({ folder: '00 Daily Scratchpad', format: 'MM-DD-YYYY - h-mm A', template: '' }, null, 2) + '\n');
w('00 Daily Scratchpad/10-01-2026.md', 'Made-up daily note for the test data.\n');
w('06 AI Team/Agents/agent-index.md', '# Agents\n\nMade-up roster for the test data.\n');
const baseFile = 'views:\n  - type: table\n    name: Table\n';
for (const p of ['04 Inner World/Contacts/Companies/Companies.base', '04 Inner World/Contacts/People/People.base', '04 Inner World/Documents/Documents.base', '04 Inner World/Library Notes/Library Notes.base', '04 Inner World/My Life/Guide/Places.base']) w(p, baseFile);
for (const v of ['agenda-default', 'calendar-default', 'kanban-default', 'mini-calendar-default', 'pomodoro-stats', 'relationships', 'tasks-default']) w(`02 Planner/TaskNotes/Views/${v}.base`, baseFile);
w('README.md', '# Frozen test data\n\nMade-up notes shaped like a real LifeWorld vault (tasks, projects, settings).\nThe vault-reading checks run on this when `A4_VAULT` is not set. Nothing here is real.\nWritten by `tests/fixtures/make-vault.js`; change the data there and re-run it.\n');

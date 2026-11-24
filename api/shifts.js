// Stores everything (shifts, employees, default shift times) in one private JSON file in Vercel Blob.
// GET returns it all; POST applies one change ({op: 'add'|'update'|'delete'|'settings'}).
// Every request must carry the page password in the x-apex-password header.
import { get, head, put, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';

const FILE = 'apex/shifts.json';
const PASSWORD = process.env.APEX_PASSWORD || '1717';

// Sunday = 0 … Saturday = 6
const DEFAULT_TIMES = {
  0: { start: '10:00', end: '16:00' },
  1: { start: '14:00', end: '21:00' },
  2: { start: '16:00', end: '21:00' },
  3: { start: '14:00', end: '21:00' },
  4: { start: '16:00', end: '21:00' },
  5: { start: '15:00', end: '21:00' },
  6: { start: '09:00', end: '16:00' },
};

const TIME = /^\d{2}:\d{2}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const initialsOf = (name) => {
  const p = name.trim().split(/\s+/);
  return (p.length > 1 ? p.map((w) => w[0]).join('') : p[0].slice(0, 2)).toUpperCase();
};

function normalize(data) {
  const shifts = Array.isArray(data?.shifts) ? data.shifts : [];
  let employees = Array.isArray(data?.employees) ? data.employees : null;
  // Older files have no employee list: build one from the names already logged.
  if (!employees) {
    const seen = new Map();
    // Ids come from the name so they stay the same on every load until settings are first saved.
    for (const s of shifts) if (s.name && !seen.has(s.name)) seen.set(s.name, { id: 'n-' + s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: s.name, initials: initialsOf(s.name) });
    employees = [...seen.values()];
    for (const s of shifts) if (!s.employeeId && seen.has(s.name)) s.employeeId = seen.get(s.name).id;
  }
  const defaults = {};
  for (let d = 0; d < 7; d++) {
    const t = data?.defaults?.[d];
    defaults[d] = t && TIME.test(t.start) && TIME.test(t.end) ? { start: t.start, end: t.end } : DEFAULT_TIMES[d];
  }
  return { shifts, employees, defaults };
}

async function load() {
  // The version tag comes from head(), in the same format put() expects back in ifMatch.
  let etag = null;
  try {
    etag = (await head(FILE)).etag;
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
    return { data: normalize({}), etag: null };
  }
  const res = await get(FILE, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) throw new Error('Could not read saved shifts');
  return { data: normalize(JSON.parse(await new Response(res.stream).text())), etag };
}

async function save(data, etag, force) {
  await put(FILE, JSON.stringify(data), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    ...(force ? { allowOverwrite: true } : etag ? { ifMatch: etag } : { allowOverwrite: false }),
  });
}

function cleanShift(s) {
  const name = String(s?.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const date = String(s?.date || '');
  const hours = Number(s?.hours);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !TIME.test(s?.start) || !TIME.test(s?.end) || !(hours > 0 && hours <= 24)) return null;
  return { employeeId: s.employeeId ? String(s.employeeId) : undefined, name, date, start: s.start, end: s.end, hours };
}

function cleanSettings(body) {
  const employees = (Array.isArray(body?.employees) ? body.employees : [])
    .map((e) => {
      const name = String(e?.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!name) return null;
      const initials = String(e?.initials || '').trim().toUpperCase().slice(0, 3) || initialsOf(name);
      return { id: e?.id ? String(e.id) : crypto.randomUUID(), name, initials };
    })
    .filter(Boolean);
  const defaults = normalize({ defaults: body?.defaults }).defaults;
  return { employees, defaults };
}

function apply(data, { op, id, shift, settings }) {
  const now = Date.now();
  if (op === 'add') return { ...data, shifts: [...data.shifts, { id: crypto.randomUUID(), ...shift, createdAt: now }] };
  if (op === 'update') return { ...data, shifts: data.shifts.map((s) => (s.id === id ? { ...s, ...shift, updatedAt: now } : s)) };
  if (op === 'delete') return { ...data, shifts: data.shifts.filter((s) => s.id !== id) };
  if (op === 'settings') {
    // Keep each shift's stored name in step with a renamed employee.
    // Shifts with no matching employee id are matched by name.
    const byId = new Map(settings.employees.map((e) => [e.id, e]));
    const byName = new Map(settings.employees.map((e) => [e.name.toLowerCase(), e]));
    return {
      ...data,
      ...settings,
      shifts: data.shifts.map((s) => {
        const e = byId.get(s.employeeId) || byName.get(String(s.name).toLowerCase());
        return e ? { ...s, employeeId: e.id, name: e.name } : s;
      }),
    };
  }
  return null;
}

const authorized = (req) => req.headers.get('x-apex-password') === PASSWORD;

export async function GET(req) {
  if (!authorized(req)) return json({ error: 'Wrong password' }, 401);
  try {
    return json((await load()).data);
  } catch (err) {
    return json({ error: err.message || 'Could not load shifts' }, 500);
  }
}

export async function POST(req) {
  if (!authorized(req)) return json({ error: 'Wrong password' }, 401);
  const body = await req.json().catch(() => ({}));
  const change = { op: body.op, id: body.id };
  if (body.op === 'add' || body.op === 'update') {
    change.shift = cleanShift(body.shift);
    if (!change.shift) return json({ error: 'Shift is missing an employee, date, start or end time' }, 400);
  } else if (body.op === 'settings') {
    change.settings = cleanSettings(body);
  } else if (body.op !== 'delete') {
    return json({ error: 'Unknown change' }, 400);
  }

  try {
    // If someone else saved in between, re-read and apply this change on top of theirs.
    // After a few tries, save anyway on top of the latest copy rather than failing.
    for (let attempt = 0; attempt < 4; attempt++) {
      const force = attempt === 3;
      const { data, etag } = await load();
      const next = apply(data, change);
      try {
        await save(next, etag, force);
        return json(next);
      } catch (err) {
        if (!force && (err instanceof BlobPreconditionFailedError || /exist|precondition/i.test(err?.message || ''))) continue;
        throw err;
      }
    }
  } catch (err) {
    return json({ error: err.message || 'Could not save' }, 500);
  }
}

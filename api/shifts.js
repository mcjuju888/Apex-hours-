// Stores every shift in one private JSON file in Vercel Blob.
// GET returns all shifts; POST applies one change ({op: 'add'|'update'|'delete'}).
// Every request must carry the page password in the x-apex-password header.
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const FILE = 'apex/shifts.json';
const PASSWORD = process.env.APEX_PASSWORD || '1717';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function load() {
  const res = await get(FILE, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return { shifts: [], etag: null };
  const data = JSON.parse(await new Response(res.stream).text());
  return { shifts: Array.isArray(data.shifts) ? data.shifts : [], etag: res.blob.etag };
}

async function save(shifts, etag) {
  await put(FILE, JSON.stringify({ shifts }), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
  });
}

function clean(s) {
  const name = String(s?.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const date = String(s?.date || '');
  const time = /^\d{2}:\d{2}$/;
  const hours = Number(s?.hours);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time.test(s?.start) || !time.test(s?.end) || !(hours > 0 && hours <= 24)) return null;
  return { name, date, start: s.start, end: s.end, hours };
}

const authorized = (req) => req.headers.get('x-apex-password') === PASSWORD;

export async function GET(req) {
  if (!authorized(req)) return json({ error: 'Wrong password' }, 401);
  const { shifts } = await load();
  return json({ shifts });
}

export async function POST(req) {
  if (!authorized(req)) return json({ error: 'Wrong password' }, 401);
  const { op, id, shift } = await req.json().catch(() => ({}));
  const body = op === 'delete' ? null : clean(shift);
  if (op !== 'delete' && !body) return json({ error: 'Shift is missing a name, date, start or end time' }, 400);

  // Two people saving at the same moment: re-read and retry instead of overwriting each other.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { shifts, etag } = await load();
    let next;
    if (op === 'add') next = [...shifts, { id: crypto.randomUUID(), ...body, createdAt: Date.now() }];
    else if (op === 'update') next = shifts.map((s) => (s.id === id ? { ...s, ...body, updatedAt: Date.now() } : s));
    else if (op === 'delete') next = shifts.filter((s) => s.id !== id);
    else return json({ error: 'Unknown change' }, 400);
    try {
      await save(next, etag);
      return json({ shifts: next });
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError || /exist/i.test(err?.message || '')) continue;
      throw err;
    }
  }
  return json({ error: 'Too many people saving at once. Try again.' }, 409);
}

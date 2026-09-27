import type { Server } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { buildApp } from '../src/bootstrap/app.factory';
import { Database } from '../src/infrastructure/database/database';
import { migrateDatabase, seedCatalog } from '../src/infrastructure/database/seed';
import { GetTodayUseCase } from '../src/modules/personalization/application/daily.usecases';
import { DAILY_PICK_REPOSITORY } from '../src/modules/personalization/domain/daily.repository';
import type { DailyPickRepository } from '../src/modules/personalization/domain/daily.repository';

/**
 * The daily ritual against real SQL.
 *
 * What only Postgres can get wrong: a `date` column round-tripping through a
 * JS Date and shifting a day, `time` formatting, the first-writer-wins insert
 * under two simultaneous first opens, and the guest flag surviving a claim.
 *
 *   TEST_DATABASE_URL=postgres://firo@127.0.0.1:5433/firo_test pnpm test
 */
const CONNECTION = process.env['TEST_DATABASE_URL'];
const describeIfDb = CONNECTION ? describe : describe.skip;

describeIfDb('The daily ritual over Postgres (e2e)', () => {
  let app: NestFastifyApplication;
  let server: Server;
  let db: Database;
  let token: string;
  let userId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    process.env['DATABASE_URL'] = CONNECTION;
    process.env['JWT_SECRET'] ??= 'postgres-test-secret-long-enough';

    db = new Database({ connectionString: CONNECTION as string });
    await migrateDatabase(db);
    await seedCatalog(db);

    app = await buildApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    server = app.getHttpServer() as Server;

    const guest = await request(server).post('/v1/auth/guest').send({}).expect(201);
    token = guest.body.data.tokens.accessToken;
    userId = guest.body.data.user.id;
  }, 45_000);

  afterAll(async () => {
    if (db && userId) {
      // Cascades take the picks, the rhythm, the DNA and the keeps with it.
      await db.query('DELETE FROM identity.users WHERE id = $1', [userId]).catch(() => undefined);
    }
    await db?.close();
    await app?.close();
    delete process.env['DATABASE_URL'];
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it('stores a guest as a real row flagged is_guest', async () => {
    const row = await db.queryOne<{ is_guest: boolean; email: string | null }>(
      'SELECT is_guest, email FROM identity.users WHERE id = $1',
      [userId],
    );
    expect(row).toEqual({ is_guest: true, email: null });
  });

  it("stores today's pick against the user's LOCAL date, not the server's", async () => {
    // 23:30 UTC is already tomorrow in Oslo. A `date` column read back as a JS
    // Date at local midnight is the classic way this silently shifts a day.
    const view = await app.get(GetTodayUseCase).execute({
      userId,
      timeZone: 'Europe/Oslo',
      now: new Date('2031-03-14T23:30:00Z'),
    });
    expect(view.day).toBe('2031-03-15');

    const row = await db.queryOne<{ day: string }>(
      `SELECT day::text AS day FROM personalization.daily_picks WHERE user_id = $1`,
      [userId],
    );
    expect(row?.day).toBe('2031-03-15');
  });

  it('lets exactly one of two simultaneous first opens win', async () => {
    const picks = app.get<DailyPickRepository>(DAILY_PICK_REPOSITORY);
    const [a, b] = await Promise.all([
      picks.saveIfAbsent({
        userId,
        day: '2031-03-20',
        experienceId: 'exp_lofoten_blue_hour',
        reason: 'a',
        isWildcard: false,
        chosenAt: new Date().toISOString(),
      }),
      picks.saveIfAbsent({
        userId,
        day: '2031-03-20',
        experienceId: 'exp_erg_chebbi_silence',
        reason: 'b',
        isWildcard: false,
        chosenAt: new Date().toISOString(),
      }),
    ]);
    // Both callers see the same stored pick, whichever it was.
    expect(a.experienceId).toBe(b.experienceId);
    const count = await db.queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM personalization.daily_picks WHERE user_id = $1 AND day = '2031-03-20'`,
      [userId],
    );
    expect(count?.n).toBe('1');
  });

  it('reads a month back as plain dates, in order', async () => {
    const today = app.get(GetTodayUseCase);
    for (const day of ['2031-04-01', '2031-04-02', '2031-04-03']) {
      await today.execute({ userId, timeZone: 'UTC', now: new Date(`${day}T08:00:00Z`) });
    }
    const res = await request(server).get('/v1/days?month=2031-04&tz=UTC').set(auth()).expect(200);
    expect(res.body.data.days.map((cell: { day: string }) => cell.day)).toEqual([
      '2031-04-01',
      '2031-04-02',
      '2031-04-03',
    ]);
  });

  it('round-trips the rhythm, with the time as HH:MM', async () => {
    await request(server)
      .put('/v1/me/rhythm')
      .set(auth())
      .send({ mode: 'evening', time: '21:15', tz: 'Asia/Tokyo' })
      .expect(200);
    const res = await request(server).get('/v1/me/rhythm').set(auth()).expect(200);
    expect(res.body.data).toMatchObject({
      mode: 'evening',
      notifyAt: '21:15',
      timezone: 'Asia/Tokyo',
    });
  });

  it('clears the guest flag when claimed, on the same row', async () => {
    const res = await request(server)
      .post('/v1/auth/claim')
      .set(auth())
      .send({ email: `pg_daily_${stamp}@firo.app`, password: 'sup3r-secret-pw' })
      .expect(200);
    expect(res.body.data.user.id).toBe(userId);

    const row = await db.queryOne<{ is_guest: boolean; email: string; picks: string }>(
      `SELECT u.is_guest, u.email::text AS email,
              (SELECT count(*) FROM personalization.daily_picks p WHERE p.user_id = u.id)::text AS picks
       FROM identity.users u WHERE u.id = $1`,
      [userId],
    );
    expect(row?.is_guest).toBe(false);
    expect(row?.email).toBe(`pg_daily_${stamp}@firo.app`);
    // Nothing was migrated because nothing had to move.
    expect(Number(row?.picks)).toBeGreaterThanOrEqual(5);
  });
});

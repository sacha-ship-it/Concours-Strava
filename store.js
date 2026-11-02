'use strict';

const { DatabaseSync } = require('node:sqlite');

const SPORTS = {
  run: '🏃 Course à pied',
  bike: '🚴 Vélo sans assistance',
  swim: '🏊 Natation',
  strength: '🏋️ Musculation',
  football: '⚽ Football'
};

function date(value) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(
      Date.parse(value + 'T12:00:00Z')
    ) ||
    new Date(value + 'T12:00:00Z')
      .toISOString()
      .slice(0, 10) !== value
  ) {
    throw Error(
      'Date attendue : AAAA-MM-JJ.'
    );
  }

  return value;
}

function activityId(link) {
  let url;

  try {
    url = new URL(link);
  } catch {
    throw Error('Lien Strava invalide.');
  }

  const match = url.pathname.match(
    /^\/activities\/(\d+)\/?$/
  );

  if (
    url.protocol !== 'https:' ||
    !['strava.com', 'www.strava.com'].includes(
      url.hostname
    ) ||
    !match
  ) {
    throw Error(
      'Utilise le lien complet ' +
      'https://www.strava.com/activities/123456789 ' +
      'et non un lien raccourci.'
    );
  }

  return match[1];
}

function openStore(file) {
  const db = new DatabaseSync(file);

  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;

    CREATE TABLE IF NOT EXISTS contests (
      id TEXT PRIMARY KEY,
      config TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      contest TEXT NOT NULL REFERENCES contests(id),
      user TEXT NOT NULL,
      sport TEXT NOT NULL,
      day TEXT NOT NULL,
      quantity REAL NOT NULL,
      activity TEXT NOT NULL,
      hash TEXT NOT NULL,
      proof TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      points REAL NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      reviewer TEXT,
      reason TEXT,
      staff_message TEXT,
      ticket TEXT,
      UNIQUE(contest, activity),
      UNIQUE(contest, hash)
    );

    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY,
      entry TEXT,
      actor TEXT,
      action TEXT,
      reason TEXT,
      at INTEGER
    );
  `);

  function get(id) {
    return db.prepare(
      'SELECT * FROM entries WHERE id=?'
    ).get(id);
  }

  function contest(id) {
    const row = db.prepare(
      'SELECT config FROM contests WHERE id=?'
    ).get(id);

    return row
      ? JSON.parse(row.config)
      : null;
  }

  function save(c) {
    db.prepare(`
      INSERT INTO contests VALUES(?,?)
      ON CONFLICT(id)
      DO UPDATE SET config=excluded.config
    `).run(
      c.id,
      JSON.stringify(c)
    );
  }

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');

    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function score(c, e) {
    return e.quantity * (
      e.sport === 'strength'
        ? c.rates.strength
        : c.rates[e.sport]
    );
  }

  function recalc(c, user, day) {
    const entries = db.prepare(`
      SELECT * FROM entries
      WHERE contest=?
        AND user=?
        AND day=?
        AND status='approved'
      ORDER BY created, id
    `).all(
      c.id,
      user,
      day
    );

    let remaining = c.strengthCap;

    for (const e of entries) {
      const raw = score(c, e);

      const points = e.sport === 'strength'
        ? Math.max(0, Math.min(raw, remaining))
        : raw;

      if (e.sport === 'strength') {
        remaining -= points;
      }

      db.prepare(
        'UPDATE entries SET points=? WHERE id=?'
      ).run(
        Math.round(points * 100) / 100,
        e.id
      );
    }
  }

  function review(
    id,
    actor,
    status,
    reason = ''
  ) {
    return transaction(() => {
      const e = get(id);

      if (!e) {
        throw Error('Activité introuvable.');
      }

      const c = contest(e.contest);

      if (c.final) {
        throw Error(
          'Concours finalisé : les résultats sont figés.'
        );
      }

      if (status === 'revoked') {
        if (e.status !== 'approved') {
          throw Error(
            'Cette activité n’est pas validée.'
          );
        }
      } else if (
        e.status !== 'pending'
      ) {
        throw Error(
          'Cette demande a déjà été traitée.'
        );
      }

      if (![
        'approved',
        'rejected',
        'revoked'
      ].includes(status)) {
        throw Error('Statut invalide.');
      }

      db.prepare(`
        UPDATE entries
        SET status=?,
            points=0,
            reviewer=?,
            reason=?
        WHERE id=?
      `).run(
        status,
        actor,
        reason,
        id
      );

      recalc(c, e.user, e.day);

      db.prepare(`
        INSERT INTO audit(
          entry,
          actor,
          action,
          reason,
          at
        ) VALUES(?,?,?,?,?)
      `).run(
        id,
        actor,
        status,
        reason,
        Date.now()
      );

      return get(id);
    });
  }

  function add(e) {
    const c = contest(e.contest);

    if (
      !c ||
      c.final ||
      c.paused ||
      Date.now() < c.opens ||
      Date.now() > c.deadline
    ) {
      throw Error(
        'Les dépôts ne sont pas ouverts.'
      );
    }

    date(e.day);

    if (
      e.day < c.start ||
      e.day > c.end
    ) {
      throw Error(
        'Activité hors période du concours.'
      );
    }

    const today = new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    ).format(new Date());

    if (e.day > today) {
      throw Error(
        'La date de l’activité est dans le futur.'
      );
    }

    if (
      !SPORTS[e.sport] ||
      !Number.isFinite(e.quantity) ||
      e.quantity <= 0 ||
      e.quantity > (
        e.sport === 'strength'
          ? 1440
          : 10000
      )
    ) {
      throw Error(
        'Distance ou durée invalide.'
      );
    }

    db.prepare(`
      INSERT INTO entries(
        id,
        contest,
        user,
        sport,
        day,
        quantity,
        activity,
        hash,
        proof,
        created
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      e.id,
      e.contest,
      e.user,
      e.sport,
      e.day,
      e.quantity,
      e.activity,
      e.hash,
      e.proof,
      e.created
    );

    return get(e.id);
  }

  function ranking(id) {
    const list = db.prepare(`
      SELECT
        user,
        ROUND(SUM(points), 2) AS points,
        COUNT(*) AS activities
      FROM entries
      WHERE contest=?
        AND status='approved'
      GROUP BY user
      ORDER BY points DESC, user
    `).all(id);

    return list.map(e => ({
      ...e,
      rank: list.findIndex(
        x => x.points === e.points
      ) + 1
    }));
  }

  function active() {
    const row = db.prepare(
      "SELECT value FROM meta WHERE key='active'"
    ).get();

    return row
      ? contest(row.value)
      : null;
  }

  function activate(id) {
    db.prepare(`
      INSERT INTO meta VALUES('active',?)
      ON CONFLICT(key)
      DO UPDATE SET value=excluded.value
    `).run(id);
  }

  return {
    db,
    get,
    contest,
    save,
    review,
    add,
    ranking,
    transaction,
    score,
    active,
    activate
  };
}

module.exports = {
  openStore,
  SPORTS,
  date,
  activityId
};

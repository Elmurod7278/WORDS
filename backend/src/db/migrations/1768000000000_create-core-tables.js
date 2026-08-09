exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('users', {
    id: 'id',
    telegram_id: { type: 'bigint', notNull: true, unique: true },
    username: { type: 'text' },
    first_name: { type: 'text' },
    last_name: { type: 'text' },
    language_code: { type: 'text' },
    first_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('sessions', {
    id: 'id',
    user_id: {
      type: 'bigint',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_active_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('events', {
    id: 'id',
    session_id: {
      type: 'bigint',
      notNull: true,
      references: 'sessions',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'bigint',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    type: { type: 'text', notNull: true },
    payload: { type: 'jsonb', notNull: true, default: '{}' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('sessions', 'user_id');
  pgm.createIndex('events', 'user_id');
  pgm.createIndex('events', 'type');
  pgm.createIndex('events', 'occurred_at');
};

exports.down = (pgm) => {
  pgm.dropTable('events');
  pgm.dropTable('sessions');
  pgm.dropTable('users');
};

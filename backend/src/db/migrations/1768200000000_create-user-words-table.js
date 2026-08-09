exports.up = (pgm) => {
  pgm.createTable('user_words', {
    id: { type: 'text', primaryKey: true },
    user_id: {
      type: 'bigint',
      references: 'users',
      onDelete: 'CASCADE',
      notNull: false,
    },
    session_id: {
      type: 'bigint',
      references: 'sessions',
      onDelete: 'SET NULL',
      notNull: false,
    },
    source_lang: { type: 'text', notNull: true, default: 'en' },
    target_lang: { type: 'text', notNull: true, default: 'uz' },
    source: { type: 'text', notNull: true },
    target: { type: 'text', notNull: true },
    transcription: { type: 'text', notNull: false, default: '' },
    definition: { type: 'text', notNull: false, default: '' },
    example: { type: 'text', notNull: false, default: '' },
    collection: { type: 'text', notNull: false, default: '' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('user_words', 'user_id');
  pgm.createIndex('user_words', ['source_lang', 'target_lang']);
};

exports.down = (pgm) => {
  pgm.dropTable('user_words');
};

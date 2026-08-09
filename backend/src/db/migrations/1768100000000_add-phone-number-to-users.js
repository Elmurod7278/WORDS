exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('users', {
    phone_number: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'phone_number');
};

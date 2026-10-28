const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const fs = require('fs');

async function migratePasswords() {
  const ENV = process.env.NODE_ENV || 'development';

  const dbOptions = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'postgres'
  };

  if (ENV === 'production') {
    const certPath = '/app/certs/db.crt';
    if (fs.existsSync(certPath)) {
      dbOptions.ssl = {
        ca: fs.readFileSync(certPath),
        rejectUnauthorized: true
      };
    }
  }

  const pool = new Pool(dbOptions);

  try {
    const result = await pool.query(
      'SELECT user_id, password_plain FROM users WHERE password_hash IS NULL AND password_plain IS NOT NULL'
    );

    if (result.rows.length === 0) {
      console.log('No hay contraseñas pendientes de migrar a bcrypt.');
      return;
    }

    console.log(`Migrando ${result.rows.length} contraseñas a bcrypt (cost=12)...`);

    for (const user of result.rows) {
      const hash = await bcrypt.hash(user.password_plain, 12);
      await pool.query(
        'UPDATE users SET password_hash = $1, password_plain = NULL WHERE user_id = $2',
        [hash, user.user_id]
      );
      console.log(`  Migrado: ${user.user_id}`);
    }

    console.log('Migración de contraseñas completada.');
  } catch (err) {
    console.error('Error en migración de contraseñas:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migratePasswords();

require('dotenv').config({ path: '.env' });
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
async function run() {
  try {
    await sql`ALTER TABLE reports ALTER COLUMN waste_type TYPE text`;
    await sql`ALTER TABLE reports ALTER COLUMN amount TYPE text`;
    console.log("Done altering columns!");
  } catch (e) {
    console.error(e);
  }
}
run();

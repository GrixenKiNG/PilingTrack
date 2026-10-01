// Shared snapshot representation for a synthetic dump and its restored copy.
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function capture(query) {
  const tables = await query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const counts = {};
  const countRows = await query(tables.map(({ tablename }) => `SELECT '${tablename.replaceAll("'", "''")}' AS tablename, count(*)::text AS count FROM public.${quote(tablename)}`).join(' UNION ALL '));
  for (const row of countRows) counts[row.tablename] = row.count;
  const migrations = await query(`SELECT migration_name, checksum, applied_steps_count,
    to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS finished_at,
    to_char(rolled_back_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS rolled_back_at
    FROM "_prisma_migrations" ORDER BY migration_name, id`);
  const rls = await query("SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname");
  const policies = await query("SELECT tablename, policyname, permissive, array_to_json(roles) AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname");
  return { counts, migrations, rls, policies };
}
module.exports = { capture };

// Browser sessions use Supabase RLS. Service API keys additionally use these
// explicit owner predicates because the service role bypasses RLS.
export function database(client, owner) {
  function visible(query, table) {
    if (table === 'ev_jobs') return query.or(`owner.eq.${owner},and(visibility.eq.public,status.eq.open)`);
    if (table === 'ev_api_keys') return query.eq('owner', owner);
    if (table === 'ev_reviews') return query.or(`reviewer.eq.${owner},taskOwner.eq.${owner}`);
    throw new Error('Unknown evidence table');
  }
  async function read(query) {
    const { data, error, count } = await query;
    if (error) throw Object.assign(new Error(error.code === '42P01' || error.code === 'PGRST205' ? 'Evidence database migration is not installed' : 'Evidence database operation failed'), { status: error.code === '23505' ? 409 : 503 });
    return { data, count };
  }
  const db = { filter: (_, values) => values.id, collection(table) {
    return {
      async getOne(id) {
        const { data } = await read(visible(client.from(table).select(table === 'ev_api_keys' ? 'id,owner,name,scopes,expiresAt,revoked,created' : '*').eq('id', id), table).maybeSingle());
        if (!data) throw Object.assign(new Error('Record not found'), { status: 404 });
        return data;
      },
      async getList(page, limit, options = {}) {
        let query = visible(client.from(table).select(table === 'ev_api_keys' ? 'id,name,scopes,expiresAt,revoked,created' : '*', { count: 'exact' }), table);
        if (options.filter) query = query.eq('job', options.filter);
        for (const col of (options.sort || 'created').split(',')) query = query.order(col.replace(/^-/, ''), { ascending: !col.startsWith('-') });
        const { data, count } = await read(query.range((page - 1) * limit, page * limit - 1));
        return { items: data, totalItems: count };
      },
      async create(input) {
        const data = { ...input };
        if (table === 'ev_jobs' || table === 'ev_api_keys') data.owner = owner;
        if (table === 'ev_reviews') {
          const job = await db.collection('ev_jobs').getOne(data.job);
          if (job.owner === owner || job.status !== 'open' || job.visibility !== 'public') throw Object.assign(new Error('Task is not available for independent review'), { status: 403 });
          data.reviewer = owner; data.taskOwner = job.owner;
        }
        return (await read(client.from(table).insert(data).select('*').single())).data;
      },
      async update(id, input) {
        if (table !== 'ev_api_keys' || input.revoked !== true) throw Object.assign(new Error('Update not permitted'), { status: 403 });
        return (await read(client.from(table).update({ revoked: true }).eq('id', id).eq('owner', owner).select('id').single())).data;
      }
    };
  } };
  return db;
}

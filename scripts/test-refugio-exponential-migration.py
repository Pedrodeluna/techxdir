"""Verify the event data migration against disposable PostgreSQL only."""
from pathlib import Path
import json
import os
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
migration = repo / 'supabase/migrations/20261019180000_refugio_exponential_events.sql'
base = (repo / 'supabase/migrations/20260923120000_init.sql').read_text().split('-- One row per signed-in person.')[0]
ingest = (repo / 'supabase/migrations/20261013120000_auto_ingest.sql').read_text()
event_schema = ingest[ingest.index('alter table public.events'):ingest.index('-- Drafts, canceled')]
expected = {
    'refugio-madrid-20260627': ('Madrid', '2026-06-27', None),
    'exponential-6lzs6hsy': ('Santiago de Compostela', '2026-10-15', 'evt-UsGfBM32Set5gkK'),
    'exponential-pz3otdck': ('Madrid', '2026-09-28', 'evt-4527lcK0BrThynS'),
    'exponential-bq85iasm': ('Madrid', '2026-09-22', 'evt-6cqLOfoWYPAPOfv'),
}
with tempfile.TemporaryDirectory(prefix='techxdir-event-migration-') as directory:
    root = Path(directory)
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    def run(args, **kwargs):
        return subprocess.run(args, env=env, text=True, capture_output=True, **kwargs)
    run(['initdb', '-D', str(root / 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True)
    run(['pg_ctl', '-D', str(root / 'data'), '-l', str(root / 'log'), '-o', f"-k {root} -p 55441 -c listen_addresses=''", '-w', 'start'], check=True)
    try:
        args = ['psql', '-X', '-h', str(root), '-p', '55441', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']
        def sql(query):
            return run(args, input=query, check=True).stdout.strip()
        def load(check=True, transactional=False):
            # Default to autocommit: do not supply the transaction the deployment lacked.
            flags = ['--single-transaction'] if transactional else []
            result = run(args + flags + ['-f', str(migration)])
            if check:
                assert result.returncode == 0, result.stderr
            return result
        def snapshot():
            return json.loads(sql("select jsonb_build_object('orgs',(select coalesce(jsonb_agg(o order by id),'[]') from orgs o),'events',(select coalesce(jsonb_agg(e order by id),'[]') from events e));"))
        sql(base + 'create table public.event_sources(id uuid primary key);' + event_schema)
        sql("""insert into orgs(id,name) values('unrelated','Existing organization');
            insert into events(id,org_id,name,short,city,starts_on,kind)
            values('unrelated','unrelated','Existing event','Existing','Bilbao','2026-12-01','Custom');""")
        before = snapshot()
        load()
        after = snapshot()
        assert len(after['events']) == 5 and len(after['orgs']) == 4
        for table in before:
            current = {r['id']: r for r in after[table]}
            assert all(current[r['id']] == r for r in before[table]), 'Existing records changed'
        for row in after['events']:
            if row['id'] not in expected:
                continue
            city, date, external = expected[row['id']]
            assert (row['city'], row['starts_on'], row['external_id'], row['status']) == (city, date, external, 'published')
            assert row['starts_at'] is not None and row['url'].startswith('https://')
        assert sql("select starts_at = '2026-09-22T19:30:00+02:00'::timestamptz and ends_at = '2026-09-22T21:30:00+02:00'::timestamptz from events where id='exponential-bq85iasm'") == 't'
        load()
        assert snapshot() == after, 'Repetition must be a no-op'
        load(transactional=True)
        assert snapshot() == after, 'An outer transaction must also remain supported'
        sql("update events set name='Manually edited',city='Bilbao',starts_on='2027-01-01' where id='refugio-madrid-20260627'; update orgs set name='Custom name' where id='refugio';")
        edited = snapshot()
        load()
        assert snapshot() == edited, 'Existing IDs must preserve manual edits'
        sql("""update events set id='manual-expresso',name='Custom talk' where id='exponential-6lzs6hsy';
            update events set id='manual-derbaix',name='Custom title',external_kind=null,external_id=null,url='https://lu.ma/pz3otdck/' where id='exponential-pz3otdck';""")
        alternate = snapshot()
        load()
        assert snapshot() == alternate, 'External identity and URL aliases must prevent duplicates'
        sql("truncate events,orgs; insert into orgs(id,name) values('manual-refugio',' REFUGIO ');")
        load()
        assert sql("select org_id from events where id='refugio-madrid-20260627'") == 'manual-refugio'
        sql("truncate events,orgs; insert into orgs(id,name) values('one','REFUGIO'),('two','refugio');")
        ambiguous = snapshot()
        result = load(check=False)
        assert result.returncode != 0 and 'Ambiguous organization' in result.stderr
        assert snapshot() == ambiguous, 'Rejected ambiguous import must leave all data unchanged'
        # Reject after organizations were inserted: the entire import must roll back.
        sql('truncate events,orgs;')
        sql("""create function reject_catalog_event() returns trigger language plpgsql as $$
            begin raise exception 'Forced event insert failure'; end; $$;
            create trigger reject_catalog_event before insert on events
            for each row execute function reject_catalog_event();""")
        before_failure = snapshot()
        result = load(check=False)
        assert result.returncode != 0 and 'Forced event insert failure' in result.stderr
        assert snapshot() == before_failure, 'A late failure must also roll back organization inserts'
        print('PASS: autocommit and outer transaction, late-failure rollback')
        print('PASS: four verified events, existing data, times, repeat, manual edits, alternate IDs/URLs, org reuse and atomic rejection')
    finally:
        run(['pg_ctl', '-D', str(root / 'data'), '-m', 'fast', '-w', 'stop'], check=True)

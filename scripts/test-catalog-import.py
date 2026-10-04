"""Exercise the production import on disposable PostgreSQL, never on Supabase."""
from pathlib import Path
import os
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
import_file = repo / 'supabase/imports/20261004_public_events.sql'
schema = (repo / 'supabase/migrations/20260923120000_init.sql').read_text().split('-- One row per signed-in person.')[0]
with tempfile.TemporaryDirectory(prefix='techxdir-import-test-') as directory:
    root = Path(directory)
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    def run(args, **kwargs):
        return subprocess.run(args, env=env, text=True, capture_output=True, **kwargs)
    run(['initdb', '-D', str(root / 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True)
    run(['pg_ctl', '-D', str(root / 'data'), '-l', str(root / 'log'), '-o', f"-k {root} -p 55440 -c listen_addresses=''", '-w', 'start'], check=True)
    try:
        args = ['psql', '-X', '-h', str(root), '-p', '55440', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq']
        def sql(query):
            return run(args, input=query, check=True).stdout.strip()
        def load(path=import_file, check=True):
            return run(args + ['-f', str(path)], check=check)
        def snapshot():
            return sql("select jsonb_build_object('orgs',(select jsonb_agg(o order by id) from orgs o),'events',(select jsonb_agg(e order by id) from events e));")

        sql(schema)
        load()
        assert sql('select (select count(*) from orgs), (select count(*) from events)') == '7|7'
        original = snapshot()
        load()
        assert snapshot() == original, 'A repeated import must be a no-op'

        # Imported records remain ordinary editable rows; new manual IDs coexist.
        sql("""
          update events set name='Edited by admin',city='Bilbao',starts_on='2026-09-19' where id='hackspain-26';
          update orgs set name='Edited organizer' where id='hackspain';
          insert into orgs (id,name) values ('manual-org','Manual organization');
          insert into events (id,org_id,name,short,city,starts_on,kind)
            values ('manual-event','manual-org','Manual event','Manual','Madrid','2027-01-01','Meetup');
        """)
        edited = snapshot()
        load()
        load(repo / 'supabase/seed.sql')
        assert snapshot() == edited, 'Manual edits and new rows must survive import and seed'
        duplicate = run(args, input="insert into orgs(id,name) values ('hackspain','Duplicate');")
        assert duplicate.returncode != 0 and snapshot() == edited, 'Duplicate IDs must not overwrite'

        # The same organization/event may have been entered manually with another ID.
        sql("""
          truncate events,orgs;
          insert into orgs (id,name) values ('manual-hackspain',' HACKSPAIN ');
          insert into events (id,org_id,name,short,city,starts_on,ends_on,kind)
            values ('manual-hackspain-2026','manual-hackspain',' HackSpain 2026 ','Custom',' MADRID ','2026-09-18','2026-09-20','Custom');
        """)
        load()
        assert sql('select (select count(*) from orgs), (select count(*) from events)') == '7|7'
        assert sql("select short from events where id='manual-hackspain-2026'") == 'Custom'
        assert sql("select count(*) from events where id='hackspain-26'") == '0'

        sql("truncate events,orgs; insert into orgs (id,name) values ('manual-one','HackSpain'),('manual-two','hackspain');")
        ambiguous = snapshot()
        assert load(check=False).returncode != 0
        assert snapshot() == ambiguous, 'Ambiguous matches must roll back the whole import'
        print('PASS: initial import, repeat, manual edits, new manual rows, duplicate IDs, alternate IDs, atomic rollback.')
    finally:
        run(['pg_ctl', '-D', str(root / 'data'), '-m', 'fast', '-w', 'stop'], check=True)

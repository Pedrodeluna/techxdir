"""Exercise the production import on disposable PostgreSQL, never on Supabase."""
from pathlib import Path
import json
import os
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
import_file = repo / 'supabase/imports/20261004_public_events.sql'
kernel_file = repo / 'supabase/imports/20261005_kernel_panic.sql'
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
        load(kernel_file)
        assert sql('select (select count(*) from orgs), (select count(*) from events)') == '7|8'
        original = snapshot()
        load()
        load(kernel_file)
        assert snapshot() == original, 'A repeated import must be a no-op'

        # Imported records remain ordinary editable rows; new manual IDs coexist.
        sql("""
          update events set name='Edited by admin',city='Bilbao',starts_on='2026-09-19' where id='hackspain-26';
          update orgs set name='Edited organizer' where id='hackspain';
          update events set name='Kernel manually edited',city='Barcelona' where id='kernel-panic-madrid-20261006';
          insert into orgs (id,name) values ('manual-org','Manual organization');
          insert into events (id,org_id,name,short,city,starts_on,kind)
            values ('manual-event','manual-org','Manual event','Manual','Madrid','2027-01-01','Meetup');
        """)
        edited = snapshot()
        load()
        load(kernel_file)
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
        load(kernel_file)
        assert sql('select (select count(*) from orgs), (select count(*) from events)') == '7|8'
        assert sql("select short from events where id='manual-hackspain-2026'") == 'Custom'
        assert sql("select count(*) from events where id='hackspain-26'") == '0'

        sql("update events set id='manual-kernel-panic',name='Edited Kernel title' where id='kernel-panic-madrid-20261006';")
        manual_kernel = snapshot()
        load(kernel_file)
        assert snapshot() == manual_kernel, 'An alternate Kernel ID with the same URL must not be duplicated'

        sql("truncate events,orgs; insert into orgs (id,name) values ('manual-one','HackSpain'),('manual-two','hackspain');")
        ambiguous = snapshot()
        assert load(check=False).returncode != 0
        assert snapshot() == ambiguous, 'Ambiguous matches must roll back the whole import'
        autumn_file = repo / 'supabase/imports/20261011_autumn_public_events.sql'
        sql('truncate events,orgs;')
        load()
        load(kernel_file)
        previous = json.loads(snapshot())
        load(autumn_file)
        assert sql('select (select count(*) from orgs), (select count(*) from events)') == '39|41'
        expanded = json.loads(snapshot())
        for table in ['orgs', 'events']:
            current = {row['id']: row for row in expanded[table]}
            assert all(current[row['id']] == row for row in previous[table]), 'Existing catalog rows must survive'
        assert sql("select count(*) from events where id like 'microsoft-agent-a-thon-%'") == '2', 'Shared URLs must preserve separate city editions'
        assert sql("select count(*) from events where url like '%digital.gob.es%' or url like '%tech-all%'") == '0', 'Excluded events must not be imported'
        imported = snapshot()
        load(autumn_file)
        assert snapshot() == imported, 'Repeat autumn import must be a no-op'
        sql("update events set id='manual-devfest-santiago',name='Edited Santiago title',short='Custom' where id='devfest-santiago-26';")
        edited_autumn = snapshot()
        load(autumn_file)
        assert snapshot() == edited_autumn, 'Same date/city/URL under an alternate ID must not duplicate'
        sql("truncate events,orgs; insert into orgs(id,name) values ('manual-gdg',' GDG SANTIAGO DE COMPOSTELA ');")
        load(autumn_file)
        assert sql("select org_id from events where id='devfest-santiago-26'") == 'manual-gdg', 'Reuse an existing organization by normalized name'
        sql("truncate events,orgs; insert into orgs(id,name) values ('gdg-one','GDG Santiago de Compostela'),('gdg-two','gdg santiago de compostela');")
        ambiguous_autumn = snapshot()
        assert load(autumn_file, check=False).returncode != 0
        assert snapshot() == ambiguous_autumn, 'Ambiguous autumn organizations must roll back atomically'
        print('PASS: initial import, repeat, manual edits, new manual rows, duplicate IDs, alternate IDs, atomic rollback.')
        print('PASS: autumn import, 33 events, exclusions, existing rows, shared URLs, repeat, alternate IDs, organization reuse, atomic rollback.')
    finally:
        run(['pg_ctl', '-D', str(root / 'data'), '-m', 'fast', '-w', 'stop'], check=True)

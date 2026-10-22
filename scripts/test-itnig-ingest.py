"""Exercise Itnig persistence in disposable PostgreSQL, never a configured database."""
from pathlib import Path
import json
import os
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
initial = (repo / 'supabase/migrations/20260923120000_init.sql').read_text()
ingest = (repo / 'supabase/migrations/20261013120000_auto_ingest.sql').read_text()
adopt = (repo / 'supabase/migrations/20261016120000_ingest_adopt.sql').read_text()
migration = repo / 'supabase/migrations/20261022160000_itnig_source.sql'
source_id = '00000000-0000-4000-8000-000000000001'

with tempfile.TemporaryDirectory(prefix='techxdir-itnig-') as directory:
    root = Path(directory)
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    def run(args, **kwargs):
        return subprocess.run(args, env=env, text=True, capture_output=True, **kwargs)
    run(['initdb', '-D', str(root / 'data'), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True)
    run(['pg_ctl', '-D', str(root / 'data'), '-l', str(root / 'log'), '-o',
         f"-k {root} -p 55442 -c listen_addresses=''", '-w', 'start'], check=True)
    try:
        args = ['psql', '-X', '-h', str(root), '-p', '55442', '-U', 'postgres', '-d', 'postgres',
                '-v', 'ON_ERROR_STOP=1', '-Atq']
        def sql(query, check=True):
            result = run(args, input=query)
            if check:
                assert result.returncode == 0, result.stderr
                return result.stdout.strip()
            return result
        def invoke(payload, check=True):
            query = "select public.ingest_event($payload$" + json.dumps(payload) + "$payload$::jsonb);"
            return json.loads(sql(query)) if check else sql(query, False)
        def snapshot():
            return sql("select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from events e;")
        def manual(id, url, day='2099-10-28'):
            sql(f"""insert into events(id,org_id,name,short,city,starts_on,url,kind)
                values('{id}','itnig','Manual {id}','Manual','Barcelona','{day}','{url}','Talk');""")
        def payload(**changes):
            return dict(external_kind='itnig', external_id='ev_1@itnig.net', org_id='itnig',
                        source_id=source_id, id_base='itnig-test', name='Building AI',
                        starts_at='2099-10-28T17:00:00Z', ends_at='2099-10-28T20:00:00Z',
                        city='Barcelona', country='ES', url='https://itnig.net/events/ev_1/', **changes)
        sql('create schema extensions; create extension pg_trgm with schema extensions;')
        sql(initial.split('-- One row per signed-in person.')[0])
        sql('create table public.profiles(id uuid primary key);')
        sql(ingest[ingest.index('create table public.event_sources'):ingest.index('-- Proposals')])
        sql(ingest[ingest.index('alter table public.events'):ingest.index('-- Drafts, canceled')])
        sql(adopt)
        sql("insert into orgs(id,name) values('itnig','Itnig'),('other','Other');")
        sql(f"""insert into event_sources(id,org_id,kind,url,external_id)
            values('{source_id}','itnig','meetup_ical','https://meetup.com/itnig','itnig');""")

        def legacy_contract():
            results = []
            for provider in ['luma', 'meetup']:
                sql('delete from events;')
                p = payload()
                p.update(external_kind=provider, external_id='legacy', url='https://example.org/event')
                created = invoke(p)
                repeated = invoke(p)
                sql('delete from events;')
                manual('legacy-manual', 'https://example.org/old')
                adopted = invoke(p)
                results.append([created, repeated, adopted, sql("select id,name,starts_on,url,external_kind from events order by id")])
            sql('delete from events;')
            return results

        baseline = legacy_contract()
        if migration.exists():
            sql(migration.read_text())
        assert legacy_contract() == baseline, 'Existing Luma/Meetup results changed'
        # RED before the migration: the current schema rejects this source kind.
        sql(f"update event_sources set kind='itnig_ical',url='https://itnig.net/events/' where id='{source_id}';")
        created = invoke(payload())
        assert (created['action'], created['status']) == ('created', 'published')
        assert invoke(payload())['action'] == 'unchanged'
        updated = payload()
        updated.update(name='Updated title', starts_at='2099-10-29T17:00:00Z', ends_at=None)
        assert invoke(updated)['action'] == 'updated'
        assert sql("select starts_on from events where id='itnig-test'") == '2099-10-29'
        sql('delete from events;')
        manual('existing', 'https://itnig.net/events/ev_1/?ref=share', '2099-10-20')
        manual('unrelated', 'https://itnig.net/events/other/')
        before_unrelated = sql("select to_jsonb(e) from events e where id='unrelated'")
        result = invoke(payload())
        assert result['id'] == 'existing' and result['adopted'] is True
        assert sql("select starts_on from events where id='existing'") == '2099-10-28'
        assert sql("select to_jsonb(e) from events e where id='unrelated'") == before_unrelated
        assert sql('select count(*) from events') == '2'
        sql('delete from events;')
        manual('unrelated', 'https://itnig.net/events/other/')
        before_unrelated = snapshot()
        result = invoke(payload())
        assert result['action'] == 'created' and result['id'] != 'unrelated'
        assert json.loads(sql("select jsonb_agg(to_jsonb(e)) from events e where id='unrelated'")) == json.loads(before_unrelated)
        sql('delete from events;')
        manual('one', 'https://itnig.net/events/ev_1/')
        manual('two', 'https://www.itnig.net/events/ev_1?ref=duplicate', '2099-10-20')
        before = snapshot()
        rejected = invoke(payload(), check=False)
        assert rejected.returncode != 0 and 'Ambiguous Itnig event URL' in rejected.stderr
        assert snapshot() == before, 'Ambiguous adoption mutated data'
        sql('delete from events;')
        cityless = payload()
        cityless.update(city=None, country=None)
        assert invoke(cityless)['status'] == 'draft'
        canceled = payload()
        canceled.update(canceled=True)
        assert invoke(canceled)['status'] == 'canceled'
        # Foreign organizations cannot take over a provider identity.
        before = snapshot()
        foreign = payload()
        foreign.update(org_id='other')
        assert invoke(foreign)['reason'] == 'other_org'
        assert snapshot() == before
        print('PASS: Itnig source admission, create/update/repeat, publication and cancellation')
        print('PASS: URL adoption across date changes, same-day isolation, ambiguous rejection without mutations')
        print('PASS: unchanged Luma/Meetup results and cross-organization identity guard')
    finally:
        run(['pg_ctl', '-D', str(root / 'data'), '-m', 'fast', '-w', 'stop'], check=True)

create table note_versions (
  id           uuid        default gen_random_uuid() primary key,
  note_id      uuid        references notes(id) on delete cascade not null,
  title        text        not null default '',
  content      text        not null default '',
  content_type text        not null default 'markdown'
                           check (content_type in ('markdown', 'html', 'text')),
  tags         text[]      not null default '{}',
  trigger      text        not null
                           check (trigger in ('daily_backup', 'shrinkage', 'pre_restore')),
  created_at   timestamptz not null default now()
);

create index note_versions_note_id_idx on note_versions(note_id);
create index note_versions_note_trigger_idx on note_versions(note_id, trigger, created_at desc);

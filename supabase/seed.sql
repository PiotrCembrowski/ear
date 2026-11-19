-- =============================================================================
-- SoundMatch seed data: categories and instruments only.
--
-- No reference sounds are seeded. Real instrument samples must be imported by
-- an admin with a license and source (see README → "Importing a sample set").
-- Synthetic dev tones, if ever added here, MUST set is_synthetic = true.
--
-- Idempotent: safe to run more than once.
-- =============================================================================

insert into public.reference_categories (slug, name, description, sort_order) values
  ('piano',            'Piano',            'Acoustic and digital pianos, single notes.',          10),
  ('guitar',           'Guitar',           'Acoustic and electric guitar notes and strums.',      20),
  ('drums',            'Drums',            'Drum kit pieces and percussion hits.',                30),
  ('human-voice',      'Human voice',      'Sung notes, spoken sounds, claps and whistles.',      40),
  ('animals',          'Animals',          'Calls and sounds made by animals.',                   50),
  ('nature',           'Nature',           'Water, wind, rain, thunder and other natural sounds.', 60),
  ('mechanical',       'Mechanical',       'Engines, machines, tools and devices.',               70),
  ('everyday-objects', 'Everyday objects', 'Doors, glasses, keys and other household sounds.',    80)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- Piano: 88 keys, A0 (MIDI 21) to C8 (MIDI 108).
-- Guitar: standard tuning, E2 (MIDI 40) to E6 (MIDI 88) on a 24-fret neck.
insert into public.instruments (slug, name, category_id, midi_min, midi_max, expected_note_count)
select v.slug, v.name, c.id, v.midi_min, v.midi_max, v.expected_note_count
from (values
  ('piano',  'Piano',  'piano',  21::smallint, 108::smallint, 88::smallint),
  ('guitar', 'Guitar', 'guitar', 40::smallint,  88::smallint, 49::smallint)
) as v (slug, name, category_slug, midi_min, midi_max, expected_note_count)
join public.reference_categories c on c.slug = v.category_slug
on conflict (slug) do update
  set name = excluded.name,
      category_id = excluded.category_id,
      midi_min = excluded.midi_min,
      midi_max = excluded.midi_max,
      expected_note_count = excluded.expected_note_count;

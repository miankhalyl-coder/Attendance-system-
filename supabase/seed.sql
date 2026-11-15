-- Seed data (also applied by the migration; safe to re-run).
insert into public.classes (name, sort_order) values
  ('ECCE',1),('Nursery',2),('One',3),('Two',4),('Three',5),('Four',6),('Five',7)
on conflict (name) do nothing;

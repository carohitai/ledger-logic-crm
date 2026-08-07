-- `tds_applicable` turned out to already exist on `clients` as a vestigial
-- TEXT column — null on all 934 rows, never read or written by any code path.
-- Migration 3's `add column if not exists ... boolean` therefore silently did
-- nothing, leaving it inconsistent with the new boolean `pt_applicable` and
-- unusable by the generator's `isTrue` check.
--
-- Converting is safe precisely because the column holds no data. The USING
-- clause still honours the YES/Y/TRUE/1 spellings the sheet would have used,
-- so the cast stays correct even if the column were populated in between.

alter table public.clients
  alter column tds_applicable drop default;

alter table public.clients
  alter column tds_applicable type boolean
  using (upper(coalesce(btrim(tds_applicable), '')) in ('YES', 'Y', 'TRUE', '1', 'APPLICABLE'));

alter table public.clients
  alter column tds_applicable set default false;

update public.clients set tds_applicable = false where tds_applicable is null;

alter table public.clients
  alter column tds_applicable set not null;

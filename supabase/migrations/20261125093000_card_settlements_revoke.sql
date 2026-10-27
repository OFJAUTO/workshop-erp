-- card_settlements is server-only (every screen reads it through the server): no grants to anon or authenticated.
revoke all on public.card_settlements from anon, authenticated;
grant all on public.card_settlements to service_role;
notify pgrst, 'reload schema';

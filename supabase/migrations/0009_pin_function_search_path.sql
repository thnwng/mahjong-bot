-- 0009: pin search_path on every SECURITY DEFINER function.
-- Supabase's linter flags these functions (0011_function_search_path_mutable):
-- a SECURITY DEFINER function with a role-mutable search_path lets a caller
-- prepend a schema and shadow the objects the function resolves. All five only
-- touch public tables + pg_catalog built-ins, so pinning to `public, pg_temp`
-- is behavior-preserving and closes the injection vector. pg_temp is last so a
-- caller's temp objects can never take precedence.
alter function public.add_player(uuid, text)                             set search_path = public, pg_temp;
alter function public.remove_player(uuid, text)                          set search_path = public, pg_temp;
alter function public.rename_player(uuid, bigint, text, text)            set search_path = public, pg_temp;
alter function public.settle_debt(uuid, text, text, numeric, text)       set search_path = public, pg_temp;
alter function public.settle_debt(uuid, text, text, numeric, text, uuid) set search_path = public, pg_temp;

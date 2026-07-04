-- =============================================================
-- Bootstrap da conta da DONA (admin) — roda automaticamente.
-- Aplicado tanto no `supabase db push` (produção) quanto no
-- `supabase db reset` (local). Idempotente: só cria se ainda NÃO
-- existir nenhum admin, então é seguro rodar em todo deploy.
--
-- >>> TROQUE a senha após o primeiro acesso (menu Funcionários). <<<
--   Login inicial:  admin  /  Secret123!
-- =============================================================

do $$
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    perform public.criar_usuario_interno('admin', 'Secret123!', 'Administradora', 'admin');
  end if;
end $$;

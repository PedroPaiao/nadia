-- =============================================================
-- SEED DE PRODUÇÃO — rodar UMA vez no Supabase Cloud (SQL Editor)
-- depois de aplicar as migrations (`supabase db push`).
--
-- Cria SOMENTE a conta da dona (administradora). Sem dados de exemplo.
-- Depois de entrar:
--   1) troque a senha da dona pelo menu Funcionários (ou mantenha esta);
--   2) crie os funcionários (senha rápida sugerida: 123456).
--
-- Login inicial:  admin  /  Secret123!
-- =============================================================

select public.criar_usuario_interno('admin', 'Secret123!', 'Administradora', 'admin');

-- (Opcional) categorias iniciais — descomente se quiser já começar organizado:
-- insert into public.categories (nome, ordem) values
--   ('Salgados Fritos', 1), ('Salgados Assados', 2), ('Doces', 3), ('Bebidas', 4);

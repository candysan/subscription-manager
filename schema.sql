-- ========================================
-- Supabase で実行する SQL
-- ========================================
-- このファイルの内容を Supabase の SQL エディタに貼り付けて実行してください。
-- Supabase ダッシュボード → 左メニュー「SQL Editor」→「New query」
-- ========================================

-- subscriptions テーブルを作成する
CREATE TABLE subscriptions (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid    DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  service_name text    NOT NULL,
  category     text    NOT NULL,
  currency     text    NOT NULL,
  monthly_fee  numeric,
  yearly_fee   numeric,
  renewal_date date,
  status       text    NOT NULL DEFAULT 'active',
  created_at   timestamp with time zone DEFAULT now()
);

-- Row Level Security (RLS) を有効にする
-- これにより「自分のデータしか見えない・触れない」を強制できる
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- ポリシー: ログイン中のユーザーは自分のデータだけ操作できる
CREATE POLICY "自分のデータだけ操作できる"
  ON subscriptions
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

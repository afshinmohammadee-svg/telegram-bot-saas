-- 0005: per-bot Telegram menu appearance preferences.
CREATE TABLE IF NOT EXISTS bot_menu_appearance (
  bot_id uuid PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'luxury_modern' CHECK (theme IN ('luxury_modern','minimal','vibrant')),
  button_columns smallint NOT NULL DEFAULT 1 CHECK (button_columns BETWEEN 1 AND 3),
  emoji_mode text NOT NULL DEFAULT 'subtle' CHECK (emoji_mode IN ('off','subtle','expressive')),
  welcome_title text NOT NULL DEFAULT 'به فضای اختصاصی ما خوش آمدید',
  welcome_text text NOT NULL DEFAULT 'برای مشاهده خدمات و اطلاعات، یکی از گزینه‌های زیر را انتخاب کنید.',
  banner_file_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

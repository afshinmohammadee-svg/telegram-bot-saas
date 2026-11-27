# Telegram webhook worker

این پوشه محل پیاده‌سازی Cloudflare Worker است. Worker باید webhook تلگرام را اعتبارسنجی کند، updateها را به‌صورت idempotent ثبت کند، انقضای اشتراک را پیش از هر پاسخ بررسی کند و پردازش پیام‌ها را از طریق Queue انجام دهد.

هیچ توکن ربات یا کلید رمزنگاری نباید در کد یا مخزن قرار بگیرد. این مقادیر فقط از secret bindings محیط Worker خوانده می‌شوند.

وضعیت فعلی: هنوز Worker deploy یا webhook ثبت نشده است.
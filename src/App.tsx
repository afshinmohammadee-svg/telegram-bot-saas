import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Bot, CalendarClock, ChevronDown, CircleHelp, Command, LayoutDashboard,
  MessageCircle, Moon, MoreHorizontal, Plus, Search, Send, Settings, ShieldCheck,
  Sun, Users, Zap, RefreshCw, Trash2, Power, X, LoaderCircle, UserCog, ListChecks, RadioTower
} from 'lucide-react'

type BotInfo = { id: string; username: string | null; display_name: string | null; status: string; last_error?: string | null; connected_at?: string | null }
type WebhookStatus = { bot: { id: string; username: string | null; status: string }; webhook: { configured: boolean; host: string | null; path: string | null; pending_update_count: number; last_error_date: number | null; last_error_message: string | null; allowed_updates: string[] | null } }
type Dashboard = { bot: BotInfo | null; visitors: number; openConversations: number; unreadMessages: number; activeAutoReplies: number; subscription: { active: boolean; expiresAt: string | null } }
type Conversation = { id: string; status: string; unread_count: number; last_message_at: string | null; username: string | null; first_name: string | null; last_name: string | null; telegram_user_id: string; last_message: string | null }
type Message = { id: string; direction: string; sender_type: string; text_body: string | null; delivery_status: string; created_at: string }
type Visitor = { id: string; telegram_user_id: string; username: string | null; first_name: string | null; last_name: string | null; language_code: string | null; first_seen_at: string; last_seen_at: string; conversations: number }
type Rule = { id: string; trigger_text: string; reply_text: string; match_type: string; is_enabled: boolean; created_at: string }
type AdminUser = { id: string; name: string; email: string; role: string; expires_at: string | null; subscription_active: boolean }
type LicensePlan = { id: string; code: string; name: string; description: string | null; duration_days: number; max_bots: number; max_menus: number; max_visitors: number | null; features: Record<string, boolean>; is_active: boolean; issued_count: number }
type LicenseItem = { id: string; user_id: string; plan_id: string; status: string; starts_at: string; expires_at: string; user_name: string | null; user_email: string | null; plan_name: string; plan_code: string }
type MenuAppearance = { theme: 'luxury_modern' | 'minimal' | 'vibrant'; button_columns: number; emoji_mode: 'off' | 'subtle' | 'expressive'; welcome_title: string; welcome_text: string; banner_file_id: string; visitor_messages_enabled: boolean }
type BotMenu = { id: string; title: string; description: string | null; parent_id: string | null; response_type: 'text' | 'photo' | 'document' | 'url' | 'submenu'; response_content: string | null; target_url: string | null; sort_order: number; is_active: boolean }
type Page = 'نمای کلی' | 'گفتگوها' | 'بازدیدکنندگان' | 'پاسخ‌های خودکار' | 'مدیریت ربات' | 'مدیریت کاربران' | 'مدیریت پلن‌ها' | 'مدیریت لایسنس' | 'ربات مرکزی' | 'منوساز' | 'اشتراک و اعتبار' | 'تنظیمات'
type NavItem = { label: Page; icon: typeof LayoutDashboard }
const nav: NavItem[] = [
  { label: 'نمای کلی', icon: LayoutDashboard }, { label: 'گفتگوها', icon: MessageCircle },
  { label: 'بازدیدکنندگان', icon: Users }, { label: 'پاسخ‌های خودکار', icon: Zap },
]
const tools: NavItem[] = [
  { label: 'مدیریت ربات', icon: Bot }, { label: 'منوساز', icon: Bot }, { label: 'مدیریت کاربران', icon: UserCog }, { label: 'مدیریت لایسنس', icon: ShieldCheck }, { label: 'اشتراک و اعتبار', icon: CalendarClock },
  { label: 'تنظیمات', icon: Settings },
]
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'درخواست انجام نشد.')
  return data as T
}
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—'
function jalaliToGregorian(input: string): string | null {
  const match = input.trim().match(/^(\d{4})[\\/-](\d{1,2})[\\/-](\d{1,2})$/)
  if (!match) return null
  const jy=Number(match[1]), jm=Number(match[2]), jd=Number(match[3])
  if (jy<1300 || jm<1 || jm>12 || jd<1 || jd>31) return null
  const jy2=jy-(jy>=0?979:0), days=365*jy2+Math.floor(jy2/33)*8+Math.floor(((jy2%33)+3)/4)+78+jd+(jm<7?(jm-1)*31:(jm-7)*30+186)
  let gy=400*Math.floor(days/146097); let rem=days%146097
  if(rem>36524){gy+=100*Math.floor(--rem/36524);rem%=36524;if(rem>=365)rem++}
  gy+=4*Math.floor(rem/1461);rem%=1461
  if(rem>365){gy+=Math.floor((rem-1)/365);rem=(rem-1)%365}
  let gd=rem+1
  const leap=(gy%4===0&&gy%100!==0)||gy%400===0
  const monthDays=[0,31,leap?29:28,31,30,31,30,31,31,30,31,30,31]
  let gm=1;while(gm<=12&&gd>monthDays[gm]){gd-=monthDays[gm];gm++}
  const out=`${String(gy).padStart(4,'0')}-${String(gm).padStart(2,'0')}-${String(gd).padStart(2,'0')}`
  const check=new Date(out+'T12:00:00Z')
  if(!Number.isFinite(check.getTime()) || check.toISOString().slice(0,10)!==out) return null
  const shown=new Intl.DateTimeFormat('en-u-ca-persian',{year:'numeric',month:'numeric',day:'numeric',timeZone:'UTC'}).format(check)
  const parts=shown.match(/(\d+)/g)?.map(Number)
  return parts && parts[0]===jy && parts[1]===jm && parts[2]===jd ? out : null
}
const gregorianToJalali = (value?: string | null) => value ? new Intl.DateTimeFormat('en-u-ca-persian',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'}).format(new Date(value)).replace(/\u200e/g,'') : ''
const fullName = (item: { first_name?: string | null; last_name?: string | null; username?: string | null }) => [item.first_name, item.last_name].filter(Boolean).join(' ') || (item.username ? '@' + item.username : 'کاربر تلگرام')

export default function App({ isSuperAdmin = false, onCreateUser }: { isSuperAdmin?: boolean; onCreateUser?: () => void }) {
  const [dark, setDark] = useState(true)
  const [active, setActive] = useState<Page>(isSuperAdmin ? 'مدیریت کاربران' : 'نمای کلی')
  const [mobileNav, setMobileNav] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [bot, setBot] = useState<BotInfo | null>(null)
  const [centralBot, setCentralBot] = useState<{configured:boolean;bot?:{id:number;username:string|null;firstName:string|null};webhookConfigured:boolean;pendingUpdates:number;appUrlConfigured:boolean}|null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [token, setToken] = useState('')
  const [qrImageUrl, setQrImageUrl] = useState('')
  const [qrDeepLink, setQrDeepLink] = useState('')
  const [qrBusy, setQrBusy] = useState(false)
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(null)
  const [webhookStatusBusy, setWebhookStatusBusy] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState('')
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [trigger, setTrigger] = useState('')
  const [replyText, setReplyText] = useState('')
  const [matchType, setMatchType] = useState('contains')
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [adminExpiry, setAdminExpiry] = useState<Record<string, string>>({})
  const [licensePlans, setLicensePlans] = useState<LicensePlan[]>([])
  const [licenseItems, setLicenseItems] = useState<LicenseItem[]>([])
  const [planDraft, setPlanDraft] = useState({ code: '', name: '', description: '', durationDays: '30', maxBots: '1', maxMenus: '20', maxVisitors: '', features: { conversations: true, autoReplies: true, menuBuilder: true } })
  const [licenseDraft, setLicenseDraft] = useState({ userId: '', planId: '', notes: '' })
  const [menus, setMenus] = useState<BotMenu[]>([])
  const [menuAppearance, setMenuAppearance] = useState<MenuAppearance>({ theme:'luxury_modern', button_columns:1, emoji_mode:'subtle', welcome_title:'به فضای اختصاصی ما خوش آمدید', welcome_text:'برای مشاهده خدمات و اطلاعات، یکی از گزینه‌های زیر را انتخاب کنید.', banner_file_id:'', visitor_messages_enabled:true })
  const [menuDraft, setMenuDraft] = useState({ id: '', title: '', description: '', parentId: '', responseType: 'text' as BotMenu['response_type'], responseContent: '', targetUrl: '' })

  const refreshDashboard = useCallback(async () => {
    const [dash, botData] = await Promise.all([api<Dashboard>('/api/dashboard'), api<{ bots: BotInfo[] }>('/api/bots')])
    setDashboard(dash)
    setBot(botData.bots[0] ?? null)
  }, [])

  const refreshPage = useCallback(async () => {
    setError('')
    try {
      if (active === 'نمای کلی' || active === 'مدیریت ربات' || active === 'اشتراک و اعتبار' || active === 'تنظیمات') await refreshDashboard()
      if (active === 'تنظیمات' && !isSuperAdmin) {
        const appearanceData = await api<{ appearance: MenuAppearance }>('/api/bots?resource=menu-appearance')
        setMenuAppearance(appearanceData.appearance)
      }
      if (active === 'ربات مرکزی' && isSuperAdmin) { const status = await api<typeof centralBot>('/api/admin/management-bot'); setCentralBot(status) }
      if (active === 'مدیریت پلن‌ها' && isSuperAdmin) { const data = await api<{plans:LicensePlan[]}>('/api/admin/license-plans'); setLicensePlans(data.plans) }
      if (active === 'گفتگوها') {
        const data = await api<{ conversations: Conversation[] }>('/api/conversations')
        setConversations(data.conversations)
      }
      if (active === 'بازدیدکنندگان') {
        const data = await api<{ visitors: Visitor[] }>('/api/visitors')
        setVisitors(data.visitors)
      }
      if (active === 'پاسخ‌های خودکار') {
        const data = await api<{ rules: Rule[] }>('/api/auto-replies')
        setRules(data.rules)
      }
      if (active === 'منوساز') {
        const [data, appearanceData] = await Promise.all([
          api<{ menus: BotMenu[] }>('/api/bot-menus'),
          api<{ appearance: MenuAppearance }>('/api/bots?resource=menu-appearance'),
        ])
        setMenus(data.menus)
        setMenuAppearance(appearanceData.appearance)
      }
      if (active === 'مدیریت کاربران' && isSuperAdmin) {
        const data = await api<{ users: AdminUser[] }>('/api/admin/users')
        setAdminUsers(data.users)
        setAdminExpiry(current => {
          const next = { ...current }
          for (const user of data.users) if (user.expires_at && !next[user.id]) next[user.id] = gregorianToJalali(user.expires_at)
          return next
        })
      }
      if (active === 'مدیریت لایسنس' && isSuperAdmin) {
        const [plansData, licensesData, usersData] = await Promise.all([
          api<{ plans: LicensePlan[] }>('/api/admin/license-plans'),
          api<{ licenses: LicenseItem[] }>('/api/admin/licenses'),
          api<{ users: AdminUser[] }>('/api/admin/users'),
        ])
        setLicensePlans(plansData.plans)
        setLicenseItems(licensesData.licenses)
        const customers = usersData.users.filter(user => user.role !== 'super_admin')
        setAdminUsers(customers)
        setLicenseDraft(current => ({
          ...current,
          userId: current.userId || customers[0]?.id || '',
          planId: current.planId || plansData.plans.find(plan => plan.is_active)?.id || '',
        }))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطا در دریافت اطلاعات')
    }
  }, [active, refreshDashboard, isSuperAdmin])

  useEffect(() => {
    if (!isSuperAdmin) return
    const refreshUsers = async () => {
      try {
        const data = await api<{ users: AdminUser[] }>('/api/admin/users')
        setAdminUsers(data.users)
        setAdminExpiry(current => {
          const next = { ...current }
          for (const user of data.users) if (user.expires_at && !next[user.id]) next[user.id] = gregorianToJalali(user.expires_at)
          return next
        })
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'به‌روزرسانی فهرست کاربران ناموفق بود.') }
    }
    window.addEventListener('admin-users-refresh', refreshUsers)
    return () => window.removeEventListener('admin-users-refresh', refreshUsers)
  }, [isSuperAdmin])

  useEffect(() => {
    let alive = true
    setLoading(true)
    refreshPage().finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [refreshPage])

  useEffect(() => {
    if (!selectedConversation) { setMessages([]); return }
    let alive = true
    api<{ messages: Message[] }>(`/api/conversations/${selectedConversation}/messages`)
      .then(data => { if (alive) setMessages(data.messages) })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'خطا در دریافت پیام‌ها') })
    return () => { alive = false }
  }, [selectedConversation])

  async function connectBot(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api<{ bot: BotInfo }>('/api/bots', { method: 'POST', body: JSON.stringify({ token }) })
      setBot(result.bot); setToken(''); setShowConnect(false)
      setNotice(`ربات @${result.bot.username || result.bot.display_name || 'شما'} با موفقیت متصل شد.`)
      await refreshDashboard()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'اتصال ربات ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function createBotQr() {
    if (!bot) return
    setQrBusy(true); setError(''); setNotice('')
    try {
      const result = await api<{ deepLink: string; qrImageUrl: string }>('/api/bots?resource=start-link', {
        method: 'POST',
        body: JSON.stringify({ botId: bot.id, sourceLabel: 'پنل مدیریت' }),
      })
      setQrDeepLink(result.deepLink)
      setQrImageUrl(result.qrImageUrl)
      setNotice('لینک و QR اختصاصی ربات ساخته شد.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ساخت QR ناموفق بود.') }
    finally { setQrBusy(false) }
  }

  async function reconnectBot() {
    if (!bot || !window.confirm('وبهوک ربات از آدرس قدیمی Vercel به Railway Preview منتقل شود؟ این کار فقط وبهوک همین ربات را تغییر می‌دهد؛ اطلاعات و گفتگوها حفظ می‌شوند.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api('/api/bots?resource=webhook-reconnect', { method: 'POST', body: JSON.stringify({ botId: bot.id }) })
      setNotice('وبهوک ربات در نسخه آزمایشی دوباره ثبت شد.')
      await refreshDashboard()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ثبت دوباره وبهوک ناموفق بود.') }
    finally { setBusy(false) }
  }
  async function loadWebhookStatus() {
    if (!bot) return
    setWebhookStatusBusy(true); setError('')
    try {
      const result = await api<WebhookStatus>(`/api/bots?resource=webhook-status&botId=${encodeURIComponent(bot.id)}`)
      setWebhookStatus(result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'دریافت وضعیت وبهوک ناموفق بود.') }
    finally { setWebhookStatusBusy(false) }
  }
  async function disableBot() {
    if (!bot || !window.confirm('ربات غیرفعال شود؟ اطلاعات و گفتگوهای ذخیره‌شده حذف نمی‌شوند.')) return
    setBusy(true); setError('')
    try {
      await api(`/api/bots/${bot.id}`, { method: 'DELETE' })
      setNotice('ربات غیرفعال شد؛ اطلاعات آن حفظ شده است.')
      await refreshDashboard()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'غیرفعال‌سازی ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault()
    if (!selectedConversation || !reply.trim()) return
    setBusy(true); setError('')
    try {
      await api(`/api/conversations/${selectedConversation}/messages`, { method: 'POST', body: JSON.stringify({ text: reply.trim() }) })
      setReply('')
      const data = await api<{ messages: Message[] }>(`/api/conversations/${selectedConversation}/messages`)
      setMessages(data.messages)
      const list = await api<{ conversations: Conversation[] }>('/api/conversations')
      setConversations(list.conversations)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ارسال پیام ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function addRule(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await api('/api/auto-replies', { method: 'POST', body: JSON.stringify({ trigger_text: trigger, reply_text: replyText, match_type: matchType }) })
      setTrigger(''); setReplyText('')
      const data = await api<{ rules: Rule[] }>('/api/auto-replies'); setRules(data.rules)
      setNotice('پاسخ خودکار اضافه شد.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ثبت پاسخ خودکار ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function saveExpiry(userId: string) {
    const jalaliDate = adminExpiry[userId]
    const expiresAt = jalaliDate ? jalaliToGregorian(jalaliDate) : null
    if (!expiresAt) { setError('تاریخ شمسی معتبر وارد کن؛ نمونه: ۱۴۰۵/۱۲/۲۹'); return }
    setBusy(true); setError('')
    try {
      await api('/api/admin/users?id=' + encodeURIComponent(userId), { method: 'PATCH', body: JSON.stringify({ expiresAt }) })
      setNotice('تاریخ انقضای اشتراک ذخیره شد.')
      setAdminExpiry(current => ({ ...current, [userId]: gregorianToJalali(expiresAt) }))
      const data = await api<{ users: AdminUser[] }>('/api/admin/users')
      setAdminUsers(data.users)
      setAdminExpiry(current => ({...current, [userId]: gregorianToJalali(data.users.find(user=>user.id===userId)?.expires_at)}))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ذخیره اشتراک ناموفق بود.') }
    finally { setBusy(false) }
  }


  async function saveMenu(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const { id, ...draft } = menuDraft
      await api('/api/bot-menus' + (id ? '?id=' + encodeURIComponent(id) : ''), {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(draft),
      })
      const data = await api<{ menus: BotMenu[] }>('/api/bot-menus')
      setMenus(data.menus)
      setMenuDraft({ id:'', title:'', description:'', parentId:'', responseType:'text', responseContent:'', targetUrl:'' })
      setNotice(id ? 'منو ویرایش شد.' : 'منو ایجاد شد.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ذخیره منو ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function toggleVisitorMessages(enabled: boolean) {
    const previous = menuAppearance
    const next = { ...previous, visitor_messages_enabled: enabled }
    setMenuAppearance(next)
    setBusy(true); setError(''); setNotice('')
    try {
      const data = await api<{ appearance: MenuAppearance }>('/api/bots?resource=menu-appearance', {
        method:'PATCH', body:JSON.stringify(next),
      })
      setMenuAppearance(data.appearance)
      setNotice(enabled ? 'دریافت پیام بازدیدکنندگان فعال شد.' : 'دریافت پیام بازدیدکنندگان غیرفعال شد.')
    } catch (cause) {
      setMenuAppearance(previous)
      setError(cause instanceof Error ? cause.message : 'تغییر تنظیم دریافت پیام ناموفق بود.')
    } finally { setBusy(false) }
  }

  async function uploadMenuImage(file: File, kind: 'banner' | 'menu', menuId?: string) {
    if (file.size > 300 * 1024) { setError('حجم تصویر نباید بیشتر از ۳۰۰ کیلوبایت باشد.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const result = await api<{ imageKey: string }>('/api/image-upload', { method: 'POST', body: JSON.stringify({ kind, menuId, imageBase64: btoa(binary) }) })
      if (kind === 'banner') setMenuAppearance(current => ({ ...current, banner_file_id: result.imageKey }))
      else {
        setMenuDraft(current => ({ ...current, responseType: 'photo', responseContent: result.imageKey }))
        const data = await api<{ menus: BotMenu[] }>('/api/bot-menus')
        setMenus(data.menus)
      }
      setNotice('تصویر با موفقیت در فضای ذخیره‌سازی خصوصی ثبت شد.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'بارگذاری تصویر ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function deleteMenuImage(kind: 'banner' | 'menu', menuId?: string) {
    if (!window.confirm('تصویر حذف شود؟')) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api('/api/image-upload', { method: 'DELETE', body: JSON.stringify({ kind, menuId }) })
      if (kind === 'banner') setMenuAppearance(current => ({ ...current, banner_file_id: '' }))
      else {
        setMenuDraft(current => ({ ...current, responseType: 'text', responseContent: '' }))
        const data = await api<{ menus: BotMenu[] }>('/api/bot-menus')
        setMenus(data.menus)
      }
      setNotice('تصویر حذف شد.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'حذف تصویر ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function saveMenuAppearance(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const data = await api<{ appearance: MenuAppearance }>('/api/bots?resource=menu-appearance', {
        method:'PATCH', body:JSON.stringify(menuAppearance),
      })
      setMenuAppearance(data.appearance)
      setNotice('ظاهر منوی ربات ذخیره شد.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ذخیره ظاهر منو ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function removeMenu(menu: BotMenu) {
    if (!window.confirm('منو و تمام زیرمنوهای آن حذف شوند؟')) return
    setBusy(true); setError('')
    try {
      await api('/api/bot-menus?id=' + encodeURIComponent(menu.id), { method:'DELETE' })
      setMenus(current => current.filter(item => item.id !== menu.id && item.parent_id !== menu.id))
      if (menuDraft.id === menu.id) setMenuDraft({ id:'', title:'', description:'', parentId:'', responseType:'text', responseContent:'', targetUrl:'' })
      setNotice('منو حذف شد.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'حذف منو ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function createLicensePlan(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      await api('/api/admin/license-plans', { method: 'POST', body: JSON.stringify({
        code: planDraft.code, name: planDraft.name, description: planDraft.description,
        durationDays: Number(planDraft.durationDays), maxBots: Number(planDraft.maxBots),
        maxMenus: Number(planDraft.maxMenus), maxVisitors: planDraft.maxVisitors || null, features: planDraft.features,
      }) })
      setPlanDraft({ code:'', name:'', description:'', durationDays:'30', maxBots:'1', maxMenus:'20', maxVisitors:'', features:{ conversations:true, autoReplies:true, menuBuilder:true } })
      const data = await api<{ plans: LicensePlan[] }>('/api/admin/license-plans'); setLicensePlans(data.plans)
      setNotice('پلن لایسنس ایجاد شد.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ساخت پلن ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function issueLicense(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      await api('/api/admin/licenses', { method:'POST', body:JSON.stringify(licenseDraft) })
      const data = await api<{ licenses: LicenseItem[] }>('/api/admin/licenses'); setLicenseItems(data.licenses)
      setNotice('لایسنس با موفقیت به مشتری تخصیص یافت.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'صدور لایسنس ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function setLicenseStatus(item: LicenseItem, status: 'active' | 'suspended' | 'revoked') {
    const label = status === 'active' ? 'فعال' : status === 'suspended' ? 'تعلیق' : 'لغو'
    if (!window.confirm('وضعیت این لایسنس ' + label + ' شود؟')) return
    setBusy(true); setError('')
    try {
      await api('/api/admin/licenses?id=' + encodeURIComponent(item.id), { method:'PATCH', body:JSON.stringify({ status }) })
      const data = await api<{ licenses: LicenseItem[] }>('/api/admin/licenses'); setLicenseItems(data.licenses)
      setNotice('وضعیت لایسنس تغییر کرد.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تغییر وضعیت ناموفق بود.') }
    finally { setBusy(false) }
  }

  async function toggleRule(rule: Rule) {
    try {
      await api(`/api/auto-replies?id=${rule.id}`, { method: 'PATCH', body: JSON.stringify({ is_enabled: !rule.is_enabled }) })
      setRules(current => current.map(item => item.id === rule.id ? { ...item, is_enabled: !item.is_enabled } : item))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'به‌روزرسانی ناموفق بود.') }
  }
  async function deleteRule(id: string) {
    if (!window.confirm('این پاسخ خودکار حذف شود؟')) return
    try { await api(`/api/auto-replies?id=${id}`, { method: 'DELETE' }); setRules(current => current.filter(item => item.id !== id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'حذف ناموفق بود.') }
  }

  const changePage = (page: Page) => { setActive(page); setMobileNav(false); setError(''); setNotice('') }
  const title = active === 'نمای کلی' ? 'سلام، خوش اومدی 👋' : active
  const pageDescription: Record<Page, string> = {
    'نمای کلی': 'وضعیت ربات‌ها و گفتگوهای خودت رو از اینجا مدیریت کن.',
    'گفتگوها': 'پیام‌های دریافتی کاربران را ببین و مستقیم پاسخ بده.',
    'بازدیدکنندگان': 'افرادی که به رباتت پیام داده‌اند و /start زده‌اند.',
    'پاسخ‌های خودکار': 'برای پیام‌های ورودی، پاسخ خودکار تعریف کن.',
    'مدیریت ربات': 'وضعیت اتصال و تنظیمات ربات تلگرام.',
    'مدیریت کاربران': 'ساخت و مدیریت حساب‌های مشتریان سامانه.',
    'مدیریت پلن‌ها': 'تعریف و مدیریت پلن‌های اشتراک و محدودیت امکانات.',
    'مدیریت لایسنس': 'صدور، تخصیص و کنترل اعتبار لایسنس مشتریان.',
    'ربات مرکزی': 'اتصال و راه‌اندازی ربات مدیریتی تلگرام برای کل سامانه.',
    'منوساز': 'ساخت منو و زیرمنو و تعیین پاسخ هر دکمه برای ربات تلگرام.',
    'اشتراک و اعتبار': 'وضعیت اشتراک و زمان اعتبار حساب.',
    'تنظیمات': 'تنظیمات پایه پنل و حساب کاربری.',
  }

  return (
    <div className={dark ? 'app dark' : 'app light'}>
      <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
        <div className="brand"><div className="brand-mark"><Bot size={22} /></div><div><b>تلگرام‌یار</b><small>پنل مدیریت ربات</small></div></div>
        <div className="workspace"><div className="workspace-avatar">{isSuperAdmin ? 'S' : 'T'}</div><div><b>{isSuperAdmin ? 'مدیریت کل سامانه' : 'فضای کاری من'}</b><small>{isSuperAdmin ? 'دسترسی مدیر کل' : 'حساب مشتری'}</small></div>{!isSuperAdmin && <ChevronDown size={16} />}</div>
        {isSuperAdmin ? <><div className="nav-label">مدیریت سامانه</div><nav>{([{label:'مدیریت کاربران',icon:UserCog},{label:'مدیریت پلن‌ها',icon:ListChecks},{label:'مدیریت لایسنس',icon:ShieldCheck},{label:'ربات مرکزی',icon:RadioTower},{label:'تنظیمات',icon:Settings}] as {label:Page;icon:typeof LayoutDashboard}[]).map(({label,icon:Icon}) => <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => changePage(label)}><Icon size={18}/><span>{label}</span></button>)}</nav></> : <><div className="nav-label">منوی اصلی</div><nav>{nav.map(({label, icon: Icon}) => <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => changePage(label)}><Icon size={18}/><span>{label}</span>{label === 'گفتگوها' && dashboard?.unreadMessages ? <i className="nav-count">{dashboard.unreadMessages}</i> : null}</button>)}</nav><div className="nav-label second">مدیریت</div><nav>{tools.filter(item => item.label !== 'مدیریت کاربران' && item.label !== 'مدیریت لایسنس').map(({label, icon: Icon}) => <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => changePage(label)}><Icon size={18}/><span>{label}</span></button>)}</nav></>}
        <div className="sidebar-bottom">{!isSuperAdmin && <div className="help-card"><div className="help-icon"><CircleHelp size={18}/></div><b>راهنمای شروع</b><p>برای اتصال ربات، از BotFather توکن بگیر و در بخش مدیریت ربات وارد کن.</p><button onClick={() => changePage('مدیریت ربات')}>مدیریت ربات <span>←</span></button></div>}<div className="profile"><div className="profile-avatar">{isSuperAdmin ? 'S' : 'U'}</div><div><b>{isSuperAdmin ? 'مدیر کل سامانه' : 'حساب کاربری'}</b><small>{isSuperAdmin ? 'پنل مدیریت پلتفرم' : 'پنل اختصاصی مشتری'}</small></div><MoreHorizontal size={19}/></div></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="top-left"><button className="mobile-menu icon-btn" onClick={() => setMobileNav(!mobileNav)}><Command size={19}/></button><div className="breadcrumb">فضای کاری <span>/</span> <b>{active}</b></div></div><div className="top-actions"><div className="searchbox"><Search size={16}/><input placeholder="جستجو..." /></div><button className="icon-btn theme-btn" aria-label="تغییر پوسته" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="icon-btn" aria-label="بارگذاری مجدد" onClick={() => { setLoading(true); refreshPage().finally(() => setLoading(false)) }}><RefreshCw size={16}/></button><div className="top-avatar">A</div></div></header>

        <div className="content">
          <div className="page-heading"><div><div className="eyebrow"><span className="pulse"/> {isSuperAdmin ? 'پنل مدیر کل سامانه' : 'پنل مدیریت مشتری'}</div><h1>{title}</h1><p>{pageDescription[active]}</p></div>{active === 'مدیریت کاربران' && isSuperAdmin ? <button className="primary-btn" onClick={onCreateUser}><Plus size={18}/>ایجاد کاربر</button> : active === 'مدیریت پلن‌ها' && isSuperAdmin ? <button className="primary-btn" onClick={() => document.getElementById('new-license-plan')?.scrollIntoView({behavior:'smooth',block:'start'})}><Plus size={18}/>ایجاد پلن</button> : active === 'پاسخ‌های خودکار' ? <button className="primary-btn" onClick={() => document.getElementById('new-rule-trigger')?.focus()}><Plus size={18}/>افزودن پاسخ</button> : !isSuperAdmin && !bot && active !== 'اشتراک و اعتبار' && active !== 'تنظیمات' && active !== 'منوساز' ? <button className="primary-btn" onClick={() => setShowConnect(true)}><Plus size={18}/>اتصال ربات جدید</button> : null}</div>
          {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')}><X size={15}/></button></div>}
          {error && <div className="notice error-notice" role="alert">{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
          {loading ? <div className="loading-state"><LoaderCircle className="spin" size={25}/> در حال دریافت اطلاعات...</div> : null}

          {!loading && active === 'نمای کلی' && <>
            <section className="stats-grid">
              <div className="stat-card"><div className="stat-top"><span>ربات من</span><span className="stat-icon purple"><Bot size={18}/></span></div><div className="stat-value">{bot?.status === 'active' ? '۱' : '۰'} <small>ربات</small></div><div className="stat-foot">{bot?.username ? '@' + bot.username : 'هنوز رباتی متصل نشده'}</div></div>
              <div className="stat-card"><div className="stat-top"><span>کل بازدیدکنندگان</span><span className="stat-icon blue"><Users size={18}/></span></div><div className="stat-value">{(dashboard?.visitors ?? 0).toLocaleString('fa-IR')} <small>نفر</small></div><div className="stat-foot">کاربران ثبت‌شده در ربات</div></div>
              <div className="stat-card"><div className="stat-top"><span>گفتگوهای باز</span><span className="stat-icon green"><MessageCircle size={18}/></span></div><div className="stat-value">{(dashboard?.openConversations ?? 0).toLocaleString('fa-IR')} <small>گفتگو</small></div><div className="stat-foot">{(dashboard?.unreadMessages ?? 0).toLocaleString('fa-IR')} پیام خوانده‌نشده</div></div>
              <div className="stat-card"><div className="stat-top"><span>وضعیت اشتراک</span><span className="stat-icon amber"><ShieldCheck size={18}/></span></div><div className="stat-value status-value">{dashboard?.subscription.active ? 'فعال' : 'غیرفعال'}</div><div className="stat-foot">{dashboard?.subscription.expiresAt ? 'انقضا: ' + date(dashboard.subscription.expiresAt) : 'برای فعال‌سازی با مدیر تماس بگیر'}</div></div>
            </section>
            <section className="section-grid">
              <div className="panel bot-panel"><div className="panel-heading"><div><h2>ربات من</h2><p>مدیریت اتصال و وضعیت ربات تلگرام</p></div><button className="more-btn" onClick={() => changePage('مدیریت ربات')}><MoreHorizontal size={20}/></button></div>
                {bot ? <div className="bot-summary"><div className="bot-illustration"><Bot size={34}/></div><h3>{bot.display_name || 'ربات تلگرام'}</h3><p dir="ltr">@{bot.username || 'بدون نام کاربری'}</p><span className={bot.status === 'active' ? 'status-pill good' : 'status-pill'}>{bot.status === 'active' ? 'متصل و فعال' : bot.status}</span><button className="outline-btn" onClick={() => changePage('مدیریت ربات')}>مشاهده جزئیات</button></div> :
                <div className="empty-state"><div className="empty-illustration"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="bot-illustration"><Bot size={34}/></div><span className="spark spark-a">✦</span><span className="spark spark-b">✧</span></div><h3>هنوز رباتی متصل نکردی</h3><p>توکن BotFather را وارد کن تا ربات به پنل متصل شود و پیام‌ها ثبت شوند.</p><button className="outline-btn" onClick={() => setShowConnect(true)}><Plus size={17}/> اتصال اولین ربات</button></div>}</div>
              <div className="panel activity-panel"><div className="panel-heading"><div><h2>پاسخ‌های خودکار</h2><p>قوانین فعال پاسخ‌گویی</p></div><Zap size={19} className="muted-icon"/></div><div className="activity-empty"><div className="activity-icon"><Zap size={21}/></div><b>{(dashboard?.activeAutoReplies ?? 0).toLocaleString('fa-IR')} قانون فعال</b><span>برای مدیریت قانون‌ها وارد بخش پاسخ‌های خودکار شو.</span><button className="outline-btn" onClick={() => changePage('پاسخ‌های خودکار')}>مدیریت پاسخ‌ها</button></div><div className="activity-footer"><span className="live-dot"/> اطلاعات از پایگاه داده خوانده می‌شود</div></div>
            </section>
          </>}

          {!loading && active === 'مدیریت ربات' && <section className="panel page-panel"><div className="panel-heading"><div><h2>مدیریت اتصال ربات</h2><p>توکن ربات به‌صورت رمزنگاری‌شده نگهداری می‌شود.</p></div><Bot className="muted-icon"/></div>{bot ? <><div className="detail-card"><div className="detail-icon"><Bot size={27}/></div><div className="detail-main"><b>{bot.display_name || 'ربات تلگرام'}</b><span dir="ltr">@{bot.username || '—'}</span><small>شناسه: {bot.id}</small></div><span className={bot.status === 'active' ? 'status-pill good' : 'status-pill'}>{bot.status === 'active' ? 'فعال' : bot.status}</span><button className="outline-btn" disabled={busy || bot.status !== 'active'} onClick={reconnectBot}><RefreshCw size={15}/> انتقال وبهوک از Vercel به Preview</button><button className="danger-btn" disabled={busy || bot.status === 'disabled'} onClick={disableBot}><Power size={15}/> غیرفعال‌سازی</button></div><div className="qr-panel"><div><b>وضعیت اتصال وبهوک تلگرام</b><p>برای تشخیص اینکه پیام‌های /start به کدام نسخه از برنامه می‌رسند، نشانی امن وبهوک را بدون نمایش توکن بررسی کن.</p><button className="outline-btn" disabled={webhookStatusBusy} onClick={loadWebhookStatus}>{webhookStatusBusy ? <LoaderCircle size={15} className="spin"/> : <RadioTower size={15}/>} بررسی وضعیت وبهوک</button></div>{webhookStatus && <div className="qr-result"><b>{webhookStatus.webhook.configured ? 'وبهوک ثبت شده' : 'وبهوک ثبت نشده'}</b><span dir="ltr">{webhookStatus.webhook.host || '—'}</span><span dir="ltr">{webhookStatus.webhook.path || '—'}</span><span>پیام‌های در انتظار: {webhookStatus.webhook.pending_update_count}</span>{webhookStatus.webhook.last_error_message && <small>آخرین خطا: {webhookStatus.webhook.last_error_message}</small>}</div>}</div><div className="qr-panel"><div><b>QR اختصاصی ورود به ربات</b><p>کاربر QR را اسکن می‌کند و پس از باز شدن چت، باید دکمه Start را بزند.</p><button className="outline-btn" disabled={qrBusy || bot.status !== 'active'} onClick={createBotQr}>{qrBusy ? <LoaderCircle size={15} className="spin"/> : <Bot size={15}/>} ساخت QR و لینک دعوت</button></div>{qrImageUrl && <div className="qr-result"><img src={qrImageUrl} alt="QR اختصاصی ربات تلگرام"/><a href={qrDeepLink} target="_blank" rel="noreferrer">باز کردن لینک دعوت</a></div>}</div></> : <div className="empty-inline"><Bot size={30}/><b>هنوز رباتی متصل نیست</b><p>توکن ربات را از BotFather دریافت کن و اتصال را انجام بده.</p><button className="primary-btn" onClick={() => setShowConnect(true)}><Plus size={17}/> اتصال ربات</button></div>}</section>}

          {!loading && active === 'گفتگوها' && <section className="panel page-panel"><div className="panel-heading"><div><h2>صندوق گفتگوها</h2><p>{conversations.length.toLocaleString('fa-IR')} گفتگو</p></div><MessageCircle className="muted-icon"/></div>{!bot ? <div className="empty-inline"><Bot size={30}/><b>ابتدا رباتت را متصل کن</b></div> : <div className="conversation-layout"><div className="conversation-list">{conversations.length ? conversations.map(item => <button key={item.id} className={selectedConversation === item.id ? 'conversation-item selected' : 'conversation-item'} onClick={() => setSelectedConversation(item.id)}><span className="visitor-avatar">{(item.first_name || item.username || '؟').slice(0,1)}</span><span className="conversation-meta"><b>{fullName(item)}</b><small>{item.last_message || 'بدون متن'}</small><time>{date(item.last_message_at)}</time></span>{item.unread_count > 0 && <i className="unread-pill">{item.unread_count}</i>}</button>) : <div className="empty-inline">هنوز گفتگویی ثبت نشده است.</div>}</div><div className="message-pane">{selectedConversation ? <><div className="message-list">{messages.map(message => <div key={message.id} className={message.direction === 'outbound' ? 'message-bubble outgoing' : 'message-bubble'}><p>{message.text_body || 'پیام غیرمتنی'}</p><time>{date(message.created_at)}</time></div>)}</div><form className="reply-form" onSubmit={sendReply}><input value={reply} onChange={e => setReply(e.target.value)} placeholder="پیامت را بنویس..." maxLength={4096}/><button className="primary-btn" disabled={busy || !reply.trim()}><Send size={16}/> ارسال</button></form></> : <div className="empty-inline"><MessageCircle size={30}/><span>برای مشاهده پیام‌ها یک گفتگو را انتخاب کن.</span></div>}</div></div>}</section>}

          {!loading && active === 'بازدیدکنندگان' && <section className="panel page-panel"><div className="panel-heading"><div><h2>بازدیدکنندگان</h2><p>{visitors.length.toLocaleString('fa-IR')} نفر اخیر</p></div><Users className="muted-icon"/></div><div className="table-wrap"><table className="data-table"><thead><tr><th>کاربر</th><th>شناسه تلگرام</th><th>زبان</th><th>گفتگوها</th><th>آخرین بازدید</th></tr></thead><tbody>{visitors.map(v => <tr key={v.id}><td>{fullName(v)}</td><td dir="ltr">{v.telegram_user_id}</td><td>{v.language_code || '—'}</td><td>{v.conversations.toLocaleString('fa-IR')}</td><td>{date(v.last_seen_at)}</td></tr>)}</tbody></table>{!visitors.length && <div className="empty-inline">هنوز بازدیدکننده‌ای ثبت نشده است. با ارسال /start به ربات، کاربران اینجا نمایش داده می‌شوند.</div>}</div></section>}

          {!loading && active === 'پاسخ‌های خودکار' && <section className="page-panel"><div className="panel rule-form-panel"><div className="panel-heading"><div><h2>افزودن پاسخ خودکار</h2><p>با تطبیق متن پیام کاربر، پاسخ تعیین‌شده ارسال می‌شود.</p></div><Zap className="muted-icon"/></div><form className="rule-form" onSubmit={addRule}><label>عبارت محرک<input id="new-rule-trigger" value={trigger} onChange={e => setTrigger(e.target.value)} placeholder="مثلاً قیمت" maxLength={200} required/></label><label>نوع تطبیق<select value={matchType} onChange={e => setMatchType(e.target.value)}><option value="contains">شامل عبارت باشد</option><option value="exact">دقیقاً برابر باشد</option><option value="starts_with">با عبارت شروع شود</option></select></label><label className="wide-field">متن پاسخ<textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="متن پاسخی که ربات ارسال می‌کند..." maxLength={4000} rows={3} required/></label><button className="primary-btn" disabled={busy || !trigger.trim() || !replyText.trim()}><Plus size={16}/> ثبت پاسخ</button></form></div><div className="panel rules-list"><div className="panel-heading"><div><h2>قوانین ثبت‌شده</h2><p>{rules.length.toLocaleString('fa-IR')} پاسخ خودکار</p></div></div>{rules.length ? rules.map(rule => <div className="rule-row" key={rule.id}><div className="rule-copy"><b>{rule.trigger_text}</b><p>{rule.reply_text}</p><small>{rule.match_type === 'exact' ? 'تطبیق دقیق' : rule.match_type === 'starts_with' ? 'شروع با عبارت' : 'شامل عبارت'}</small></div><label className="switch-label"><input type="checkbox" checked={rule.is_enabled} onChange={() => toggleRule(rule)}/><span>{rule.is_enabled ? 'فعال' : 'غیرفعال'}</span></label><button className="icon-btn delete-btn" aria-label="حذف قانون" onClick={() => deleteRule(rule.id)}><Trash2 size={16}/></button></div>) : <div className="empty-inline">هنوز پاسخی تعریف نشده است.</div>}</div></section>}

          {!loading && active === 'منوساز' && <section className="page-panel menu-builder">
            <div className="panel rule-form-panel">
              <div className="panel-heading"><div><h2>{menuDraft.id ? 'ویرایش منو' : 'ساخت منو یا زیرمنو'}</h2><p>برای هر دکمه عنوان و نوع محتوای پاسخ را مشخص کن.</p></div><Bot className="muted-icon"/></div>
              <form className="rule-form" onSubmit={saveMenu}>
                <label>عنوان دکمه<input value={menuDraft.title} onChange={e=>setMenuDraft(v=>({...v,title:e.target.value}))} maxLength={120} required placeholder="مثلاً خدمات ما"/></label>
                <label>منوی والد<select value={menuDraft.parentId} onChange={e=>setMenuDraft(v=>({...v,parentId:e.target.value}))}><option value="">منوی اصلی (بدون والد)</option>{menus.filter(m=>m.id!==menuDraft.id).map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
                <label>نوع عملکرد دکمه<select value={menuDraft.responseType} onChange={e=>setMenuDraft(v=>({...v,responseType:e.target.value as BotMenu['response_type']}))}><option value="text">ارسال متن</option><option value="photo">ارسال عکس (با آدرس فایل تلگرام)</option><option value="document">ارسال فایل (با آدرس فایل تلگرام)</option><option value="url">بازکردن لینک</option><option value="submenu">نمایش زیرمنو</option></select></label>
                {menuDraft.responseType==='url' ? <label>آدرس لینک امن<input type="url" value={menuDraft.targetUrl} onChange={e=>setMenuDraft(v=>({...v,targetUrl:e.target.value}))} placeholder="https://example.com" required/></label> : null}
                {menuDraft.responseType!=='submenu' && menuDraft.responseType!=='url' ? {menuDraft.responseType==='photo' ? <div className="wide-field"><label>تصویر گزینه منو (JPEG، PNG یا WebP؛ حداکثر ۳۰۰ کیلوبایت)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !menuDraft.id} onChange={e=>{const file=e.target.files?.[0];if(file && menuDraft.id)void uploadMenuImage(file,'menu',menuDraft.id);e.currentTarget.value=''}}/></label>{!menuDraft.id && <small>ابتدا منو را ذخیره کن؛ سپس آن را ویرایش و تصویر را بارگذاری کن.</small>}{menuDraft.responseContent.startsWith('bots/') && <button type="button" className="danger-btn" disabled={busy || !menuDraft.id} onClick={()=>void deleteMenuImage('menu',menuDraft.id)}>حذف تصویر این گزینه</button>}</div> : <label className="wide-field">{menuDraft.responseType==='text'?'متن پاسخ':'آدرس file_id یا URL فایل'}<textarea rows={3} maxLength={4000} value={menuDraft.responseContent} onChange={e=>setMenuDraft(v=>({...v,responseContent:e.target.value}))} required placeholder="محتوای ارسالی به کاربر تلگرام"/></label>} : null}
                <label className="wide-field">توضیحات اختیاری<input value={menuDraft.description} onChange={e=>setMenuDraft(v=>({...v,description:e.target.value}))} maxLength={1000} placeholder={menuDraft.responseType==='photo'?'متن زیر عکس برای کاربر (کپشن)':'توضیح برای مدیریت داخلی'}/></label>
                <div className="wide-field" style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="primary-btn" disabled={busy}>{menuDraft.id?'ذخیره تغییرات':'ایجاد منو'}</button>{menuDraft.id?<button type="button" className="outline-btn" onClick={()=>setMenuDraft({id:'',title:'',description:'',parentId:'',responseType:'text',responseContent:'',targetUrl:''})}>انصراف از ویرایش</button>:null}</div>
              </form>
            </div>
            <div className="panel rule-form-panel">
              <div className="panel-heading"><div><h2>شخصی‌سازی ظاهر منو</h2><p>تنظیمات فقط روی همین ربات اعمال می‌شود؛ قالب لوکس و مدرن، پیش‌فرض همه ربات‌هاست.</p></div><Settings className="muted-icon"/></div>
              <form className="rule-form" onSubmit={saveMenuAppearance}>
                <label>قالب ظاهری<select value={menuAppearance.theme} onChange={e=>setMenuAppearance(v=>({...v,theme:e.target.value as MenuAppearance['theme']}))}>
                  <option value="luxury_modern">لوکس و مدرن (پیشنهادی)</option><option value="minimal">مینیمال و ساده</option><option value="vibrant">رنگارنگ و پرانرژی</option>
                </select></label>
                <label>تعداد ستون دکمه‌ها<select value={String(menuAppearance.button_columns)} onChange={e=>setMenuAppearance(v=>({...v,button_columns:Number(e.target.value)}))}>
                  <option value="1">تک‌ستونه</option><option value="2">دوستونه</option><option value="3">سه‌ستونه</option>
                </select></label>
                <label>میزان استفاده از ایموجی<select value={menuAppearance.emoji_mode} onChange={e=>setMenuAppearance(v=>({...v,emoji_mode:e.target.value as MenuAppearance['emoji_mode']}))}>
                  <option value="off">بدون ایموجی</option><option value="subtle">ظریف و محدود</option><option value="expressive">متنوع و پررنگ</option>
                </select></label>
                <label>عنوان خوشامدگویی<input value={menuAppearance.welcome_title} onChange={e=>setMenuAppearance(v=>({...v,welcome_title:e.target.value}))} maxLength={120} required/></label>
                <label className="wide-field">متن خوشامدگویی<textarea rows={3} maxLength={700} value={menuAppearance.welcome_text} onChange={e=>setMenuAppearance(v=>({...v,welcome_text:e.target.value}))} required/></label>
                <div className="wide-field"><label>تصویر بنر (JPEG، PNG یا WebP؛ حداکثر ۳۰۰ کیلوبایت)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void uploadMenuImage(file,'banner');e.currentTarget.value=''}}/></label>{menuAppearance.banner_file_id && <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}><small>تصویر بنر ثبت شده است.</small><button type="button" className="danger-btn" disabled={busy} onClick={()=>void deleteMenuImage('banner')}>حذف تصویر بنر</button></div>}</div>
                <div className="wide-field" style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
                  <button className="primary-btn" disabled={busy}><ShieldCheck size={16}/> ذخیره ظاهر منو</button>
                  <span style={{fontSize:11,color:'var(--muted)'}}>پیش‌نمایش تلگرام: {menuAppearance.button_columns} ستون · {menuAppearance.emoji_mode==='off'?'بدون ایموجی':menuAppearance.emoji_mode==='subtle'?'ایموجی ظریف':'ایموجی متنوع'}</span>
                </div>
              </form>
            </div>
            <div className="panel page-panel">
              <div className="panel-heading"><div><h2>منوهای ساخته‌شده</h2><p>{menus.length.toLocaleString('fa-IR')} منو و زیرمنو</p></div></div>
              <div className="table-wrap menu-table-desktop"><table className="data-table"><thead><tr><th>عنوان</th><th>والد</th><th>عملکرد</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>
                {menus.map(m=><tr key={m.id}><td>{m.parent_id?'↳ ':''}{m.title}</td><td>{menus.find(p=>p.id===m.parent_id)?.title || 'منوی اصلی'}</td><td>{({text:'متن',photo:'عکس',document:'فایل',url:'لینک',submenu:'زیرمنو'} as Record<string,string>)[m.response_type]}</td><td>{m.is_active?'فعال':'غیرفعال'}</td><td><button className="outline-btn" onClick={()=>setMenuDraft({id:m.id,title:m.title,description:m.description||'',parentId:m.parent_id||'',responseType:m.response_type,responseContent:m.response_content||'',targetUrl:m.target_url||''})}>ویرایش</button> <button className="danger-btn" disabled={busy} onClick={()=>removeMenu(m)}>حذف</button></td></tr>)}
              </tbody></table></div>
              <div className="menu-cards-mobile">{menus.map(m=><article className="menu-mobile-card" key={m.id}>
                <div className="menu-mobile-card-head"><b>{m.parent_id?'↳ ':''}{m.title}</b><span className={m.is_active?'status-pill good':'status-pill'}>{m.is_active?'فعال':'غیرفعال'}</span></div>
                <div className="menu-mobile-meta"><span>والد: {menus.find(p=>p.id===m.parent_id)?.title || 'منوی اصلی'}</span><span>نوع: {({text:'متن',photo:'عکس',document:'فایل',url:'لینک',submenu:'زیرمنو'} as Record<string,string>)[m.response_type]}</span></div>
                <div className="menu-mobile-actions"><button className="outline-btn" onClick={()=>setMenuDraft({id:m.id,title:m.title,description:m.description||'',parentId:m.parent_id||'',responseType:m.response_type,responseContent:m.response_content||'',targetUrl:m.target_url||''})}>ویرایش</button><button className="danger-btn" disabled={busy} onClick={()=>removeMenu(m)}>حذف</button></div>
              </article>)}</div>
              {!menus.length?<div className="empty-inline">هنوز منویی نساخته‌ای. از فرم بالا اولین منو را ایجاد کن.</div>:null}
            </div>
          </section>}

          {!loading && active === 'مدیریت کاربران' && isSuperAdmin && <section className="panel page-panel"><div className="panel-heading"><div><h2>مدیریت اشتراک کاربران</h2><p>برای هر حساب کاربری تاریخ پایان اشتراک را تعیین کن.</p></div><UserCog className="muted-icon"/></div><div className="table-wrap"><table className="data-table"><thead><tr><th>نام</th><th>ایمیل</th><th>نقش</th><th>وضعیت اشتراک</th><th>تاریخ انقضا</th><th>عملیات</th></tr></thead><tbody>{adminUsers.map(user => <tr key={user.id}><td>{user.name}</td><td dir="ltr">{user.email}</td><td>{user.role === 'super_admin' ? 'مدیر کل' : 'کاربر'}</td><td><span className={user.subscription_active ? 'status-pill good' : 'status-pill'}>{user.subscription_active ? 'فعال' : 'غیرفعال'}</span></td><td>{user.role === 'super_admin' ? '—' : <div style={{display:'grid',gap:5,minWidth:145}}><strong style={{fontSize:12}}>{date(user.expires_at)}</strong><input aria-label={'تاریخ انقضای شمسی ' + user.name} type="text" inputMode="numeric" dir="ltr" placeholder="۱۴۰۵/۱۲/۲۹" value={adminExpiry[user.id] || ''} onChange={e => setAdminExpiry(current => ({ ...current, [user.id]: e.target.value.replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))) }))}/></div>}</td><td>{user.role !== 'super_admin' && <button className="outline-btn" disabled={busy || !adminExpiry[user.id]} onClick={() => saveExpiry(user.id)}>ذخیره</button>}</td></tr>)}</tbody></table>{!adminUsers.length && <div className="empty-inline">کاربری برای نمایش وجود ندارد.</div>}</div></section>}


          {!loading && active === 'مدیریت پلن‌ها' && isSuperAdmin && <section className="page-panel">
            <div id="new-license-plan" className="panel rule-form-panel">
              <div className="panel-heading"><div><h2>تعریف پلن جدید</h2><p>مدت اعتبار و سقف امکانات هر پلن را تعیین کن.</p></div><ShieldCheck className="muted-icon"/></div>
              <form className="rule-form" onSubmit={createLicensePlan}>
                <label>شناسه پلن انگلیسی<input value={planDraft.code} onChange={e=>setPlanDraft(v=>({...v,code:e.target.value}))} placeholder="starter-1m" pattern="[A-Za-z0-9_-]+" required/></label>
                <label>نام پلن<input value={planDraft.name} onChange={e=>setPlanDraft(v=>({...v,name:e.target.value}))} placeholder="پلن یک‌ماهه" required/></label>
                <label>مدت اعتبار (روز)<input type="number" min="1" max="3650" value={planDraft.durationDays} onChange={e=>setPlanDraft(v=>({...v,durationDays:e.target.value}))} required/></label>
                <label>حداکثر ربات<input type="number" min="1" max="100" value={planDraft.maxBots} onChange={e=>setPlanDraft(v=>({...v,maxBots:e.target.value}))} required/></label>
                <label>حداکثر منو<input type="number" min="0" max="10000" value={planDraft.maxMenus} onChange={e=>setPlanDraft(v=>({...v,maxMenus:e.target.value}))} required/></label>
                <label>سقف بازدیدکننده (خالی = نامحدود)<input type="number" min="0" value={planDraft.maxVisitors} onChange={e=>setPlanDraft(v=>({...v,maxVisitors:e.target.value}))}/></label>
                <label className="wide-field">توضیحات<input value={planDraft.description} onChange={e=>setPlanDraft(v=>({...v,description:e.target.value}))} placeholder="توضیح کوتاه پلن"/></label>
                <div className="wide-field" style={{display:'flex',gap:18,flexWrap:'wrap',alignItems:'center'}}>
                  <b style={{fontSize:11}}>امکانات فعال پلن:</b>
                  <label style={{display:'flex',gap:6,alignItems:'center'}}><input type="checkbox" checked={planDraft.features.conversations} onChange={e=>setPlanDraft(v=>({...v,features:{...v.features,conversations:e.target.checked}}))}/> مدیریت گفتگوها</label>
                  <label style={{display:'flex',gap:6,alignItems:'center'}}><input type="checkbox" checked={planDraft.features.autoReplies} onChange={e=>setPlanDraft(v=>({...v,features:{...v.features,autoReplies:e.target.checked}}))}/> پاسخ خودکار</label>
                  <label style={{display:'flex',gap:6,alignItems:'center'}}><input type="checkbox" checked={planDraft.features.menuBuilder} onChange={e=>setPlanDraft(v=>({...v,features:{...v.features,menuBuilder:e.target.checked}}))}/> منوساز</label>
                </div>
                <button className="primary-btn" disabled={busy}><Plus size={16}/> ایجاد پلن</button>
              </form>
            </div>
            <div className="panel page-panel">
              <div className="panel-heading"><div><h2>پلن‌های تعریف‌شده</h2><p>{licensePlans.length.toLocaleString('fa-IR')} پلن</p></div></div>
              <div className="table-wrap"><table className="data-table"><thead><tr><th>نام پلن</th><th>شناسه</th><th>مدت</th><th>ربات</th><th>منو</th><th>بازدیدکننده</th><th>لایسنس صادرشده</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>
                {licensePlans.map(plan=><tr key={plan.id}><td>{plan.name}</td><td dir="ltr">{plan.code}</td><td>{plan.duration_days} روز</td><td>{plan.max_bots}</td><td>{plan.max_menus}</td><td>{plan.max_visitors ?? 'نامحدود'}</td><td>{plan.issued_count}</td><td><span className={plan.is_active?'status-pill good':'status-pill'}>{plan.is_active?'فعال':'غیرفعال'}</span></td><td><button className="outline-btn" disabled={busy} onClick={async()=>{try{await api('/api/admin/license-plans?id='+plan.id,{method:'PATCH',body:JSON.stringify({isActive:!plan.is_active})});const d=await api<{plans:LicensePlan[]}>('/api/admin/license-plans');setLicensePlans(d.plans)}catch(e){setError(e instanceof Error?e.message:'تغییر وضعیت پلن ناموفق بود.')}}}>{plan.is_active?'غیرفعال‌سازی':'فعال‌سازی'}</button></td></tr>)}
              </tbody></table>{!licensePlans.length && <div className="empty-inline">هنوز پلنی ساخته نشده است.</div>}</div>
            </div>
          </section>}

          {!loading && active === 'ربات مرکزی' && isSuperAdmin && <section className="panel page-panel"><div className="panel-heading"><div><h2>ربات مرکزی سامانه</h2><p>اتصال از طریق متغیرهای امن Preview انجام می‌شود؛ توکن در پنل نمایش داده نمی‌شود.</p></div><RadioTower className="muted-icon"/></div>{centralBot ? <><div className="detail-card"><div className="detail-icon"><Bot size={27}/></div><div className="detail-main"><b>{centralBot.bot?.firstName || 'ربات مرکزی'}</b><span dir="ltr">{centralBot.bot?.username ? '@'+centralBot.bot.username : 'نام کاربری در دسترس نیست'}</span><small>شناسه تلگرام: {centralBot.bot?.id ?? '—'}</small></div><span className={centralBot.webhookConfigured?'status-pill good':'status-pill'}>{centralBot.webhookConfigured?'وبهوک فعال':'وبهوک تنظیم نشده'}</span></div><div className="settings-row"><div><b>وضعیت تنظیمات امن</b><p>{centralBot.configured && centralBot.appUrlConfigured ? 'توکن و نشانی Preview شناسایی شدند.' : 'تنظیمات ناقص است؛ متغیرهای امن Railway Preview را بررسی کن.'}</p></div><ShieldCheck color="#43c99a"/></div><div className="settings-row"><div><b>پیام‌های در انتظار</b><p>{centralBot.pendingUpdates.toLocaleString('fa-IR')}</p></div></div><button className="primary-btn" disabled={busy || !centralBot.configured || !centralBot.appUrlConfigured} onClick={async()=>{setBusy(true);setError('');setNotice('');try{const result=await api<{success:boolean;webhookConfigured:boolean}>('/api/admin/management-bot',{method:'POST'});setNotice(result.webhookConfigured?'وبهوک ربات مرکزی در Preview با موفقیت ثبت شد.':'درخواست ثبت وبهوک انجام شد؛ وضعیت را دوباره بررسی کن.');const status=await api<typeof centralBot>('/api/admin/management-bot');setCentralBot(status)}catch(e){setError(e instanceof Error?e.message:'راه‌اندازی ربات مرکزی ناموفق بود.')}finally{setBusy(false)}}}><RadioTower size={16}/> راه‌اندازی وبهوک ربات مرکزی</button></> : <div className="empty-inline"><Bot size={30}/><b>وضعیت ربات مرکزی دریافت نشد</b><p>برای مشاهده وضعیت، صفحه را دوباره بارگذاری کن. اگر متغیرهای امن تنظیم نشده باشند، پیام خطا نمایش داده می‌شود.</p></div>}</section>}

          {!loading && active === 'مدیریت لایسنس' && isSuperAdmin && <section className="page-panel">
            <div className="panel rule-form-panel">
              <div className="panel-heading"><div><h2>تخصیص لایسنس به مشتری</h2><p>با صدور لایسنس جدید، لایسنس فعال قبلی مشتری خاتمه می‌یابد.</p></div><UserCog className="muted-icon"/></div>
              <form className="rule-form" onSubmit={issueLicense}>
                <label>مشتری<select value={licenseDraft.userId} onChange={e=>setLicenseDraft(v=>({...v,userId:e.target.value}))} required><option value="">انتخاب مشتری</option>{adminUsers.map(user=><option key={user.id} value={user.id}>{user.name} — {user.email}</option>)}</select></label>
                <label>پلن فعال<select value={licenseDraft.planId} onChange={e=>setLicenseDraft(v=>({...v,planId:e.target.value}))} required><option value="">انتخاب پلن</option>{licensePlans.filter(plan=>plan.is_active).map(plan=><option key={plan.id} value={plan.id}>{plan.name} — {plan.duration_days} روز</option>)}</select></label>
                <label className="wide-field">یادداشت (اختیاری)<input value={licenseDraft.notes} onChange={e=>setLicenseDraft(v=>({...v,notes:e.target.value}))} maxLength={1000}/></label>
                <button className="primary-btn" disabled={busy || !licenseDraft.userId || !licenseDraft.planId}><ShieldCheck size={16}/> صدور و تخصیص لایسنس</button>
              </form>
            </div>
            <div className="panel page-panel">
              <div className="panel-heading"><div><h2>لایسنس‌های مشتریان</h2><p>{licenseItems.length.toLocaleString('fa-IR')} لایسنس ثبت‌شده</p></div></div>
              <div className="table-wrap"><table className="data-table"><thead><tr><th>مشتری</th><th>پلن</th><th>وضعیت</th><th>شروع</th><th>انقضا</th><th>عملیات</th></tr></thead><tbody>
                {licenseItems.map(item=><tr key={item.id}><td>{item.user_name || item.user_email || 'مشتری حذف‌شده'}</td><td>{item.plan_name}</td><td><span className={item.status==='active'?'status-pill good':'status-pill'}>{item.status==='active'?'فعال':item.status==='suspended'?'معلق':item.status==='revoked'?'لغوشده':item.status}</span></td><td>{date(item.starts_at)}</td><td>{date(item.expires_at)}</td><td>{item.status==='active'?<><button className="outline-btn" disabled={busy} onClick={()=>setLicenseStatus(item,'suspended')}>تعلیق</button> <button className="danger-btn" disabled={busy} onClick={()=>setLicenseStatus(item,'revoked')}>لغو</button></>:item.status==='suspended'?<button className="outline-btn" disabled={busy} onClick={()=>setLicenseStatus(item,'active')}>فعال‌سازی</button>:null}</td></tr>)}
              </tbody></table>{!licenseItems.length && <div className="empty-inline">هنوز لایسنسی صادر نشده است.</div>}</div>
            </div>
          </section>}

          {!loading && active === 'اشتراک و اعتبار' && <section className="panel page-panel"><div className="panel-heading"><div><h2>اشتراک حساب</h2><p>وضعیت فعلی دسترسی به امکانات ربات</p></div><CalendarClock className="muted-icon"/></div><div className="subscription-card"><div className={dashboard?.subscription.active ? 'subscription-status active' : 'subscription-status'}><ShieldCheck size={26}/><b>{dashboard?.subscription.active ? 'اشتراک فعال است' : 'اشتراک فعال ندارید'}</b></div><p>{dashboard?.subscription.expiresAt ? `تاریخ انقضا: ${date(dashboard.subscription.expiresAt)}` : 'برای فعال‌سازی یا تمدید اشتراک با مدیر سامانه تماس بگیر.'}</p><small>پس از انقضای اشتراک، ربات به پیام‌ها پاسخ نمی‌دهد؛ اطلاعات و گفتگوهای ذخیره‌شده حذف نخواهند شد.</small></div></section>}

          {!loading && active === 'تنظیمات' && <section className="panel page-panel"><div className="panel-heading"><div><h2>تنظیمات پنل و ربات</h2><p>ترجیحات پنل و نحوه دریافت پیام‌های بازدیدکنندگان</p></div><Settings className="muted-icon"/></div><div className="settings-row"><div><b>دریافت پیام بازدیدکنندگان</b><p>با روشن بودن این گزینه، پیام‌های بازدیدکنندگان رباتت به ربات مرکزی ارسال می‌شود و می‌توانی با Reply به آن‌ها پاسخ بدهی.</p></div><button type="button" role="switch" aria-checked={menuAppearance.visitor_messages_enabled} aria-label="دریافت پیام بازدیدکنندگان" className={'visitor-toggle' + (menuAppearance.visitor_messages_enabled ? ' is-on' : '')} disabled={busy || !bot} onClick={() => toggleVisitorMessages(!menuAppearance.visitor_messages_enabled)}><span className="visitor-toggle-thumb"/><span className="visitor-toggle-state">{menuAppearance.visitor_messages_enabled ? 'روشن' : 'خاموش'}</span></button></div><div className="settings-row"><div><b>پوسته پنل</b><p>حالت روشن یا تاریک رابط کاربری</p></div><button className="outline-btn" onClick={() => setDark(!dark)}>{dark ? <Sun size={16}/> : <Moon size={16}/>} تغییر به حالت {dark ? 'روشن' : 'تاریک'}</button></div><div className="settings-row"><div><b>امنیت توکن</b><p>توکن ربات در سمت سرور با AES-256-GCM رمزنگاری می‌شود.</p></div><ShieldCheck color="#43c99a"/></div>{!bot && <div className="empty-inline">برای تنظیم دریافت پیام، ابتدا ربات تلگرامت را متصل کن.</div>}</section>}

          <div className="bottom-note"><ShieldCheck size={17}/><span>اطلاعات ربات‌ها به‌صورت رمزنگاری‌شده نگهداری می‌شوند.</span><span className="note-link">امنیت و حریم خصوصی</span></div>
        </div>
      </main>

      {showConnect && <div className="modal-backdrop" onClick={() => setShowConnect(false)}><div className="modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setShowConnect(false)}>×</button><div className="modal-icon"><Bot size={24}/></div><h2>اتصال ربات تلگرام</h2><p>توکن دریافتی از BotFather را وارد کن. ابتدا توکن توسط تلگرام بررسی و سپس webhook امن ثبت می‌شود.</p><form onSubmit={connectBot}><label htmlFor="bot-token">توکن ربات</label><input id="bot-token" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="توکن ربات تلگرام" autoComplete="off" required/><div className="security-hint"><ShieldCheck size={16}/> توکن فقط روی سرور رمزنگاری و ذخیره می‌شود.</div><button className="primary-btn full" type="submit" disabled={busy || !token.trim()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>} {busy ? 'در حال اتصال...' : 'اعتبارسنجی و اتصال ربات'}</button></form></div></div>}
    </div>
  )
}

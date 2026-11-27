import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity, Bot, CalendarClock, ChevronDown, CircleHelp, Command, LayoutDashboard,
  MessageCircle, Moon, MoreHorizontal, Plus, Search, Send, Settings, ShieldCheck,
  Sun, Users, Zap, RefreshCw, Trash2, Power, X, LoaderCircle
} from 'lucide-react'

type BotInfo = { id: string; username: string | null; display_name: string | null; status: string; last_error?: string | null; connected_at?: string | null }
type Dashboard = { bot: BotInfo | null; visitors: number; openConversations: number; unreadMessages: number; activeAutoReplies: number; subscription: { active: boolean; expiresAt: string | null } }
type Conversation = { id: string; status: string; unread_count: number; last_message_at: string | null; username: string | null; first_name: string | null; last_name: string | null; telegram_user_id: string; last_message: string | null }
type Message = { id: string; direction: string; sender_type: string; text_body: string | null; delivery_status: string; created_at: string }
type Visitor = { id: string; telegram_user_id: string; username: string | null; first_name: string | null; last_name: string | null; language_code: string | null; first_seen_at: string; last_seen_at: string; conversations: number }
type Rule = { id: string; trigger_text: string; reply_text: string; match_type: string; is_enabled: boolean; created_at: string }
type Page = 'نمای کلی' | 'گفتگوها' | 'بازدیدکنندگان' | 'پاسخ‌های خودکار' | 'مدیریت ربات' | 'اشتراک و اعتبار' | 'تنظیمات'
type NavItem = { label: Page; icon: typeof LayoutDashboard }
const nav: NavItem[] = [
  { label: 'نمای کلی', icon: LayoutDashboard }, { label: 'گفتگوها', icon: MessageCircle },
  { label: 'بازدیدکنندگان', icon: Users }, { label: 'پاسخ‌های خودکار', icon: Zap },
]
const tools: NavItem[] = [
  { label: 'مدیریت ربات', icon: Bot }, { label: 'اشتراک و اعتبار', icon: CalendarClock },
  { label: 'تنظیمات', icon: Settings },
]
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'درخواست انجام نشد.')
  return data as T
}
const date = (value?: string | null) => value ? new Date(value).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const fullName = (item: { first_name?: string | null; last_name?: string | null; username?: string | null }) => [item.first_name, item.last_name].filter(Boolean).join(' ') || (item.username ? '@' + item.username : 'کاربر تلگرام')

export default function App() {
  const [dark, setDark] = useState(true)
  const [active, setActive] = useState<Page>('نمای کلی')
  const [mobileNav, setMobileNav] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [bot, setBot] = useState<BotInfo | null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [token, setToken] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState('')
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [trigger, setTrigger] = useState('')
  const [replyText, setReplyText] = useState('')
  const [matchType, setMatchType] = useState('contains')

  const refreshDashboard = useCallback(async () => {
    const [dash, botData] = await Promise.all([api<Dashboard>('/api/dashboard'), api<{ bots: BotInfo[] }>('/api/bots')])
    setDashboard(dash)
    setBot(botData.bots[0] ?? null)
  }, [])

  const refreshPage = useCallback(async () => {
    setError('')
    try {
      if (active === 'نمای کلی' || active === 'مدیریت ربات' || active === 'اشتراک و اعتبار') await refreshDashboard()
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطا در دریافت اطلاعات')
    }
  }, [active, refreshDashboard])

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
    'اشتراک و اعتبار': 'وضعیت اشتراک و زمان اعتبار حساب.',
    'تنظیمات': 'تنظیمات پایه پنل و حساب کاربری.',
  }

  return (
    <div className={dark ? 'app dark' : 'app light'}>
      <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
        <div className="brand"><div className="brand-mark"><Bot size={22} /></div><div><b>تلگرام‌یار</b><small>پنل مدیریت ربات</small></div></div>
        <div className="workspace"><div className="workspace-avatar">T</div><div><b>فضای کاری من</b><small>حساب مدیریت</small></div><ChevronDown size={16} /></div>
        <div className="nav-label">منوی اصلی</div>
        <nav>{nav.map(({label, icon: Icon}) => <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => changePage(label)}><Icon size={18}/><span>{label}</span>{label === 'گفتگوها' && dashboard?.unreadMessages ? <i className="nav-count">{dashboard.unreadMessages}</i> : null}</button>)}</nav>
        <div className="nav-label second">مدیریت</div>
        <nav>{tools.map(({label, icon: Icon}) => <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => changePage(label)}><Icon size={18}/><span>{label}</span></button>)}</nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={18}/></div><b>راهنمای شروع</b><p>برای اتصال ربات، از BotFather توکن بگیر و در بخش مدیریت ربات وارد کن.</p><button onClick={() => changePage('مدیریت ربات')}>مدیریت ربات <span>←</span></button></div><div className="profile"><div className="profile-avatar">A</div><div><b>حساب کاربری</b><small>پنل اختصاصی</small></div><MoreHorizontal size={19}/></div></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="top-left"><button className="mobile-menu icon-btn" onClick={() => setMobileNav(!mobileNav)}><Command size={19}/></button><div className="breadcrumb">فضای کاری <span>/</span> <b>{active}</b></div></div><div className="top-actions"><div className="searchbox"><Search size={16}/><input placeholder="جستجو..." /></div><button className="icon-btn theme-btn" aria-label="تغییر پوسته" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="icon-btn" aria-label="بارگذاری مجدد" onClick={() => { setLoading(true); refreshPage().finally(() => setLoading(false)) }}><RefreshCw size={16}/></button><div className="top-avatar">A</div></div></header>

        <div className="content">
          <div className="page-heading"><div><div className="eyebrow"><span className="pulse"/> پنل مدیریت</div><h1>{title}</h1><p>{pageDescription[active]}</p></div>{active !== 'اشتراک و اعتبار' && active !== 'تنظیمات' && <button className="primary-btn" onClick={() => active === 'پاسخ‌های خودکار' ? document.getElementById('new-rule-trigger')?.focus() : setShowConnect(true)}><Plus size={18}/>{active === 'پاسخ‌های خودکار' ? 'افزودن پاسخ' : 'اتصال ربات جدید'}</button>}</div>
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

          {!loading && active === 'مدیریت ربات' && <section className="panel page-panel"><div className="panel-heading"><div><h2>مدیریت اتصال ربات</h2><p>توکن ربات به‌صورت رمزنگاری‌شده نگهداری می‌شود.</p></div><Bot className="muted-icon"/></div>{bot ? <div className="detail-card"><div className="detail-icon"><Bot size={27}/></div><div className="detail-main"><b>{bot.display_name || 'ربات تلگرام'}</b><span dir="ltr">@{bot.username || '—'}</span><small>شناسه: {bot.id}</small></div><span className={bot.status === 'active' ? 'status-pill good' : 'status-pill'}>{bot.status === 'active' ? 'فعال' : bot.status}</span><button className="danger-btn" disabled={busy || bot.status === 'disabled'} onClick={disableBot}><Power size={15}/> غیرفعال‌سازی</button></div> : <div className="empty-inline"><Bot size={30}/><b>هنوز رباتی متصل نیست</b><p>توکن ربات را از BotFather دریافت کن و اتصال را انجام بده.</p><button className="primary-btn" onClick={() => setShowConnect(true)}><Plus size={17}/> اتصال ربات</button></div>}</section>}

          {!loading && active === 'گفتگوها' && <section className="panel page-panel"><div className="panel-heading"><div><h2>صندوق گفتگوها</h2><p>{conversations.length.toLocaleString('fa-IR')} گفتگو</p></div><MessageCircle className="muted-icon"/></div>{!bot ? <div className="empty-inline"><Bot size={30}/><b>ابتدا رباتت را متصل کن</b></div> : <div className="conversation-layout"><div className="conversation-list">{conversations.length ? conversations.map(item => <button key={item.id} className={selectedConversation === item.id ? 'conversation-item selected' : 'conversation-item'} onClick={() => setSelectedConversation(item.id)}><span className="visitor-avatar">{(item.first_name || item.username || '؟').slice(0,1)}</span><span className="conversation-meta"><b>{fullName(item)}</b><small>{item.last_message || 'بدون متن'}</small><time>{date(item.last_message_at)}</time></span>{item.unread_count > 0 && <i className="unread-pill">{item.unread_count}</i>}</button>) : <div className="empty-inline">هنوز گفتگویی ثبت نشده است.</div>}</div><div className="message-pane">{selectedConversation ? <><div className="message-list">{messages.map(message => <div key={message.id} className={message.direction === 'outbound' ? 'message-bubble outgoing' : 'message-bubble'}><p>{message.text_body || 'پیام غیرمتنی'}</p><time>{date(message.created_at)}</time></div>)}</div><form className="reply-form" onSubmit={sendReply}><input value={reply} onChange={e => setReply(e.target.value)} placeholder="پیامت را بنویس..." maxLength={4096}/><button className="primary-btn" disabled={busy || !reply.trim()}><Send size={16}/> ارسال</button></form></> : <div className="empty-inline"><MessageCircle size={30}/><span>برای مشاهده پیام‌ها یک گفتگو را انتخاب کن.</span></div>}</div></div>}</section>}

          {!loading && active === 'بازدیدکنندگان' && <section className="panel page-panel"><div className="panel-heading"><div><h2>بازدیدکنندگان</h2><p>{visitors.length.toLocaleString('fa-IR')} نفر اخیر</p></div><Users className="muted-icon"/></div><div className="table-wrap"><table className="data-table"><thead><tr><th>کاربر</th><th>شناسه تلگرام</th><th>زبان</th><th>گفتگوها</th><th>آخرین بازدید</th></tr></thead><tbody>{visitors.map(v => <tr key={v.id}><td>{fullName(v)}</td><td dir="ltr">{v.telegram_user_id}</td><td>{v.language_code || '—'}</td><td>{v.conversations.toLocaleString('fa-IR')}</td><td>{date(v.last_seen_at)}</td></tr>)}</tbody></table>{!visitors.length && <div className="empty-inline">هنوز بازدیدکننده‌ای ثبت نشده است. با ارسال /start به ربات، کاربران اینجا نمایش داده می‌شوند.</div>}</div></section>}

          {!loading && active === 'پاسخ‌های خودکار' && <section className="page-panel"><div className="panel rule-form-panel"><div className="panel-heading"><div><h2>افزودن پاسخ خودکار</h2><p>با تطبیق متن پیام کاربر، پاسخ تعیین‌شده ارسال می‌شود.</p></div><Zap className="muted-icon"/></div><form className="rule-form" onSubmit={addRule}><label>عبارت محرک<input id="new-rule-trigger" value={trigger} onChange={e => setTrigger(e.target.value)} placeholder="مثلاً قیمت" maxLength={200} required/></label><label>نوع تطبیق<select value={matchType} onChange={e => setMatchType(e.target.value)}><option value="contains">شامل عبارت باشد</option><option value="exact">دقیقاً برابر باشد</option><option value="starts_with">با عبارت شروع شود</option></select></label><label className="wide-field">متن پاسخ<textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="متن پاسخی که ربات ارسال می‌کند..." maxLength={4000} rows={3} required/></label><button className="primary-btn" disabled={busy || !trigger.trim() || !replyText.trim()}><Plus size={16}/> ثبت پاسخ</button></form></div><div className="panel rules-list"><div className="panel-heading"><div><h2>قوانین ثبت‌شده</h2><p>{rules.length.toLocaleString('fa-IR')} پاسخ خودکار</p></div></div>{rules.length ? rules.map(rule => <div className="rule-row" key={rule.id}><div className="rule-copy"><b>{rule.trigger_text}</b><p>{rule.reply_text}</p><small>{rule.match_type === 'exact' ? 'تطبیق دقیق' : rule.match_type === 'starts_with' ? 'شروع با عبارت' : 'شامل عبارت'}</small></div><label className="switch-label"><input type="checkbox" checked={rule.is_enabled} onChange={() => toggleRule(rule)}/><span>{rule.is_enabled ? 'فعال' : 'غیرفعال'}</span></label><button className="icon-btn delete-btn" aria-label="حذف قانون" onClick={() => deleteRule(rule.id)}><Trash2 size={16}/></button></div>) : <div className="empty-inline">هنوز پاسخی تعریف نشده است.</div>}</div></section>}

          {!loading && active === 'اشتراک و اعتبار' && <section className="panel page-panel"><div className="panel-heading"><div><h2>اشتراک حساب</h2><p>وضعیت فعلی دسترسی به امکانات ربات</p></div><CalendarClock className="muted-icon"/></div><div className="subscription-card"><div className={dashboard?.subscription.active ? 'subscription-status active' : 'subscription-status'}><ShieldCheck size={26}/><b>{dashboard?.subscription.active ? 'اشتراک فعال است' : 'اشتراک فعال ندارید'}</b></div><p>{dashboard?.subscription.expiresAt ? `تاریخ انقضا: ${date(dashboard.subscription.expiresAt)}` : 'برای فعال‌سازی یا تمدید اشتراک با مدیر سامانه تماس بگیر.'}</p><small>پس از انقضای اشتراک، ربات به پیام‌ها پاسخ نمی‌دهد؛ اطلاعات و گفتگوهای ذخیره‌شده حذف نخواهند شد.</small></div></section>}

          {!loading && active === 'تنظیمات' && <section className="panel page-panel"><div className="panel-heading"><div><h2>تنظیمات پنل</h2><p>ترجیحات نمایشی این مرورگر</p></div><Settings className="muted-icon"/></div><div className="settings-row"><div><b>پوسته پنل</b><p>حالت روشن یا تاریک رابط کاربری</p></div><button className="outline-btn" onClick={() => setDark(!dark)}>{dark ? <Sun size={16}/> : <Moon size={16}/>} تغییر به حالت {dark ? 'روشن' : 'تاریک'}</button></div><div className="settings-row"><div><b>امنیت توکن</b><p>توکن ربات در سمت سرور با AES-256-GCM رمزنگاری می‌شود.</p></div><ShieldCheck color="#43c99a"/></div></section>}

          <div className="bottom-note"><ShieldCheck size={17}/><span>اطلاعات ربات‌ها به‌صورت رمزنگاری‌شده نگهداری می‌شوند.</span><span className="note-link">امنیت و حریم خصوصی</span></div>
        </div>
      </main>

      {showConnect && <div className="modal-backdrop" onClick={() => setShowConnect(false)}><div className="modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setShowConnect(false)}>×</button><div className="modal-icon"><Bot size={24}/></div><h2>اتصال ربات تلگرام</h2><p>توکن دریافتی از BotFather را وارد کن. ابتدا توکن توسط تلگرام بررسی و سپس webhook امن ثبت می‌شود.</p><form onSubmit={connectBot}><label htmlFor="bot-token">توکن ربات</label><input id="bot-token" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="توکن ربات تلگرام" autoComplete="off" required/><div className="security-hint"><ShieldCheck size={16}/> توکن فقط روی سرور رمزنگاری و ذخیره می‌شود.</div><button className="primary-btn full" type="submit" disabled={busy || !token.trim()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>} {busy ? 'در حال اتصال...' : 'اعتبارسنجی و اتصال ربات'}</button></form></div></div>}
    </div>
  )
}

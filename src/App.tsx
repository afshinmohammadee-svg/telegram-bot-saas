import { useState } from 'react'
import {
  Activity, Bot, CalendarClock, ChevronDown, CircleHelp, Command, LayoutDashboard,
  MessageCircle, Moon, MoreHorizontal, Plus, Search, Send, Settings, ShieldCheck,
  Sun, Users, Zap
} from 'lucide-react'

type NavItem = { label: string; icon: typeof LayoutDashboard }
const nav: NavItem[] = [
  { label: 'نمای کلی', icon: LayoutDashboard },
  { label: 'گفتگوها', icon: MessageCircle },
  { label: 'بازدیدکنندگان', icon: Users },
  { label: 'پاسخ‌های خودکار', icon: Zap },
]
const tools: NavItem[] = [
  { label: 'مدیریت ربات', icon: Bot },
  { label: 'اشتراک و اعتبار', icon: CalendarClock },
  { label: 'تنظیمات', icon: Settings },
]

export default function App() {
  const [dark, setDark] = useState(true)
  const [active, setActive] = useState('نمای کلی')
  const [showConnect, setShowConnect] = useState(false)
  const [token, setToken] = useState('')
  const [notice, setNotice] = useState('')
  const [mobileNav, setMobileNav] = useState(false)

  function submitConnect(e: React.FormEvent) {
    e.preventDefault()
    setNotice('اتصال ربات در این نسخه هنوز فعال نشده است. زیرساخت امن اتصال در مرحله بعد تکمیل می‌شود.')
    setToken('')
  }

  return (
    <div className={dark ? 'app dark' : 'app light'}>
      <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
        <div className="brand"><div className="brand-mark"><Bot size={22} /></div><div><b>تلگرام‌یار</b><small>پنل مدیریت ربات</small></div></div>
        <div className="workspace"><div className="workspace-avatar">T</div><div><b>فضای کاری من</b><small>حساب مدیریت</small></div><ChevronDown size={16} /></div>
        <div className="nav-label">منوی اصلی</div>
        <nav>{nav.map(({label, icon: Icon}) => <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => {setActive(label); setMobileNav(false)}}><Icon size={18}/><span>{label}</span>{label === 'گفتگوها' && <i className="nav-dot"/>}</button>)}</nav>
        <div className="nav-label second">مدیریت</div>
        <nav>{tools.map(({label, icon: Icon}) => <button key={label} className={active === label ? 'nav-item active' : 'nav-item'} onClick={() => {setActive(label); setMobileNav(false)}}><Icon size={18}/><span>{label}</span></button>)}</nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={18}/></div><b>به راهنمایی نیاز داری؟</b><p>راهنمای شروع و پاسخ به پرسش‌های متداول</p><button onClick={() => setNotice('راهنمای محصول به‌زودی در دسترس قرار می‌گیرد.')}>مشاهده راهنما <span>←</span></button></div><div className="profile"><div className="profile-avatar">A</div><div><b>مدیر حساب</b><small>مدیریت کل</small></div><MoreHorizontal size={19}/></div></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="top-left"><button className="mobile-menu icon-btn" onClick={() => setMobileNav(!mobileNav)}><Command size={19}/></button><div className="breadcrumb">فضای کاری <span>/</span> <b>{active}</b></div></div><div className="top-actions"><div className="searchbox"><Search size={16}/><input placeholder="جستجو..." /></div><button className="icon-btn theme-btn" aria-label="تغییر پوسته" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><div className="top-avatar">A</div></div></header>

        <div className="content">
          <div className="page-heading"><div><div className="eyebrow"><span className="pulse"/> پنل مدیریت</div><h1>سلام، خوش اومدی 👋</h1><p>وضعیت ربات‌ها و گفتگوهای خودت رو از اینجا مدیریت کن.</p></div><button className="primary-btn" onClick={() => setShowConnect(true)}><Plus size={18}/> اتصال ربات جدید</button></div>
          {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}
          <section className="stats-grid">
            <div className="stat-card"><div className="stat-top"><span>ربات‌های فعال</span><span className="stat-icon purple"><Bot size={18}/></span></div><div className="stat-value">۰ <small>ربات</small></div><div className="stat-foot">هنوز رباتی متصل نشده</div></div>
            <div className="stat-card"><div className="stat-top"><span>کل بازدیدکنندگان</span><span className="stat-icon blue"><Users size={18}/></span></div><div className="stat-value">۰ <small>نفر</small></div><div className="stat-foot">از زمان شروع فعالیت</div></div>
            <div className="stat-card"><div className="stat-top"><span>گفتگوهای باز</span><span className="stat-icon green"><MessageCircle size={18}/></span></div><div className="stat-value">۰ <small>گفتگو</small></div><div className="stat-foot">نیازمند پاسخ</div></div>
            <div className="stat-card"><div className="stat-top"><span>وضعیت اشتراک</span><span className="stat-icon amber"><ShieldCheck size={18}/></span></div><div className="stat-value status-value">در انتظار فعال‌سازی</div><div className="stat-foot">برای اطلاعات بیشتر با مدیر تماس بگیر</div></div>
          </section>

          <section className="section-grid">
            <div className="panel bot-panel"><div className="panel-heading"><div><h2>ربات من</h2><p>مدیریت اتصال و وضعیت ربات تلگرام</p></div><button className="more-btn"><MoreHorizontal size={20}/></button></div><div className="empty-state"><div className="empty-illustration"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="bot-illustration"><Bot size={34}/></div><span className="spark spark-a">✦</span><span className="spark spark-b">✧</span></div><h3>هنوز رباتی متصل نکردی</h3><p>برای شروع، توکن ربات تلگرام خودت رو وارد کن تا بتونی گفتگوها و بازدیدکننده‌ها رو مدیریت کنی.</p><button className="outline-btn" onClick={() => setShowConnect(true)}><Plus size={17}/> اتصال اولین ربات</button></div></div>
            <div className="panel activity-panel"><div className="panel-heading"><div><h2>فعالیت‌های اخیر</h2><p>آخرین رویدادهای حساب کاربری</p></div><Activity size={19} className="muted-icon"/></div><div className="activity-empty"><div className="activity-icon"><Activity size={21}/></div><b>هنوز فعالیتی ثبت نشده</b><span>بعد از اتصال ربات، رویدادها اینجا نمایش داده می‌شن.</span></div><div className="activity-footer"><span className="live-dot"/> همگام‌سازی خودکار پس از اتصال فعال می‌شود</div></div>
          </section>
          <div className="bottom-note"><ShieldCheck size={17}/><span>اطلاعات ربات‌ها به‌صورت رمزنگاری‌شده نگهداری می‌شوند.</span><span className="note-link">امنیت و حریم خصوصی</span></div>
        </div>
      </main>

      {showConnect && <div className="modal-backdrop" onClick={() => setShowConnect(false)}><div className="modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setShowConnect(false)}>×</button><div className="modal-icon"><Bot size={24}/></div><h2>اتصال ربات تلگرام</h2><p>توکن دریافتی از BotFather را وارد کن. اتصال امن ربات در مرحله بعد فعال می‌شود.</p><form onSubmit={submitConnect}><label htmlFor="bot-token">توکن ربات</label><input id="bot-token" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="توکن ربات تلگرام" autoComplete="off" required/><div className="security-hint"><ShieldCheck size={16}/> توکن در این نسخه ذخیره یا ارسال نمی‌شود.</div><button className="primary-btn full" type="submit"><Send size={16}/> ادامه</button></form></div></div>}
    </div>
  )
}
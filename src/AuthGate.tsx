import { useState } from "react";
import type { FormEvent } from "react";
import { authClient } from "./lib/auth-client";
import { Bot, LogIn, LogOut, ShieldCheck, UserPlus } from "lucide-react";
import App from "./App";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role?: string;
};

export default function AuthGate() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [telegramLink, setTelegramLink] = useState("");
  const [created, setCreated] = useState("");

  const user = session?.user as AuthUser | undefined;
  const isSuperAdmin = user?.role === "super_admin";

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        const authError = result.error as unknown as Record<string, unknown>;
        const ownDetails = Object.fromEntries(
          Object.getOwnPropertyNames(result.error).map((key) => [key, authError[key]])
        );
        const details = [
          typeof authError.message === "string" ? authError.message : "",
          typeof authError.status === "number" ? `HTTP ${authError.status}` : "",
          typeof authError.statusText === "string" ? authError.statusText : "",
          typeof authError.code === "string" ? `کد: ${authError.code}` : "",
          Object.keys(ownDetails).length ? JSON.stringify(ownDetails) : "",
        ].filter(Boolean);
        setError(details.join(" | ") || "پاسخ ورود ناموفق بود اما جزئیات خطا خالی است؛ لطفاً دوباره تلاش کن.");
      } else {
        await refetch();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ارتباط با سرویس ورود برقرار نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function registerAccount(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signUp.email({ email: email.trim(), password, name: name.trim() });
      if (result.error) setError(result.error.message || "ثبت‌نام انجام نشد.");
      else { await refetch(); setEmail(""); setPassword(""); setName(""); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ثبت‌نام انجام نشد.");
    } finally { setBusy(false); }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCreated("");
    const result = await authClient.admin.createUser({
      email,
      password,
      name,
      role: "user",
    });
    if (result.error) {
      setError(result.error.message || "ساخت حساب انجام نشد.");
    } else {
      setCreated("حساب کاربر با موفقیت ساخته شد.");
      setEmail("");
      setPassword("");
      setName("");
    }
    setBusy(false);
  }

  if (isPending) {
    return <div className="auth-screen" dir="rtl"><div className="auth-card"><Bot/><p>در حال بررسی نشست امن...</p></div></div>;
  }

  if (!user) {
    return (
      <div className="auth-screen" dir="rtl">
        <form className="auth-card" onSubmit={showRegister ? registerAccount : signIn}>
          <div className="auth-brand"><span><Bot size={25}/></span><div><b>تلگرام‌یار</b><small>ورود امن به پنل مدیریت</small></div></div>
          <h1>خوش برگشتی</h1>
          <p className="auth-subtitle">{showRegister ? "حساب مشتری خودت را بساز و سپس تلگرام را به‌صورت امن متصل کن." : "برای ورود، ایمیل و رمز عبور حساب کاربری‌ات را وارد کن."}</p>
          {showRegister && <><label htmlFor="register-name">نام و نام خانوادگی</label><input id="register-name" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" required/></>}
          <label htmlFor="login-email">ایمیل</label>
          <input id="login-email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/>
          <label htmlFor="login-password">رمز عبور</label>
          <input id="login-password" type="password" autoComplete={showRegister ? "new-password" : "current-password"} minLength={showRegister ? 12 : undefined} value={password} onChange={e=>setPassword(e.target.value)} required/>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" disabled={busy}>{showRegister ? <UserPlus size={17}/> : <LogIn size={17}/>}{busy ? "در حال پردازش..." : showRegister ? "ایجاد حساب مشتری" : "ورود به پنل"}</button>
          <button type="button" className="auth-link-button" onClick={()=>{setShowRegister(v=>!v);setError("");setName("");}}>{showRegister ? "قبلاً حساب ساخته‌ای؟ ورود" : "مشتری جدید هستی؟ ثبت‌نام کن"}</button>
          <div className="auth-secure"><ShieldCheck size={16}/> ثبت‌نام فقط حساب مشتری با دسترسی عادی ایجاد می‌کند.</div>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="auth-session-bar" dir="rtl">
        <span><ShieldCheck size={16}/> وارد شده‌اید: <b>{user.name}</b></span>
        {!isSuperAdmin && <><button onClick={async()=>{setError("");try{const response=await fetch("/api/telegram/link-challenge",{method:"POST"});const data=await response.json();if(!response.ok)throw new Error(data.error||"ساخت لینک ناموفق بود.");setTelegramLink(data.url);}catch(cause){setError(cause instanceof Error?cause.message:"ساخت لینک اتصال ناموفق بود.");}}}><Bot size={16}/> اتصال حساب مشتری به تلگرام</button>}{telegramLink && !isSuperAdmin && <a className="auth-telegram-link" href={telegramLink} target="_blank" rel="noreferrer">باز کردن ربات مرکزی و تأیید اتصال</a>}{error && <span className="auth-inline-error" role="alert">{error}</span>}</>}
        {isSuperAdmin && <button onClick={()=>{setShowCreate(v=>!v);setError("");setCreated("");}}><UserPlus size={16}/> ایجاد حساب کاربر</button>}
        <button onClick={async()=>{await authClient.signOut();await refetch();}}><LogOut size={16}/> خروج امن</button>
      </div>
      {showCreate && isSuperAdmin && (
        <div className="auth-modal-backdrop" dir="rtl">
          <form className="auth-card auth-create-card" onSubmit={createAccount}>
            <button type="button" className="auth-modal-close" onClick={()=>setShowCreate(false)}>×</button>
            <h2>ایجاد حساب کاربر</h2>
            <p className="auth-subtitle">حساب جدید فقط با دسترسی مدیر کل ساخته می‌شود.</p>
            <label htmlFor="new-name">نام کاربر</label>
            <input id="new-name" value={name} onChange={e=>setName(e.target.value)} required/>
            <label htmlFor="new-email">ایمیل</label>
            <input id="new-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/>
            <label htmlFor="new-password">رمز عبور موقت (حداقل ۱۲ کاراکتر)</label>
            <input id="new-password" type="password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required/>
            {error && <div className="auth-error" role="alert">{error}</div>}
            {created && <div className="auth-success" role="status">{created}</div>}
            <button className="auth-submit" disabled={busy}><UserPlus size={17}/>{busy ? "در حال ساخت..." : "ساخت حساب"}</button>
          </form>
        </div>
      )}
      <App isSuperAdmin={isSuperAdmin}/>
    </>
  );
}

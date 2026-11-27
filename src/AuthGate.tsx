import { FormEvent, useState } from "react";
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
  const [created, setCreated] = useState("");

  const user = session?.user as AuthUser | undefined;
  const isSuperAdmin = user?.role === "super_admin";

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await authClient.signIn.email({ email, password });
    if (result.error) setError("ایمیل یا رمز عبور صحیح نیست.");
    else await refetch();
    setBusy(false);
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
        <form className="auth-card" onSubmit={signIn}>
          <div className="auth-brand"><span><Bot size={25}/></span><div><b>تلگرام‌یار</b><small>ورود امن به پنل مدیریت</small></div></div>
          <h1>خوش برگشتی</h1>
          <p className="auth-subtitle">برای ورود، ایمیل و رمز عبور حسابی را وارد کن که مدیر کل ساخته است.</p>
          <label htmlFor="login-email">ایمیل</label>
          <input id="login-email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/>
          <label htmlFor="login-password">رمز عبور</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" disabled={busy}><LogIn size={17}/>{busy ? "در حال ورود..." : "ورود به پنل"}</button>
          <div className="auth-secure"><ShieldCheck size={16}/> ثبت‌نام عمومی غیرفعال است.</div>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="auth-session-bar" dir="rtl">
        <span><ShieldCheck size={16}/> وارد شده‌اید: <b>{user.name}</b></span>
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
      <App/>
    </>
  );
}

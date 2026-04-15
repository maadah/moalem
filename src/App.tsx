// Smart Grader - AI Powered Exam System (Netlify Optimized)
import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Trash2, Save, FileText, Upload, CheckCircle, 
  XCircle, ChevronDown, ChevronUp, Download, LogIn, 
  LogOut, Loader2, FileUp, List, Settings, User,
  HelpCircle, CheckSquare, Type, LayoutGrid, Image as ImageIcon,
  ArrowRight, Calendar, Folder, FolderOpen, Users, Camera
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, addDoc, query, where, onSnapshot, 
  serverTimestamp, doc, updateDoc, deleteDoc, getDoc, setDoc,
  getDocFromServer
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { Question, gradeStudentPaper, extractExamFromImages } from './services/geminiService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "حدث خطأ غير متوقع في التطبيق.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) {
          errorMessage = `خطأ في قاعدة البيانات: ${parsed.error}`;
        }
      } catch (e) {}

      return (
        <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4 text-center" dir="rtl">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-200">
            <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-stone-900 mb-2">عذراً، حدث خطأ</h2>
            <p className="text-stone-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-stone-900 text-white py-3 rounded-xl font-medium hover:bg-stone-800 transition-colors"
            >
              إعادة تحميل الصفحة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

type View = 'dashboard' | 'create-exam' | 'grade-papers' | 'results' | 'admin';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  status: 'pending' | 'approved' | 'rejected';
  role: 'admin' | 'user';
  pageLimit: number;
  pagesUsed: number;
  createdAt: any;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExam, setSelectedExam] = useState<any>(null);
  const [editingExam, setEditingExam] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Firestore is offline. Check configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      try {
        setUser(u);
        if (u) {
          // Fetch or create user profile
          const userDocRef = doc(db, 'users', u.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (userDoc.exists()) {
            setUserProfile(userDoc.data() as UserProfile);
          } else {
            const newProfile: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || '',
              status: u.email === 'asmaomar5566@gmail.com' ? 'approved' : 'pending',
              role: u.email === 'asmaomar5566@gmail.com' ? 'admin' : 'user',
              pageLimit: 500,
              pagesUsed: 0,
              createdAt: serverTimestamp()
            };
            await setDoc(userDocRef, newProfile);
            setUserProfile(newProfile);
          }
        } else {
          setUserProfile(null);
        }
      } catch (error) {
        console.error("Auth state error:", error);
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setUserProfile(snapshot.data() as UserProfile);
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user || userProfile?.status !== 'approved') return;
    const q = query(collection(db, 'exams'), where('authorUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setExams(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error("Exams snapshot error:", error));
    return () => unsubscribe();
  }, [user, userProfile?.status]);

  useEffect(() => {
    if (!user || userProfile?.status !== 'approved') return;
    const q = query(collection(db, 'results'), where('authorUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setResults(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error("Results snapshot error:", error));
    return () => unsubscribe();
  }, [user, userProfile?.status]);

  useEffect(() => {
    if (!user || userProfile?.status !== 'approved') return;
    const q = query(collection(db, 'sessions'), where('authorUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSessions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => console.error("Sessions snapshot error:", error));
    return () => unsubscribe();
  }, [user, userProfile?.status]);

  const login = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // Ensure we use popup for better compatibility with iframes
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.code === 'auth/unauthorized-domain') {
        alert("خطأ: هذا النطاق غير مصرح به في إعدادات Firebase. يرجى التأكد من إضافة رابط المعاينة الحالي في Firebase Console > Authentication > Settings > Authorized domains.");
      } else {
        alert("حدث خطأ أثناء تسجيل الدخول: " + error.message);
      }
    }
  };

  const logout = () => signOut(auth);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-200 text-center"
        >
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <FileText className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold text-stone-900 mb-2 font-serif italic">المصحح الذكي</h1>
          <p className="text-stone-500 mb-8">نظام ذكي لتصحيح أوراق الطلاب المكتوبة بخط اليد</p>
          <button 
            onClick={login}
            className="w-full bg-stone-900 text-white py-4 rounded-2xl font-medium flex items-center justify-center gap-2 hover:bg-stone-800 transition-colors"
          >
            <LogIn className="w-5 h-5" />
            تسجيل الدخول باستخدام جوجل
          </button>
        </motion.div>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-emerald-600 mx-auto" />
          <p className="text-stone-500">جاري تحميل ملف المستخدم...</p>
          <button onClick={logout} className="text-stone-400 hover:text-red-500 transition-colors text-sm underline">
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  if (userProfile.status === 'pending') {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4" dir="rtl">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg w-full bg-white p-10 rounded-3xl shadow-xl border border-stone-200 text-center space-y-6"
        >
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <Loader2 className="w-10 h-10 text-amber-600 animate-spin" />
          </div>
          <h2 className="text-2xl font-bold text-stone-900">طلبك قيد المراجعة</h2>
          <p className="text-stone-600 leading-relaxed">
            مرحباً بك في المصحح الذكي. حسابك حالياً قيد الانتظار لحين موافقة مسؤول المشروع.
            <br />
            يرجى التواصل مع الإدارة لتفعيل حسابك وتحديد باقة الصفحات الخاصة بك.
          </p>
          
          <div className="bg-stone-50 p-6 rounded-2xl space-y-4 border border-stone-100">
            <p className="font-bold text-stone-700">للتواصل والتفعيل:</p>
            <div className="flex flex-col gap-3">
              <a 
                href="tel:07706118992" 
                className="flex items-center justify-center gap-2 text-emerald-600 font-bold text-xl hover:underline"
              >
                07706118992
              </a>
              <a 
                href="https://wa.me/9647706118992" 
                target="_blank" 
                rel="noreferrer"
                className="bg-emerald-500 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors"
              >
                تواصل عبر واتساب
              </a>
            </div>
          </div>

          <button onClick={logout} className="text-stone-400 hover:text-red-500 transition-colors text-sm">
            تسجيل الخروج
          </button>
        </motion.div>
      </div>
    );
  }

  if (userProfile.status === 'rejected') {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4" dir="rtl">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-200 text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-stone-900 mb-2">تم رفض الطلب</h2>
          <p className="text-stone-500 mb-6">عذراً، تم رفض طلب انضمامك للمشروع. يرجى التواصل مع الإدارة للمزيد من التفاصيل.</p>
          <button onClick={logout} className="w-full bg-stone-900 text-white py-3 rounded-xl font-medium">
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans" dir="rtl">
      {/* Navigation */}
      <nav className="bg-white border-b border-stone-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 
              className="text-xl font-bold font-serif italic cursor-pointer"
              onClick={() => setView('dashboard')}
            >
              المصحح الذكي
            </h1>
            <div className="hidden md:flex items-center gap-4">
              <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<LayoutGrid className="w-4 h-4" />} label="لوحة التحكم" />
              <NavButton active={view === 'create-exam'} onClick={() => setView('create-exam')} icon={<Plus className="w-4 h-4" />} label="إنشاء امتحان" />
              <NavButton active={view === 'results'} onClick={() => setView('results')} icon={<List className="w-4 h-4" />} label="النتائج" />
              {userProfile?.role === 'admin' && (
                <NavButton active={view === 'admin'} onClick={() => setView('admin')} icon={<Users className="w-4 h-4" />} label="الإدارة" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden lg:flex flex-col items-end mr-2">
              <span className="text-[10px] text-stone-400">استهلاك الصفحات</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all",
                      (userProfile?.pagesUsed || 0) / (userProfile?.pageLimit || 1) > 0.9 ? "bg-red-500" : "bg-emerald-500"
                    )}
                    style={{ width: `${Math.min(100, ((userProfile?.pagesUsed || 0) / (userProfile?.pageLimit || 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-stone-600">{userProfile?.pagesUsed} / {userProfile?.pageLimit}</span>
              </div>
            </div>
            <button 
              onClick={() => {
                if(confirm('هل تريد مسح مفتاح API المحفوظ؟ سيطلب منك التطبيق إدخاله مرة أخرى عند التصحيح القادم.')) {
                  localStorage.removeItem('GEMINI_API_KEY_FALLBACK');
                  alert('تم مسح المفتاح بنجاح.');
                }
              }}
              className="p-2 text-stone-400 hover:text-emerald-600 transition-colors"
              title="إعادة تعيين مفتاح API"
            >
              <Settings className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 rounded-full">
              <img src={user.photoURL || ''} alt="" className="w-6 h-6 rounded-full" />
              <span className="text-sm font-medium">{user.displayName}</span>
            </div>
            <button onClick={logout} className="p-2 text-stone-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <Dashboard 
              exams={exams} 
              onNewExam={() => { setEditingExam(null); setView('create-exam'); }} 
              onGrade={(exam) => { setSelectedExam(exam); setView('grade-papers'); }}
              onEditExam={(exam) => { setEditingExam(exam); setView('create-exam'); }}
              onDeleteExam={async (id) => { if(confirm('هل أنت متأكد من حذف هذا الامتحان؟')) await deleteDoc(doc(db, 'exams', id)); }}
            />
          )}
          {view === 'create-exam' && (
            <ExamCreator 
              user={user} 
              userProfile={userProfile}
              initialData={editingExam}
              onSave={() => { setEditingExam(null); setView('dashboard'); }} 
              onCancel={() => { setEditingExam(null); setView('dashboard'); }} 
            />
          )}
          {view === 'grade-papers' && (
            <Grader 
              user={user}
              userProfile={userProfile}
              exam={selectedExam} 
              onComplete={() => setView('results')}
              onCancel={() => setView('dashboard')}
            />
          )}
          {view === 'results' && (
            <ResultsView 
              results={results} 
              sessions={sessions}
              exams={exams}
              onBack={() => setView('dashboard')}
            />
          )}
          {view === 'admin' && userProfile?.role === 'admin' && (
            <AdminDashboard />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function AdminDashboard() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => doc.data() as UserProfile));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const updateUserStatus = async (uid: string, status: 'approved' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'users', uid), { status });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const updateUserLimit = async (uid: string, limit: number) => {
    try {
      await updateDoc(doc(db, 'users', uid), { pageLimit: limit });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const deleteUser = async (uid: string) => {
    if (confirm('هل أنت متأكد من حذف هذا المستخدم نهائياً؟')) {
      try {
        await deleteDoc(doc(db, 'users', uid));
      } catch (e) {
        handleFirestoreError(e, OperationType.DELETE, `users/${uid}`);
      }
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>;

  const pendingUsers = users.filter(u => u.status === 'pending');
  const activeUsers = users.filter(u => u.status === 'approved' && u.role !== 'admin');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold font-serif italic">لوحة تحكم المدير</h2>
        <div className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-xl text-sm font-bold">
          إجمالي المستخدمين: {users.length}
        </div>
      </div>

      {pendingUsers.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-amber-600 flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            طلبات انضمام جديدة ({pendingUsers.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingUsers.map(u => (
              <div key={u.uid} className="bg-white p-6 rounded-3xl border border-amber-200 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center font-bold text-stone-400">
                    {u.displayName?.charAt(0) || u.email.charAt(0)}
                  </div>
                  <div>
                    <p className="font-bold">{u.displayName || 'بدون اسم'}</p>
                    <p className="text-xs text-stone-400">{u.email}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => updateUserStatus(u.uid, 'approved')}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors"
                  >
                    قبول
                  </button>
                  <button 
                    onClick={() => updateUserStatus(u.uid, 'rejected')}
                    className="bg-red-50 text-red-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-red-100 transition-colors"
                  >
                    رفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-xl font-bold">المستخدمين النشطين</h3>
        <div className="bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-sm">
          <table className="w-full text-right">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">المستخدم</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">الاستهلاك</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">الحد المسموح</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {activeUsers.map(u => (
                <tr key={u.uid} className="hover:bg-stone-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-stone-100 rounded-full flex items-center justify-center text-xs font-bold text-stone-400">
                        {u.displayName?.charAt(0) || u.email.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold">{u.displayName || 'بدون اسم'}</p>
                        <p className="text-[10px] text-stone-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full", u.pagesUsed / u.pageLimit > 0.9 ? "bg-red-500" : "bg-emerald-500")}
                          style={{ width: `${Math.min(100, (u.pagesUsed / u.pageLimit) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold">{u.pagesUsed} صفحة</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select 
                      value={u.pageLimit}
                      onChange={(e) => updateUserLimit(u.uid, Number(e.target.value))}
                      className="bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-200 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      {[500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000, 9000, 10000].map(val => (
                        <option key={val} value={val}>{val} صفحة</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => deleteUser(u.uid)}
                      className="text-red-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {activeUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-stone-400 text-sm italic">لا يوجد مستخدمين نشطين حالياً</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}

function ImageUpload({ 
  label, 
  value, 
  onChange, 
  onRemove,
  compact = false
}: { 
  label: string, 
  value?: string, 
  onChange: (base64: string) => void, 
  onRemove: () => void,
  compact?: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onChange(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className={cn("space-y-1", compact ? "w-12" : "w-full")}>
      {!compact && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-stone-400">{label}</span>
          {value && (
            <button 
              onClick={onRemove}
              className="text-[10px] text-red-500 hover:underline"
            >
              حذف
            </button>
          )}
        </div>
      )}
      {value ? (
        <div className="relative group/img">
          <img 
            src={value} 
            alt={label} 
            className={cn("object-cover rounded-lg border border-stone-200", compact ? "w-10 h-10" : "w-full h-24")}
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2 rounded-lg">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 bg-white/20 hover:bg-white/40 rounded-lg transition-colors"
              title="تغيير من الجهاز"
            >
              <ImageIcon className={cn("text-white", compact ? "w-3 h-3" : "w-5 h-5")} />
            </button>
            <button 
              onClick={() => cameraInputRef.current?.click()}
              className="p-1.5 bg-white/20 hover:bg-white/40 rounded-lg transition-colors"
              title="تغيير من الكاميرا"
            >
              <Camera className={cn("text-white", compact ? "w-3 h-3" : "w-5 h-5")} />
            </button>
          </div>
          {compact && (
            <button 
              onClick={onRemove}
              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover/img:opacity-100 transition-opacity"
            >
              <XCircle className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      ) : (
        <div className={cn("flex gap-2", compact ? "flex-col" : "flex-row")}>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed border-stone-200 rounded-lg flex items-center justify-center gap-2 text-stone-400 hover:border-emerald-500 hover:text-emerald-500 transition-all",
              compact ? "w-10 h-10" : "flex-1 h-10"
            )}
            title="رفع من الجهاز"
          >
            <ImageIcon className={cn(compact ? "w-3 h-3" : "w-4 h-4")} />
            {!compact && <span className="text-[10px]">الجهاز</span>}
          </button>
          <button 
            onClick={() => cameraInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed border-stone-200 rounded-lg flex items-center justify-center gap-2 text-stone-400 hover:border-emerald-500 hover:text-emerald-500 transition-all",
              compact ? "w-10 h-10" : "flex-1 h-10"
            )}
            title="فتح الكاميرا"
          >
            <Camera className={cn(compact ? "w-3 h-3" : "w-4 h-4")} />
            {!compact && <span className="text-[10px]">الكاميرا</span>}
          </button>
        </div>
      )}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={cameraInputRef} 
        onChange={handleFileChange} 
        accept="image/*" 
        capture="environment"
        className="hidden" 
      />
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all",
        active ? "bg-emerald-50 text-emerald-700" : "text-stone-500 hover:bg-stone-100"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Dashboard({ exams, onNewExam, onGrade, onEditExam, onDeleteExam }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif italic mb-1">مرحباً بك مجدداً</h2>
          <p className="text-stone-500">إليك الامتحانات التي قمت بإنشائها</p>
        </div>
        <button 
          onClick={onNewExam}
          className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-medium flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
        >
          <Plus className="w-5 h-5" />
          امتحان جديد
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {exams.map((exam: any) => (
          <div key={exam.id} className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow group">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center text-stone-600 group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
                <FileText className="w-6 h-6" />
              </div>
              <button onClick={() => onDeleteExam(exam.id)} className="p-2 text-stone-300 hover:text-red-500 transition-colors">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
            <h3 className="text-xl font-bold mb-2">{exam.title}</h3>
            <div className="flex items-center gap-4 text-sm text-stone-500 mb-6">
              <span className="flex items-center gap-1"><CheckSquare className="w-4 h-4" /> {exam.questions.length} أسئلة</span>
              <span className="flex items-center gap-1"><Settings className="w-4 h-4" /> الدرجة: {exam.totalGrade}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => onGrade(exam)}
                className="bg-stone-100 text-stone-900 py-3 rounded-xl font-medium hover:bg-emerald-600 hover:text-white transition-all flex items-center justify-center gap-2"
              >
                <FileUp className="w-4 h-4" />
                بدء التصحيح
              </button>
              <button 
                onClick={() => onEditExam(exam)}
                className="bg-stone-100 text-stone-900 py-3 rounded-xl font-medium hover:bg-stone-200 transition-all flex items-center justify-center gap-2"
              >
                <Settings className="w-4 h-4" />
                تعديل
              </button>
            </div>
          </div>
        ))}
        {exams.length === 0 && (
          <div className="col-span-full py-20 text-center bg-white rounded-3xl border-2 border-dashed border-stone-200">
            <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <HelpCircle className="w-8 h-8 text-stone-300" />
            </div>
            <p className="text-stone-400">لا توجد امتحانات حالياً. ابدأ بإنشاء أول امتحان لك!</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ExamCreator({ user, userProfile, initialData, onSave, onCancel }: any) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [duration, setDuration] = useState(initialData?.duration || '');
  const [study, setStudy] = useState(initialData?.study || 'الإعدادية / العلمي');
  const [round, setRound] = useState(initialData?.round || 'الدور الأول');
  const [totalGrade, setTotalGrade] = useState(initialData?.totalGrade || 100);
  const [requiredQuestionsCount, setRequiredQuestionsCount] = useState<number | null>(initialData?.requiredQuestionsCount || null);
  const [questions, setQuestions] = useState<Question[]>(initialData?.questions || []);
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [printMode, setPrintMode] = useState<'questions' | 'both'>('questions');
  const [extractionImages, setExtractionImages] = useState<string[]>([]);
  const extractionInputRef = useRef<HTMLInputElement>(null);
  const extractionCameraInputRef = useRef<HTMLInputElement>(null);
  const examPrintRef = useRef<HTMLDivElement>(null);
  const examFullPrintRef = useRef<HTMLDivElement>(null);

  const uploadImageToStorage = async (base64: string, path: string) => {
    if (!base64 || !base64.startsWith('data:image')) return base64;
    try {
      const storageRef = ref(storage, path);
      await uploadString(storageRef, base64, 'data_url');
      return await getDownloadURL(storageRef);
    } catch (error) {
      console.error('Error uploading image:', error);
      return base64; // Fallback to base64 if upload fails
    }
  };

  const processQuestionsForStorage = async (qs: Question[]): Promise<Question[]> => {
    const processed = [];
    for (const q of qs) {
      const newQ = { ...q };
      if (q.questionImage && q.questionImage.startsWith('data:image')) {
        newQ.questionImage = await uploadImageToStorage(q.questionImage, `exams/${user.uid}/${q.id}_q_${Date.now()}`);
      }
      if (q.answerImage && q.answerImage.startsWith('data:image')) {
        newQ.answerImage = await uploadImageToStorage(q.answerImage, `exams/${user.uid}/${q.id}_a_${Date.now()}`);
      }
      if (q.subQuestions) {
        newQ.subQuestions = await processQuestionsForStorage(q.subQuestions);
      }
      processed.push(newQ);
    }
    return processed;
  };

  const handleExtractionFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const readers = files.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      });

      Promise.all(readers).then(results => {
        setExtractionImages(prev => [...prev, ...results]);
      });
    }
  };

  const handleExtract = async () => {
    if (extractionImages.length === 0) return;
    setIsExtracting(true);
    try {
      // Get API key
      const urlParams = new URLSearchParams(window.location.search);
      const apiKey = urlParams.get('key') || localStorage.getItem('GEMINI_API_KEY_AUTO') || import.meta.env.VITE_GEMINI_API_KEY;
      
      if (!apiKey) {
        alert('يرجى توفير مفتاح API أولاً');
        return;
      }

      const result = await extractExamFromImages(extractionImages, apiKey);
      console.log('Extraction result:', result);
      
      if (result.title) setTitle(result.title);
      if (result.requiredQuestionsCount) setRequiredQuestionsCount(result.requiredQuestionsCount);
      
      if (result.questions && result.questions.length > 0) {
        // Update user pagesUsed
        if (userProfile) {
          try {
            await setDoc(doc(db, 'users', user.uid), {
              pagesUsed: (userProfile.pagesUsed || 0) + extractionImages.length
            }, { merge: true });
          } catch (e) {
            handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
          }
        }

        // Ensure all questions have IDs
        const ensureIds = (qs: Question[]): Question[] => {
          return qs.map(q => ({
            ...q,
            id: q.id || Math.random().toString(36).substr(2, 9),
            subQuestions: q.subQuestions ? ensureIds(q.subQuestions) : []
          }));
        };
        setQuestions(ensureIds(result.questions));
        alert('تم استخراج الأسئلة بنجاح');
      } else {
        alert('تمت المعالجة ولكن لم يتم العثور على أسئلة واضحة. يرجى التأكد من جودة الصورة.');
      }
      
      setExtractionImages([]);
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء استخراج الأسئلة');
    } finally {
      setIsExtracting(false);
    }
  };

  const addQuestion = () => {
    setQuestions([...questions, {
      id: Math.random().toString(36).substr(2, 9),
      text: '',
      answer: '',
      grade: 0,
      type: 'text',
      subQuestions: []
    }]);
  };

  const addSubQuestion = (parentId: string, subParentId?: string, style?: 'numbers' | 'letters') => {
    setQuestions(questions.map(q => {
      if (q.id === parentId) {
        if (subParentId) {
          // Level 3: Adding a point to a branch
          return {
            ...q,
            subQuestions: q.subQuestions?.map(sq => {
              if (sq.id === subParentId) {
                return {
                  ...sq,
                  subStyle: style || 'numbers',
                  subQuestions: [...(sq.subQuestions || []), {
                    id: Math.random().toString(36).substr(2, 9),
                    text: '',
                    answer: '',
                    grade: 0,
                    type: 'text'
                  }]
                };
              }
              return sq;
            })
          };
        }
        // Level 2: Adding a branch or point to a main question
        const subQs = q.subQuestions || [];
        return {
          ...q,
          subStyle: style || q.subStyle || 'numbers',
          subQuestions: [...subQs, {
            id: Math.random().toString(36).substr(2, 9),
            text: '',
            answer: '',
            grade: 0,
            type: 'text',
            subQuestions: []
          }]
        };
      }
      return q;
    }));
  };

  const updateQuestion = (id: string, updates: Partial<Question>, parentId?: string, subParentId?: string) => {
    if (subParentId && parentId) {
      // Level 3 update
      setQuestions(questions.map(q => {
        if (q.id === parentId) {
          return {
            ...q,
            subQuestions: q.subQuestions?.map(sq => {
              if (sq.id === subParentId) {
                return {
                  ...sq,
                  subQuestions: sq.subQuestions?.map(ssq => ssq.id === id ? { ...ssq, ...updates } : ssq)
                };
              }
              return sq;
            })
          };
        }
        return q;
      }));
    } else if (parentId) {
      // Level 2 update
      setQuestions(questions.map(q => {
        if (q.id === parentId) {
          return {
            ...q,
            subQuestions: q.subQuestions?.map(sq => sq.id === id ? { ...sq, ...updates } : sq)
          };
        }
        return q;
      }));
    } else {
      // Level 1 update
      setQuestions(questions.map(q => q.id === id ? { ...q, ...updates } : q));
    }
  };

  const removeQuestion = (id: string, parentId?: string, subParentId?: string) => {
    if (subParentId && parentId) {
      // Level 3 remove
      setQuestions(questions.map(q => {
        if (q.id === parentId) {
          return {
            ...q,
            subQuestions: q.subQuestions?.map(sq => {
              if (sq.id === subParentId) {
                return {
                  ...sq,
                  subQuestions: sq.subQuestions?.filter(ssq => ssq.id !== id)
                };
              }
              return sq;
            })
          };
        }
        return q;
      }));
    } else if (parentId) {
      // Level 2 remove
      setQuestions(questions.map(q => {
        if (q.id === parentId) {
          return {
            ...q,
            subQuestions: q.subQuestions?.filter(sq => sq.id !== id)
          };
        }
        return q;
      }));
    } else {
      // Level 1 remove
      setQuestions(questions.filter(q => q.id !== id));
    }
  };

  const saveExam = async () => {
    if (!title || questions.length === 0) return alert('يرجى إدخال عنوان الامتحان وسؤال واحد على الأقل');
    setIsSaving(true);
    try {
      const processedQuestions = await processQuestionsForStorage(questions);
      
      const examData = {
        title,
        duration,
        study,
        round,
        totalGrade,
        requiredQuestionsCount: requiredQuestionsCount || questions.length,
        questions: processedQuestions,
        authorUid: user.uid,
        updatedAt: serverTimestamp()
      };

      if (initialData?.id) {
        try {
          await updateDoc(doc(db, 'exams', initialData.id), examData);
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `exams/${initialData.id}`);
        }
      } else {
        try {
          await addDoc(collection(db, 'exams'), {
            ...examData,
            createdAt: serverTimestamp()
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.CREATE, 'exams');
        }
      }
      onSave();
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء الحفظ. قد يكون حجم الصور كبيراً جداً.');
    } finally {
      setIsSaving(false);
    }
  };

  const printExam = async (mode: 'questions' | 'both') => {
    const ref = mode === 'questions' ? examPrintRef : examFullPrintRef;
    if (!ref.current) return;
    
    setIsPrinting(true);
    try {
      const element = ref.current;
      
      // Wait a bit for images to potentially load in the hidden div
      await new Promise(resolve => setTimeout(resolve, 500));

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      if (imgData === 'data:,') {
        throw new Error('Canvas is empty');
      }

      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });
      
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      const pageHeight = pdf.internal.pageSize.getHeight();
      let heightLeft = pdfHeight;
      let position = 0;

      // Add first page
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;

      // Add subsequent pages if content is longer than one page
      while (heightLeft > 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${title || 'exam'}_${mode}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('حدث خطأ أثناء إنشاء ملف PDF. يرجى التأكد من أن جميع الصور محملة بشكل صحيح.');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      <div className="flex items-center justify-between" data-html2canvas-ignore>
        <h2 className="text-3xl font-bold font-serif italic">
          {initialData ? 'تعديل الامتحان' : 'إنشاء امتحان جديد'}
        </h2>
        <div className="flex gap-3">
          <button 
            onClick={() => {
              if (userProfile && (userProfile.pagesUsed + extractionImages.length) > userProfile.pageLimit) {
                alert(`عذراً، لقد تجاوزت الحد المسموح به من الصفحات (${userProfile.pageLimit}). يرجى التواصل مع الإدارة لزيادة الحد.`);
                return;
              }
              extractionInputRef.current?.click();
            }}
            className="px-6 py-2 rounded-xl bg-stone-100 text-stone-900 flex items-center gap-2 hover:bg-stone-200 transition-all"
            title="رفع من الجهاز"
          >
            <FileUp className="w-4 h-4" />
            استخراج من صور
          </button>
          <button 
            onClick={() => {
              if (userProfile && (userProfile.pagesUsed + extractionImages.length) > userProfile.pageLimit) {
                alert(`عذراً، لقد تجاوزت الحد المسموح به من الصفحات (${userProfile.pageLimit}). يرجى التواصل مع الإدارة لزيادة الحد.`);
                return;
              }
              extractionCameraInputRef.current?.click();
            }}
            className="px-6 py-2 rounded-xl bg-stone-100 text-stone-900 flex items-center gap-2 hover:bg-stone-200 transition-all"
            title="فتح الكاميرا"
          >
            <Camera className="w-4 h-4" />
            فتح الكاميرا
          </button>
          <input 
            type="file" 
            ref={extractionInputRef} 
            onChange={handleExtractionFileChange} 
            accept="image/*" 
            multiple 
            className="hidden" 
          />
          <input 
            type="file" 
            ref={extractionCameraInputRef} 
            onChange={handleExtractionFileChange} 
            accept="image/*" 
            capture="environment"
            className="hidden" 
          />
          <button onClick={onCancel} className="px-6 py-2 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors">إلغاء</button>
          
          <div className="relative">
            <button 
              onClick={() => setShowPrintMenu(!showPrintMenu)}
              disabled={isPrinting}
              className="px-6 py-2 rounded-xl bg-stone-900 text-white flex items-center gap-2 hover:bg-stone-800 disabled:opacity-50"
            >
              {isPrinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              تحميل PDF
              <ChevronDown className={cn("w-4 h-4 transition-transform", showPrintMenu && "rotate-180")} />
            </button>
            <AnimatePresence>
              {showPrintMenu && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-stone-100 py-2 z-50"
                >
                  <button 
                    onClick={() => {
                      printExam('questions');
                      setShowPrintMenu(false);
                    }}
                    className="w-full text-right px-4 py-2 text-sm hover:bg-stone-50 text-stone-700"
                  >
                    تحميل الأسئلة فقط
                  </button>
                  <button 
                    onClick={() => {
                      printExam('both');
                      setShowPrintMenu(false);
                    }}
                    className="w-full text-right px-4 py-2 text-sm hover:bg-stone-50 text-stone-700 border-t border-stone-50"
                  >
                    تحميل الأسئلة والأجوبة
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button 
            onClick={saveExam} 
            disabled={isSaving}
            className="px-6 py-2 rounded-xl bg-emerald-600 text-white flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ الامتحان
          </button>
        </div>
      </div>

      {extractionImages.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-emerald-800 font-bold flex items-center gap-2">
              <ImageIcon className="w-5 h-5" />
              صور جاهزة للاستخراج ({extractionImages.length})
            </h3>
            <div className="flex gap-2">
              <button 
                onClick={() => setExtractionImages([])}
                className="text-stone-500 text-sm hover:underline"
              >
                إلغاء الكل
              </button>
              <button 
                onClick={handleExtract}
                disabled={isExtracting}
                className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                بدء الاستخراج الذكي
              </button>
            </div>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {extractionImages.map((img, i) => (
              <div key={i} className="relative flex-shrink-0">
                <img src={img} alt="" className="w-24 h-24 object-cover rounded-xl border border-emerald-200" />
                <button 
                  onClick={() => setExtractionImages(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" data-html2canvas-ignore>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">عنوان الامتحان / المادة</label>
            <input 
              type="text"
              value={title} 
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: الكيمياء"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">الدراسة</label>
            <input 
              type="text" 
              value={study} 
              onChange={(e) => setStudy(e.target.value)}
              placeholder="مثال: الإعدادية / العلمي"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">الدور</label>
            <input 
              type="text" 
              value={round} 
              onChange={(e) => setRound(e.target.value)}
              placeholder="مثال: الدور الأول"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">الدرجة الكلية</label>
            <input 
              type="number" 
              value={totalGrade} 
              onChange={(e) => setTotalGrade(Number(e.target.value))}
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">عدد الأسئلة المطلوب حلها</label>
            <input 
              type="number" 
              value={requiredQuestionsCount || ''} 
              onChange={(e) => setRequiredQuestionsCount(e.target.value ? Number(e.target.value) : null)}
              placeholder={`الافتراضي: ${questions.length || 0}`}
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">الوقت (مثلاً: ثلاث ساعات)</label>
            <input 
              type="text" 
              value={duration} 
              onChange={(e) => setDuration(e.target.value)}
              placeholder="الوقت المخصص"
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
        </div>

        {/* Official Exam Header for PDF (Questions Only) */}
        <div className="fixed left-[-9999px] top-0 w-[210mm] pdf-export-container" ref={examPrintRef}>
          <div className="p-12 bg-white space-y-8 text-right" dir="rtl">
            <div className="flex justify-between items-start border-b-2 border-stone-900 pb-6">
              <div className="space-y-1">
                <p className="font-bold text-lg">وزارة التربية</p>
                <p>الدراسة: {study}</p>
                <p>المادة: {title}</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 border-2 border-stone-900 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-[10px] font-bold">شعار الوزارة</span>
                </div>
                <p className="font-bold">جمهورية العراق</p>
                <p>{round} / {new Date().getFullYear()} - {new Date().getFullYear() + 1}</p>
                <p>الوقت: {duration || 'غير محدد'}</p>
              </div>
              <div className="space-y-1">
                <p className="font-bold pt-12">اسم الطالب: ........................................</p>
              </div>
            </div>

            <div className="bg-stone-100 p-4 rounded-lg border border-stone-200">
              <p className="font-bold">ملاحظة: الإجابة عن {requiredQuestionsCount || questions.length} أسئلة فقط، ولكل سؤال {Math.round(totalGrade / (requiredQuestionsCount || questions.length))} درجة.</p>
            </div>

            <div className="space-y-10">
              {questions.map((q, idx) => (
                <div key={q.id} className="space-y-4">
                  <div className="flex justify-between items-start">
                    <h4 className="text-xl font-bold">س{idx + 1}: {q.text}</h4>
                    <span className="font-bold">({q.grade} درجة)</span>
                  </div>
                  {q.questionImage && <img src={q.questionImage} className="max-h-64 object-contain rounded-lg" referrerPolicy="no-referrer" />}
                  
                  <div className="mr-6 space-y-4">
                    {q.subQuestions?.map((sq, sqIdx) => (
                      <div key={sq.id} className="space-y-2">
                        <div className="flex justify-between">
                          <p className="font-medium">
                            {q.subStyle === 'letters' ? `${String.fromCharCode(1571 + sqIdx)}- ` : `${sqIdx + 1}- `}
                            {sq.text}
                          </p>
                          <span className="text-sm">({sq.grade} درجة)</span>
                        </div>
                        {sq.questionImage && <img src={sq.questionImage} className="max-h-48 object-contain rounded-lg" referrerPolicy="no-referrer" />}
                        
                        <div className="mr-6 space-y-2">
                          {sq.subQuestions?.map((ssq, ssqIdx) => (
                            <div key={ssq.id} className="flex justify-between text-sm">
                              <p>{ssqIdx + 1}- {ssq.text}</p>
                              <span>({ssq.grade} درجة)</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Full Exam Preview for PDF (Questions & Answers) */}
        <div className="fixed left-[-9999px] top-0 w-[210mm] pdf-export-container" ref={examFullPrintRef}>
          <div className="p-12 bg-white space-y-8 text-right" dir="rtl">
            <h2 className="text-3xl font-bold text-center border-b-4 border-stone-900 pb-4">نموذج الأسئلة والأجوبة النموذجية</h2>
            <div className="grid grid-cols-2 gap-4 text-lg border-b pb-4">
              <p><span className="font-bold">المادة:</span> {title}</p>
              <p><span className="font-bold">الدراسة:</span> {study}</p>
              <p><span className="font-bold">الدور:</span> {round}</p>
              <p><span className="font-bold">السنة الدراسية:</span> {new Date().getFullYear()} - {new Date().getFullYear() + 1}</p>
              <p><span className="font-bold">الدرجة الكلية:</span> {totalGrade}</p>
              <p><span className="font-bold">الوقت:</span> {duration}</p>
            </div>

            <div className="space-y-12">
              {questions.map((q, idx) => (
                <div key={q.id} className="p-6 border-2 border-stone-200 rounded-2xl space-y-6">
                  <div className="flex justify-between items-center bg-stone-50 p-3 rounded-xl">
                    <h4 className="text-xl font-bold">س{idx + 1}: {q.text}</h4>
                    <span className="bg-stone-900 text-white px-4 py-1 rounded-full text-sm">{q.grade} درجة</span>
                  </div>
                  
                  {q.answer && (
                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                      <p className="text-emerald-800 font-bold mb-2">الإجابة النموذجية:</p>
                      <p className="whitespace-pre-wrap">{q.answer}</p>
                      {q.answerImage && <img src={q.answerImage} className="mt-4 max-h-64 object-contain rounded-lg" referrerPolicy="no-referrer" />}
                    </div>
                  )}

                  <div className="mr-6 space-y-6">
                    {q.subQuestions?.map((sq, sqIdx) => (
                      <div key={sq.id} className="space-y-4 border-r-2 border-stone-100 pr-4">
                        <div className="flex justify-between font-bold">
                          <p>{q.subStyle === 'letters' ? `${String.fromCharCode(1571 + sqIdx)}- ` : `${sqIdx + 1}- `} {sq.text}</p>
                          <span>{sq.grade} درجة</span>
                        </div>
                        {sq.answer && (
                          <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 text-sm">
                            <p className="font-bold text-stone-500 mb-1">الجواب:</p>
                            <p>{sq.answer}</p>
                            {sq.answerImage && <img src={sq.answerImage} className="mt-2 max-h-48 object-contain rounded-lg" referrerPolicy="no-referrer" />}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between border-t border-stone-100 pt-6" data-html2canvas-ignore>
            <h3 className="text-xl font-bold">الأسئلة</h3>
            <button 
              onClick={addQuestion}
              className="text-emerald-600 flex items-center gap-1 text-sm font-bold hover:underline"
            >
              <Plus className="w-4 h-4" /> إضافة سؤال
            </button>
          </div>

          <div className="space-y-4">
            {questions.map((q, index) => (
              <div key={q.id} className="p-6 bg-stone-50 rounded-2xl border border-stone-200 space-y-4 relative group">
                <button 
                  onClick={() => removeQuestion(q.id)}
                  className="absolute top-4 left-4 p-2 text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-4">
                  <span className="w-8 h-8 bg-white rounded-lg flex items-center justify-center font-bold text-stone-400 border border-stone-200">{index + 1}</span>
                  <select 
                    value={q.type} 
                    onChange={(e) => updateQuestion(q.id, { type: e.target.value as any })}
                    className="bg-white px-3 py-1.5 rounded-lg border border-stone-200 text-sm outline-none"
                  >
                    <option value="text">نصي</option>
                    <option value="true-false">صح / خطأ</option>
                    <option value="multiple-choice">اختيارات</option>
                    <option value="fill-in-the-blanks">فراغات</option>
                  </select>
                  <div className="flex-1" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-400">الدرجة:</span>
                    <input 
                      type="number" 
                      value={q.grade} 
                      onChange={(e) => updateQuestion(q.id, { grade: Number(e.target.value) })}
                      className="w-16 px-2 py-1 rounded-lg border border-stone-200 text-sm text-center"
                    />
                  </div>
                </div>
                <textarea 
                  value={q.text} 
                  onChange={(e) => {
                    updateQuestion(q.id, { text: e.target.value });
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onFocus={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  placeholder="نص السؤال الرئيسي..."
                  rows={1}
                  className="w-full bg-white px-4 py-2 rounded-xl border border-stone-200 outline-none focus:ring-2 focus:ring-emerald-500 overflow-hidden resize-none"
                />

                {(!q.subQuestions || q.subQuestions.length === 0) && (
                  <div className="grid grid-cols-2 gap-4">
                    <ImageUpload 
                      label="صورة السؤال" 
                      value={q.questionImage} 
                      onChange={(base64) => updateQuestion(q.id, { questionImage: base64 })}
                      onRemove={() => updateQuestion(q.id, { questionImage: undefined })}
                    />
                    <ImageUpload 
                      label="صورة الجواب" 
                      value={q.answerImage} 
                      onChange={(base64) => updateQuestion(q.id, { answerImage: base64 })}
                      onRemove={() => updateQuestion(q.id, { answerImage: undefined })}
                    />
                  </div>
                )}
                
                {/* Sub-questions Section */}
                <div className="mr-8 space-y-3 border-r-2 border-emerald-100 pr-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-4">
                      <span className="text-[10px] font-bold text-stone-400">
                        {q.subStyle === 'letters' ? 'الفروع والترك:' : 'النقاط/الفراغات والترك:'}
                      </span>
                      <div className="flex items-center bg-stone-100 rounded-lg p-0.5">
                        <button 
                          onClick={() => updateQuestion(q.id, { subStyle: 'numbers' })}
                          className={cn(
                            "px-2 py-0.5 text-[8px] rounded-md transition-all",
                            (q.subStyle === 'numbers' || !q.subStyle) ? "bg-white text-emerald-600 shadow-sm" : "text-stone-400"
                          )}
                        >
                          1, 2, 3
                        </button>
                        <button 
                          onClick={() => updateQuestion(q.id, { subStyle: 'letters' })}
                          className={cn(
                            "px-2 py-0.5 text-[8px] rounded-md transition-all",
                            q.subStyle === 'letters' ? "bg-white text-emerald-600 shadow-sm" : "text-stone-400"
                          )}
                        >
                          أ, ب, ج
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-stone-400">
                        {q.subStyle === 'letters' ? 'عدد الفروع المطلوب حلها:' : 'عدد النقاط المطلوب حلها:'}
                      </span>
                      <input 
                        type="number" 
                        value={q.requiredSubCount || ''} 
                        onChange={(e) => updateQuestion(q.id, { requiredSubCount: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder={q.subQuestions?.length.toString()}
                        className="w-10 px-1 py-0.5 rounded border border-stone-200 text-[10px] text-center"
                      />
                    </div>
                  </div>
                  {q.subQuestions?.map((sq, sqIndex) => (
                    <div key={sq.id} className="p-4 bg-white rounded-xl border border-stone-100 space-y-3 relative group/sub shadow-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-emerald-600">
                          {q.subStyle === 'letters' ? `(${String.fromCharCode(97 + sqIndex)})` : `${sqIndex + 1}-`}
                        </span>
                        <select 
                          value={sq.type} 
                          onChange={(e) => updateQuestion(sq.id, { type: e.target.value as any }, q.id)}
                          className="bg-stone-50 px-2 py-1 rounded border border-stone-200 text-[10px] outline-none"
                        >
                          <option value="text">نصي</option>
                          <option value="true-false">صح / خطأ</option>
                          <option value="multiple-choice">اختيارات</option>
                          <option value="fill-in-the-blanks">فراغات</option>
                        </select>
                        <textarea 
                          value={sq.text} 
                          onChange={(e) => {
                            updateQuestion(sq.id, { text: e.target.value }, q.id);
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                          }}
                          onFocus={(e) => {
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                          }}
                          placeholder="نص السؤال الفرعي..."
                          rows={1}
                          className="flex-1 bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-200 text-sm outline-none focus:ring-2 focus:ring-emerald-500 overflow-hidden resize-none"
                        />
                        <div className="flex items-center gap-2">
                          <ImageUpload 
                            label="صورة" 
                            value={sq.questionImage} 
                            onChange={(base64) => updateQuestion(sq.id, { questionImage: base64 }, q.id)}
                            onRemove={() => updateQuestion(sq.id, { questionImage: undefined }, q.id)}
                            compact
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-stone-400">الدرجة:</span>
                          <input 
                            type="number" 
                            value={sq.grade} 
                            onChange={(e) => updateQuestion(sq.id, { grade: Number(e.target.value) }, q.id)}
                            className="w-12 px-1 py-0.5 rounded-md border border-stone-200 text-xs text-center"
                          />
                        </div>
                        <button 
                          onClick={() => removeQuestion(sq.id, q.id)}
                          className="p-1 text-stone-300 hover:text-red-500 opacity-0 group-hover/sub:opacity-100 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Level 3: Points inside a Branch */}
                      <div className="mr-6 space-y-2 border-r border-stone-200 pr-3">
                        {sq.subQuestions && sq.subQuestions.length > 0 && (
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[9px] font-bold text-stone-400">النقاط والترك:</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-stone-400">عدد النقاط المطلوب حلها:</span>
                              <input 
                                type="number" 
                                value={sq.requiredSubCount || ''} 
                                onChange={(e) => updateQuestion(sq.id, { requiredSubCount: e.target.value ? Number(e.target.value) : undefined }, q.id)}
                                placeholder={sq.subQuestions?.length.toString()}
                                className="w-8 px-1 py-0.5 rounded border border-stone-200 text-[9px] text-center"
                              />
                            </div>
                          </div>
                        )}
                        {sq.subQuestions?.map((ssq, ssqIndex) => (
                          <div key={ssq.id} className="flex items-center gap-2 bg-stone-50/50 p-2 rounded-lg border border-stone-100">
                            <span className="text-[10px] font-bold text-emerald-500">{ssqIndex + 1}-</span>
                            <textarea 
                              value={ssq.text} 
                              onChange={(e) => {
                                updateQuestion(ssq.id, { text: e.target.value }, q.id, sq.id);
                                e.target.style.height = 'auto';
                                e.target.style.height = e.target.scrollHeight + 'px';
                              }}
                              placeholder="نص النقطة..."
                              rows={1}
                              className="flex-1 bg-transparent text-[11px] outline-none resize-none overflow-hidden"
                            />
                            <div className="flex items-center gap-1">
                              <ImageUpload 
                                label="صورة السؤال" 
                                value={ssq.questionImage} 
                                onChange={(base64) => updateQuestion(ssq.id, { questionImage: base64 }, q.id, sq.id)}
                                onRemove={() => updateQuestion(ssq.id, { questionImage: undefined }, q.id, sq.id)}
                                compact
                              />
                              <ImageUpload 
                                label="صورة الجواب" 
                                value={ssq.answerImage} 
                                onChange={(base64) => updateQuestion(ssq.id, { answerImage: base64 }, q.id, sq.id)}
                                onRemove={() => updateQuestion(ssq.id, { answerImage: undefined }, q.id, sq.id)}
                                compact
                              />
                            </div>
                            <input 
                              type="text" 
                              value={ssq.answer} 
                              onChange={(e) => updateQuestion(ssq.id, { answer: e.target.value }, q.id, sq.id)}
                              placeholder="الجواب"
                              className="w-20 bg-white px-2 py-0.5 rounded border border-stone-200 text-[10px] outline-none"
                            />
                            <input 
                              type="number" 
                              value={ssq.grade || ''} 
                              onChange={(e) => updateQuestion(ssq.id, { grade: Number(e.target.value) }, q.id, sq.id)}
                              placeholder="درجة"
                              className="w-10 px-1 py-0.5 rounded border border-stone-200 text-[10px] text-center"
                            />
                            <button 
                              onClick={() => removeQuestion(ssq.id, q.id, sq.id)}
                              className="text-stone-300 hover:text-red-500"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                        <button 
                          onClick={() => addSubQuestion(q.id, sq.id, 'numbers')}
                          className="text-[9px] text-emerald-500 hover:underline flex items-center gap-1"
                        >
                          <Plus className="w-2.5 h-2.5" /> إضافة نقاط لهذا الفرع (1، 2، 3...)
                        </button>
                      </div>

                      {sq.type === 'multiple-choice' && (
                        <div className="mr-8 space-y-1">
                          <label className="text-[10px] font-medium text-stone-400">الخيارات (افصل بينها بفاصلة)</label>
                          <textarea 
                            value={sq.options?.join(', ') || ''} 
                            onChange={(e) => {
                              updateQuestion(sq.id, { options: e.target.value.split(',').map(s => s.trim()) }, q.id);
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            onFocus={(e) => {
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            placeholder="خيار 1, خيار 2..."
                            rows={1}
                            className="w-full bg-stone-50 px-3 py-1 rounded-lg border border-stone-200 text-[10px] outline-none overflow-hidden resize-none"
                          />
                        </div>
                      )}

                      {(!sq.subQuestions || sq.subQuestions.length === 0) && (
                        <>
                          <textarea 
                            value={sq.answer} 
                            onChange={(e) => {
                              updateQuestion(sq.id, { answer: e.target.value }, q.id);
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            onFocus={(e) => {
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            placeholder="الإجابة النموذجية للفرع..."
                            rows={1}
                            className="w-full bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-100 text-xs outline-none focus:ring-2 focus:ring-emerald-500 overflow-hidden resize-none min-h-[40px]"
                          />
                          <div className="grid grid-cols-2 gap-4 mt-2">
                            <ImageUpload 
                              label="صورة الجواب للفرع" 
                              value={sq.answerImage} 
                              onChange={(base64) => updateQuestion(sq.id, { answerImage: base64 }, q.id)}
                              onRemove={() => updateQuestion(sq.id, { answerImage: undefined }, q.id)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-4 pt-2" data-html2canvas-ignore>
                    <button 
                      onClick={() => addSubQuestion(q.id, undefined, 'letters')}
                      className="text-[10px] text-emerald-600 font-bold hover:underline flex items-center gap-1 bg-emerald-50 px-3 py-1.5 rounded-lg"
                    >
                      <Plus className="w-3 h-3" /> إضافة فرع (أ، ب، ج...)
                    </button>
                    <button 
                      onClick={() => addSubQuestion(q.id, undefined, 'numbers')}
                      className="text-[10px] text-emerald-600 font-bold hover:underline flex items-center gap-1 bg-stone-50 px-3 py-1.5 rounded-lg"
                    >
                      <Plus className="w-3 h-3" /> إضافة نقطة (1، 2، 3...)
                    </button>
                  </div>
                </div>

                {(!q.subQuestions || q.subQuestions.length === 0) && (
                  <>
                    {q.type === 'multiple-choice' && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-stone-400">الخيارات (افصل بينها بفاصلة)</label>
                        <textarea 
                          value={q.options?.join(', ') || ''} 
                          onChange={(e) => {
                            updateQuestion(q.id, { options: e.target.value.split(',').map(s => s.trim()) });
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                          }}
                          onFocus={(e) => {
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                          }}
                          placeholder="خيار 1, خيار 2, خيار 3..."
                          rows={1}
                          className="w-full bg-white px-4 py-2 rounded-xl border border-stone-200 outline-none overflow-hidden resize-none"
                        />
                      </div>
                    )}
                    <textarea 
                      value={q.answer} 
                      onChange={(e) => {
                        updateQuestion(q.id, { answer: e.target.value });
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      onFocus={(e) => {
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      placeholder="الإجابة النموذجية..."
                      rows={1}
                      className="w-full bg-white px-4 py-2 rounded-xl border border-stone-200 outline-none focus:ring-2 focus:ring-emerald-500 overflow-hidden resize-none min-h-[80px]"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Grader({ user, userProfile, exam, onComplete, onCancel }: any) {
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isGrading, setIsGrading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' });
  const [gradingResults, setGradingResults] = useState<any[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      if (images.length + newFiles.length > 150) {
        alert('عذراً، لا يمكن رفع أكثر من 150 صفحة في المرة الواحدة.');
        return;
      }
      setImages([...images, ...newFiles]);
      const newPreviews = newFiles.map(file => URL.createObjectURL(file));
      setPreviews([...previews, ...newPreviews]);
    }
  };

  const startGrading = async () => {
    if (images.length === 0) return alert('يرجى رفع صور أوراق الطلاب');
    
    // Check usage limit
    if (userProfile && (userProfile.pagesUsed + images.length) > userProfile.pageLimit) {
      return alert(`عذراً، لقد تجاوزت الحد المسموح به من الصفحات (${userProfile.pageLimit}). يرجى التواصل مع الإدارة لزيادة الحد.`);
    }

    setIsGrading(true);
    setProgress({ current: 0, total: images.length, phase: 'compressing' });
    try {
      const { results } = await gradeStudentPaper(
        previews, 
        exam.questions, 
        exam.totalGrade, 
        exam.requiredQuestionsCount,
        (current, total, phase) => setProgress({ current, total, phase })
      );
      if (!results || results.length === 0) {
        throw new Error("لم يتم العثور على نتائج في الأوراق المرفوعة. تأكد من وضوح الصور وجودة الخط.");
      }

      // Update user pagesUsed
      if (userProfile) {
        try {
          await setDoc(doc(db, 'users', user.uid), {
            pagesUsed: (userProfile.pagesUsed || 0) + images.length
          }, { merge: true });
        } catch (e) {
          handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
        }
      }

      setGradingResults(results);
      setCurrentResultIndex(0);
    } catch (e: any) {
      console.error("Grading error:", e);
      alert(`عذراً، حدث خطأ أثناء التصحيح: ${e.message || 'خطأ غير معروف'}`);
    } finally {
      setIsGrading(false);
      setProgress({ current: 0, total: 0, phase: '' });
    }
  };

  const saveAllResults = async () => {
    try {
      // 1. Create a session document
      let sessionRef;
      try {
        sessionRef = await addDoc(collection(db, 'sessions'), {
          examId: exam.id,
          examTitle: exam.title,
          authorUid: user.uid,
          studentCount: gradingResults.length,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'sessions');
      }

      // 2. Save each result with the sessionId
      for (const result of gradingResults) {
        try {
          await addDoc(collection(db, 'results'), {
            studentName: result.studentName,
            gradings: result.gradings,
            totalGrade: result.totalGrade,
            sessionId: sessionRef.id,
            examId: exam.id,
            examTitle: exam.title,
            authorUid: user.uid,
            createdAt: serverTimestamp()
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.CREATE, 'results');
        }
      }
      onComplete();
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء حفظ النتائج');
    }
  };

  const currentGrading = gradingResults[currentResultIndex];

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif italic">تصحيح الأوراق</h2>
          <p className="text-stone-500">امتحان: {exam.title}</p>
        </div>
        <button onClick={onCancel} className="text-stone-400 hover:text-stone-900 transition-colors">إلغاء</button>
      </div>

      {gradingResults.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl border-2 border-dashed border-stone-200 text-center space-y-6">
          <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
            <Upload className="w-10 h-10 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold mb-2">ارفع صور أوراق الطلاب</h3>
            <p className="text-stone-400 max-w-sm mx-auto">يمكنك رفع عدة صور لنفس الطالب. سيتعرف النظام على اسم الطالب من الورقة الأولى.</p>
          </div>
          <input 
            type="file" 
            multiple 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileChange}
          />
          <input 
            type="file" 
            accept="image/*" 
            capture="environment"
            className="hidden" 
            ref={cameraInputRef} 
            onChange={handleFileChange}
          />
          <div className="flex flex-wrap gap-4 justify-center">
            {previews.map((url, i) => (
              <div key={i} className="relative w-24 h-32 rounded-lg overflow-hidden border border-stone-200 group">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button 
                  onClick={() => {
                    setPreviews(previews.filter((_, idx) => idx !== i));
                    setImages(images.filter((_, idx) => idx !== i));
                  }}
                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-4">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-8 py-3 rounded-2xl border border-stone-200 font-medium hover:bg-stone-50 transition-colors flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              اختيار الصور
            </button>
            <button 
              onClick={() => cameraInputRef.current?.click()}
              className="px-8 py-3 rounded-2xl border border-stone-200 font-medium hover:bg-stone-50 transition-colors flex items-center gap-2"
            >
              <Camera className="w-4 h-4" />
              فتح الكاميرا
            </button>
            <button 
              onClick={startGrading}
              disabled={images.length === 0 || isGrading}
              className="px-8 py-3 rounded-2xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
            >
              {isGrading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
              {isGrading && progress.total > 0 
                ? `${progress.phase === 'compressing' ? 'جاري ضغط الصور' : 'جاري التصحيح'} (${progress.current}/${progress.total})...` 
                : 'بدء التصحيح الذكي'}
            </button>
          </div>
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-stone-100 pb-6">
              <div>
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">تم التصحيح بنجاح</span>
                <h3 className="text-2xl font-bold mt-1">الطالب: {currentGrading.studentName}</h3>
              </div>
              <div className="text-right">
                <span className="text-stone-400 text-sm">المجموع الكلي</span>
                <div className="text-4xl font-bold text-emerald-600">{currentGrading.totalGrade} <span className="text-lg text-stone-300">/ {exam.totalGrade}</span></div>
              </div>
            </div>

            <div className="space-y-4">
              {currentGrading.gradings?.map((g: any, i: number) => {
                // Find question or sub-question (3 levels)
                let question: any = null;
                exam.questions.forEach((q: any) => {
                  if (q.id === g.questionId) question = q;
                  q.subQuestions?.forEach((sq: any) => {
                    if (sq.id === g.questionId) question = sq;
                    sq.subQuestions?.forEach((ssq: any) => {
                      if (ssq.id === g.questionId) question = ssq;
                    });
                  });
                });

                const isParent = question?.subQuestions && question.subQuestions.length > 0;

                return (
                  <div key={i} className="p-6 bg-stone-50 rounded-2xl border border-stone-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-2">
                        <span className="font-bold">سؤال {i + 1}: {question?.text || 'سؤال محذوف'}</span>
                        {question?.questionImage && (
                          <img 
                            src={question.questionImage} 
                            alt="سؤال" 
                            className="w-32 h-32 object-cover rounded-xl border border-stone-200" 
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          value={g.grade} 
                          onChange={(e) => {
                            const newGradings = [...currentGrading.gradings];
                            newGradings[i].grade = Number(e.target.value);
                            const newTotal = newGradings.reduce((acc: any, curr: any) => acc + curr.grade, 0);
                            const newResults = [...gradingResults];
                            newResults[currentResultIndex] = { ...currentGrading, gradings: newGradings, totalGrade: newTotal };
                            setGradingResults(newResults);
                          }}
                          className="w-16 px-2 py-1 rounded-lg border border-stone-200 text-center font-bold text-emerald-600"
                        />
                        <span className="text-stone-400">/ {question?.grade || '?'}</span>
                      </div>
                    </div>
                    {!isParent && (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="space-y-1">
                          <span className="text-stone-400 block">إجابة الطالب:</span>
                          <p className="p-3 bg-white rounded-xl border border-stone-100 italic">"{g.studentAnswer}"</p>
                        </div>
                        <div className="space-y-1">
                          <span className="text-stone-400 block">الإجابة النموذجية:</span>
                          <div className="flex flex-col gap-2">
                            <p className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-800">"{question?.answer || 'غير متوفرة'}"</p>
                            {question?.answerImage && (
                              <img 
                                src={question.answerImage} 
                                alt="إجابة نموذجية" 
                                className="w-32 h-32 object-cover rounded-xl border border-emerald-100" 
                                referrerPolicy="no-referrer"
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="pt-2">
                      <span className="text-xs font-bold text-stone-400 uppercase">ملاحظات المصحح:</span>
                      <p className="text-stone-600 mt-1">{g.feedback}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center pt-6 border-t border-stone-100">
              <div className="flex gap-2">
                <button 
                  disabled={currentResultIndex === 0}
                  onClick={() => setCurrentResultIndex(currentResultIndex - 1)}
                  className="px-4 py-2 rounded-xl border border-stone-200 disabled:opacity-30"
                >
                  السابق
                </button>
                <button 
                  disabled={currentResultIndex === gradingResults.length - 1}
                  onClick={() => setCurrentResultIndex(currentResultIndex + 1)}
                  className="px-4 py-2 rounded-xl border border-stone-200 disabled:opacity-30"
                >
                  التالي
                </button>
                <span className="flex items-center px-4 text-stone-400 text-sm">
                  طالب {currentResultIndex + 1} من {gradingResults.length}
                </span>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setGradingResults([])} className="px-6 py-2 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors">إعادة التصحيح</button>
                <button onClick={saveAllResults} className="px-8 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-600/20">حفظ جميع النتائج</button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function ResultsView({ results, sessions, exams, onBack }: any) {
  const [selectedResult, setSelectedResult] = useState<any>(null);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>('all');

  const [isExportingAll, setIsExportingAll] = useState(false);
  const resultPrintRef = useRef<HTMLDivElement>(null);
  const allResultsPrintRef = useRef<HTMLDivElement>(null);

  const exportPDF = async (result: any) => {
    // If we're not in the detailed view, we need to temporarily set the selected result 
    // or use a hidden template. Let's use a more robust approach.
    const element = document.getElementById(`print-result-${result.id}`);
    if (!element) {
      // If not found, it might be because it's not rendered. 
      // We'll fallback to the main ref if we are in detailed view.
      if (selectedResult?.id === result.id && resultPrintRef.current) {
        await generatePDFFromElement(resultPrintRef.current, `${result.studentName}_result.pdf`);
      } else {
        alert('يرجى فتح تفاصيل الطالب أولاً لتحميل الملف، أو استخدم زر "تحميل الكل"');
      }
      return;
    }
    
    await generatePDFFromElement(element, `${result.studentName}_result.pdf`);
  };

  const generatePDFFromElement = async (element: HTMLElement, fileName: string) => {
    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });
      
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      // Handle multi-page if height exceeds A4
      const pageHeight = pdf.internal.pageSize.getHeight();
      let heightLeft = pdfHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(fileName);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('حدث خطأ أثناء إنشاء ملف PDF');
    }
  };

  const exportAllPDF = async () => {
    if (!allResultsPrintRef.current) return;
    setIsExportingAll(true);
    try {
      await generatePDFFromElement(allResultsPrintRef.current, `all_results_${selectedSession.examTitle}.pdf`);
    } finally {
      setIsExportingAll(false);
    }
  };

  const years = Array.from(new Set(sessions.map((s: any) => s.createdAt?.toDate().getFullYear()))).sort((a: any, b: any) => b - a);
  const months = [
    { id: 1, name: 'يناير' }, { id: 2, name: 'فبراير' }, { id: 3, name: 'مارس' },
    { id: 4, name: 'أبريل' }, { id: 5, name: 'مايو' }, { id: 6, name: 'يونيو' },
    { id: 7, name: 'يوليو' }, { id: 8, name: 'أغسطس' }, { id: 9, name: 'سبتمبر' },
    { id: 10, name: 'أكتوبر' }, { id: 11, name: 'نوفمبر' }, { id: 12, name: 'ديسمبر' }
  ];

  const filteredSessions = sessions.filter((s: any) => {
    const date = s.createdAt?.toDate();
    if (!date) return true;
    const yearMatch = selectedYear === 'all' || date.getFullYear() === selectedYear;
    const monthMatch = selectedMonth === 'all' || (date.getMonth() + 1) === selectedMonth;
    return yearMatch && monthMatch;
  }).sort((a: any, b: any) => b.createdAt?.toDate() - a.createdAt?.toDate());

  const sessionResults = results.filter((r: any) => r.sessionId === selectedSession?.id);

  if (selectedResult) {
    const exam = exams.find((e: any) => e.id === selectedResult.examId);
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-8"
      >
        <div className="flex items-center justify-between" data-html2canvas-ignore>
          <button onClick={() => setSelectedResult(null)} className="flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors">
            <ArrowRight className="w-5 h-5" />
            العودة لقائمة الطلاب
          </button>
          <button 
            onClick={() => exportPDF(selectedResult)}
            className="bg-emerald-600 text-white px-6 py-2 rounded-xl flex items-center gap-2 hover:bg-emerald-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            تحميل PDF
          </button>
        </div>

        <div ref={resultPrintRef} className="bg-white p-8 border space-y-8 pdf-export-container">
          <div className="flex items-center justify-between border-b border-stone-100 pb-6">
            <div>
              <h3 className="text-2xl font-bold">الطالب: {selectedResult.studentName}</h3>
              <p className="text-stone-500 mt-1">امتحان: {selectedResult.examTitle}</p>
              <p className="text-stone-400 text-sm mt-1">التاريخ: {selectedResult.createdAt?.toDate().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            <div className="text-right">
              <span className="text-stone-400 text-sm">الدرجة النهائية</span>
              <div className="text-5xl font-bold text-emerald-600">
                {selectedResult.totalGrade}
                <span className="text-xl text-stone-300"> / {exam?.totalGrade || '?'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {selectedResult.gradings?.map((g: any, i: number) => {
              let question: any = null;
              let label = "";
              
              if (exam) {
                const findInHierarchy = (qs: Question[], path: string = ""): boolean => {
                  for (let idx = 0; idx < qs.length; idx++) {
                    const q = qs[idx];
                    let currentLabel = q.text.split(/[:\-\.]/)[0].trim();
                    if (currentLabel.length > 10) currentLabel = `Item ${idx + 1}`;
                    
                    const fullPath = path ? `${path} / ${currentLabel}` : currentLabel;
                    
                    if (q.id === g.questionId) {
                      question = q;
                      label = fullPath;
                      return true;
                    }
                    if (q.subQuestions && findInHierarchy(q.subQuestions, fullPath)) {
                      return true;
                    }
                  }
                  return false;
                };
                findInHierarchy(exam.questions);
              }

              const isParent = question?.subQuestions && question.subQuestions.length > 0;

              return (
                <div key={i} className="p-6 bg-stone-50 rounded-2xl border border-stone-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-2">
                      <span className="font-bold text-stone-700">سؤال {label || i + 1}: {question?.text || 'سؤال محذوف'}</span>
                      {question?.questionImage && (
                        <img 
                          src={question.questionImage} 
                          alt="سؤال" 
                          className="w-32 h-32 object-cover rounded-xl border border-stone-200" 
                          referrerPolicy="no-referrer"
                        />
                      )}
                    </div>
                    <div className="px-3 py-1 bg-white rounded-lg border border-stone-200 font-bold text-emerald-600">
                      {g.grade} <span className="text-stone-300 text-xs">/ {question?.grade || '?'}</span>
                    </div>
                  </div>
                  {!isParent && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-4">
                    <div className="space-y-1">
                      <span className="text-stone-400 block">إجابة الطالب:</span>
                      <p className="p-3 bg-white rounded-xl border border-stone-100 italic">"{g.studentAnswer}"</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-stone-400 block">الإجابة النموذجية:</span>
                      <div className="flex flex-col gap-2">
                        <p className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-800">"{question?.answer || 'غير متوفرة'}"</p>
                        {question?.answerImage && (
                          <img 
                            src={question.answerImage} 
                            alt="إجابة نموذجية" 
                            className="w-32 h-32 object-cover rounded-xl border border-emerald-100" 
                            referrerPolicy="no-referrer"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {g.feedback && (
                    <div className="pt-2">
                      <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">ملاحظات المصحح:</span>
                      <p className="text-stone-600 text-sm mt-1">{g.feedback}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    );
  }

  if (selectedSession) {
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-8"
      >
        <div className="flex items-center justify-between">
          <button onClick={() => setSelectedSession(null)} className="flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors">
            <ArrowRight className="w-5 h-5" />
            العودة لقائمة المجموعات
          </button>
          <div className="flex items-center gap-4">
            <button 
              onClick={exportAllPDF}
              disabled={isExportingAll}
              className="bg-emerald-600 text-white px-6 py-2 rounded-xl flex items-center gap-2 hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {isExportingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              تحميل كل النتائج (PDF واحد)
            </button>
            <div className="text-right">
              <h3 className="text-xl font-bold">{selectedSession.examTitle}</h3>
              <p className="text-stone-400 text-sm">{selectedSession.createdAt?.toDate().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          </div>
        </div>

        {/* Hidden area for printing all results */}
        <div className="fixed left-[-9999px] top-0 w-[210mm] pdf-export-container" ref={allResultsPrintRef}>
          {sessionResults.map((res: any) => (
            <div key={res.id} className="bg-white p-10 mb-10 border-b-2" style={{ pageBreakAfter: 'always' }}>
              <div className="flex items-center justify-between border-b border-stone-100 pb-6 mb-8">
                <div>
                  <h3 className="text-3xl font-bold">نتيجة الطالب: {res.studentName}</h3>
                  <p className="text-stone-500 mt-2 text-lg">الامتحان: {res.examTitle}</p>
                </div>
                <div className="text-right">
                  <span className="text-stone-400 text-sm">الدرجة النهائية</span>
                  <div className="text-5xl font-bold text-emerald-600">
                    {res.totalGrade}
                    <span className="text-xl text-stone-300"> / {exams.find((e: any) => e.id === res.examId)?.totalGrade || '?'}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                {res.gradings?.map((g: any, idx: number) => {
                  const exam = exams.find((e: any) => e.id === res.examId);
                  let question: any = null;
                  if (exam) {
                    exam.questions.forEach((q: any) => {
                      if (q.id === g.questionId) question = q;
                      q.subQuestions?.forEach((sq: any) => {
                        if (sq.id === g.questionId) question = sq;
                        sq.subQuestions?.forEach((ssq: any) => {
                          if (ssq.id === g.questionId) question = ssq;
                        });
                      });
                    });
                  }
                  return (
                    <div key={idx} className="p-6 bg-stone-50 rounded-2xl border border-stone-100">
                      <div className="flex justify-between mb-4">
                        <span className="font-bold text-lg">سؤال {idx + 1}: {question?.text || 'سؤال محذوف'}</span>
                        <span className="font-bold text-emerald-600">{g.grade} / {question?.grade || '?'}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-6 text-sm">
                        <div>
                          <span className="text-stone-400 block mb-1">إجابة الطالب:</span>
                          <p className="p-3 bg-white rounded-xl border border-stone-100">"{g.studentAnswer}"</p>
                        </div>
                        <div>
                          <span className="text-stone-400 block mb-1">الإجابة النموذجية:</span>
                          <p className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-800">"{question?.answer || 'غير متوفرة'}"</p>
                        </div>
                      </div>
                      {g.feedback && (
                        <div className="mt-4 pt-4 border-t border-stone-200">
                          <span className="text-xs font-bold text-stone-400 uppercase">ملاحظات المصحح:</span>
                          <p className="text-stone-600 mt-1">{g.feedback}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Hidden area for individual printing from list */}
        <div className="fixed left-[-9999px] top-0 w-[210mm] pdf-export-container">
          {sessionResults.map((res: any) => (
            <div key={res.id} id={`print-result-${res.id}`} className="bg-white p-10">
               <div className="flex items-center justify-between border-b border-stone-100 pb-6 mb-8">
                <div>
                  <h3 className="text-3xl font-bold">نتيجة الطالب: {res.studentName}</h3>
                  <p className="text-stone-500 mt-2 text-lg">الامتحان: {res.examTitle}</p>
                </div>
                <div className="text-right">
                  <span className="text-stone-400 text-sm">الدرجة النهائية</span>
                  <div className="text-5xl font-bold text-emerald-600">
                    {res.totalGrade}
                    <span className="text-xl text-stone-300"> / {exams.find((e: any) => e.id === res.examId)?.totalGrade || '?'}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                {res.gradings?.map((g: any, idx: number) => {
                  const exam = exams.find((e: any) => e.id === res.examId);
                  let question: any = null;
                  if (exam) {
                    exam.questions.forEach((q: any) => {
                      if (q.id === g.questionId) question = q;
                      q.subQuestions?.forEach((sq: any) => {
                        if (sq.id === g.questionId) question = sq;
                        sq.subQuestions?.forEach((ssq: any) => {
                          if (ssq.id === g.questionId) question = ssq;
                        });
                      });
                    });
                  }
                  return (
                    <div key={idx} className="p-6 bg-stone-50 rounded-2xl border border-stone-100">
                      <div className="flex justify-between mb-4">
                        <span className="font-bold text-lg">سؤال {idx + 1}: {question?.text || 'سؤال محذوف'}</span>
                        <span className="font-bold text-emerald-600">{g.grade} / {question?.grade || '?'}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-6 text-sm">
                        <div>
                          <span className="text-stone-400 block mb-1">إجابة الطالب:</span>
                          <p className="p-3 bg-white rounded-xl border border-stone-100">"{g.studentAnswer}"</p>
                        </div>
                        <div>
                          <span className="text-stone-400 block mb-1">الإجابة النموذجية:</span>
                          <p className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-800">"{question?.answer || 'غير متوفرة'}"</p>
                        </div>
                      </div>
                      {g.feedback && (
                        <div className="mt-4 pt-4 border-t border-stone-200">
                          <span className="text-xs font-bold text-stone-400 uppercase">ملاحظات المصحح:</span>
                          <p className="text-stone-600 mt-1">{g.feedback}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <table className="w-full text-right">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <th className="px-6 py-4 font-bold text-stone-500 text-sm text-right">اسم الطالب</th>
                <th className="px-6 py-4 font-bold text-stone-500 text-sm text-right">الدرجة</th>
                <th className="px-6 py-4 font-bold text-stone-500 text-sm text-left">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sessionResults.map((res: any) => (
                <tr key={res.id} className="hover:bg-stone-50 transition-colors group">
                  <td className="px-6 py-4 font-bold">{res.studentName}</td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full font-bold text-sm">
                      {res.totalGrade}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-left">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => setSelectedResult(res)}
                        className="px-4 py-1.5 rounded-lg bg-stone-100 text-stone-600 text-xs font-bold hover:bg-emerald-600 hover:text-white transition-all"
                      >
                        عرض التفاصيل
                      </button>
                      <button 
                        onClick={() => exportPDF(res)}
                        className="p-2 text-stone-300 hover:text-emerald-600 transition-colors"
                        title="تحميل PDF"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif italic">نتائج الطلاب</h2>
          <p className="text-stone-500">مجموعات التصحيح المنظمة حسب التاريخ</p>
        </div>
        <button onClick={onBack} className="text-stone-400 hover:text-stone-900 transition-colors">العودة</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-stone-400" />
          <select 
            value={selectedYear} 
            onChange={(e) => setSelectedYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="bg-stone-50 px-4 py-2 rounded-xl border border-stone-200 outline-none text-sm"
          >
            <option value="all">كل السنوات</option>
            {years.map((y: any) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="bg-stone-50 px-4 py-2 rounded-xl border border-stone-200 outline-none text-sm"
          >
            <option value="all">كل الشهور</option>
            {months.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="mr-auto flex items-center gap-2 text-sm text-stone-400">
          <span>إجمالي المجموعات:</span>
          <span className="font-bold text-stone-900">{filteredSessions.length}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSessions.map((session: any) => (
          <div 
            key={session.id} 
            onClick={() => setSelectedSession(session)}
            className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center text-stone-600 group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
                <Folder className="w-6 h-6" />
              </div>
              <div className="text-[10px] font-bold text-stone-400 bg-stone-50 px-2 py-1 rounded-lg">
                {session.createdAt?.toDate().toLocaleDateString('ar-EG', { month: 'short', year: 'numeric' })}
              </div>
            </div>
            <h3 className="text-lg font-bold mb-2 group-hover:text-emerald-600 transition-colors">{session.examTitle}</h3>
            <div className="flex items-center gap-4 text-xs text-stone-500">
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {session.studentCount} طلاب</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {session.createdAt?.toDate().toLocaleDateString('ar-EG')}</span>
            </div>
            <div className="mt-6 flex items-center justify-between text-xs font-bold text-emerald-600">
              <span>فتح المجموعة</span>
              <ArrowRight className="w-4 h-4 rotate-180" />
            </div>
          </div>
        ))}
        {filteredSessions.length === 0 && (
          <div className="col-span-full py-20 text-center bg-white rounded-3xl border-2 border-dashed border-stone-200">
            <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-8 h-8 text-stone-300" />
            </div>
            <p className="text-stone-400">لا توجد مجموعات تصحيح مطابقة للبحث.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

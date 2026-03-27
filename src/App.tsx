import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Trash2, Save, FileText, Upload, CheckCircle, 
  XCircle, ChevronDown, ChevronUp, Download, LogIn, 
  LogOut, Loader2, FileUp, List, Settings, User,
  HelpCircle, CheckSquare, Type, LayoutGrid
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, addDoc, query, where, onSnapshot, 
  serverTimestamp, doc, updateDoc, deleteDoc, getDoc
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { Question, gradeStudentPaper } from './services/geminiService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type View = 'dashboard' | 'create-exam' | 'grade-papers' | 'results';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExam, setSelectedExam] = useState<any>(null);
  const [editingExam, setEditingExam] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'exams'), where('authorUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setExams(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'results'), where('authorUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setResults(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [user]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
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
            </div>
          </div>
          <div className="flex items-center gap-4">
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
              initialData={editingExam}
              onSave={() => { setEditingExam(null); setView('dashboard'); }} 
              onCancel={() => { setEditingExam(null); setView('dashboard'); }} 
            />
          )}
          {view === 'grade-papers' && (
            <Grader 
              user={user}
              exam={selectedExam} 
              onComplete={() => setView('results')}
              onCancel={() => setView('dashboard')}
            />
          )}
          {view === 'results' && (
            <ResultsView 
              results={results} 
              exams={exams}
              onBack={() => setView('dashboard')}
            />
          )}
        </AnimatePresence>
      </main>
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

function ExamCreator({ user, initialData, onSave, onCancel }: any) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [totalGrade, setTotalGrade] = useState(initialData?.totalGrade || 100);
  const [requiredQuestionsCount, setRequiredQuestionsCount] = useState<number | null>(initialData?.requiredQuestionsCount || null);
  const [questions, setQuestions] = useState<Question[]>(initialData?.questions || []);
  const [isSaving, setIsSaving] = useState(false);

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
      const examData = {
        title,
        totalGrade,
        requiredQuestionsCount: requiredQuestionsCount || questions.length,
        questions,
        authorUid: user.uid,
        updatedAt: serverTimestamp()
      };

      if (initialData?.id) {
        await updateDoc(doc(db, 'exams', initialData.id), examData);
      } else {
        await addDoc(collection(db, 'exams'), {
          ...examData,
          createdAt: serverTimestamp()
        });
      }
      onSave();
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء الحفظ');
    } finally {
      setIsSaving(false);
    }
  };

  const printExam = () => {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    doc.setFont("helvetica");
    doc.text(title, 105, 20, { align: 'center' });
    doc.text(`Total Grade: ${totalGrade}`, 105, 30, { align: 'center' });
    doc.text(`Required Questions: ${requiredQuestionsCount || questions.length}`, 105, 40, { align: 'center' });
    
    let y = 55;
    questions.forEach((q, i) => {
      doc.text(`${i + 1}. ${q.text} (${q.grade} marks)`, 20, y);
      if (q.requiredSubCount && q.subQuestions && q.subQuestions.length > 0) {
        y += 7;
        doc.setFontSize(10);
        doc.text(`   (Answer ${q.requiredSubCount} out of ${q.subQuestions.length} branches)`, 20, y);
        doc.setFontSize(12);
      }
      y += 10;
      if (q.type === 'multiple-choice' && q.options) {
        q.options.forEach(opt => {
          doc.text(`   [ ] ${opt}`, 20, y);
          y += 7;
        });
      } else if (q.type === 'true-false') {
        doc.text(`   ( ) True   ( ) False`, 20, y);
        y += 7;
      } else {
        y += 15; // Space for answer
      }
      if (y > 270) { doc.addPage(); y = 20; }
    });
    doc.save(`${title}.pdf`);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold font-serif italic">
          {initialData ? 'تعديل الامتحان' : 'إنشاء امتحان جديد'}
        </h2>
        <div className="flex gap-3">
          <button onClick={onCancel} className="px-6 py-2 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors">إلغاء</button>
          <button onClick={printExam} className="px-6 py-2 rounded-xl bg-stone-900 text-white flex items-center gap-2 hover:bg-stone-800"><Download className="w-4 h-4" /> معاينة PDF</button>
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

      <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-500">عنوان الامتحان</label>
            <textarea 
              value={title} 
              onChange={(e) => {
                setTitle(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onFocus={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              placeholder="مثال: امتحان اللغة العربية - الفصل الأول"
              rows={1}
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all overflow-hidden resize-none"
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
            <label className="text-sm font-medium text-stone-500">عدد الأسئلة المطلوب الإجابة عليها</label>
            <input 
              type="number" 
              value={requiredQuestionsCount || ''} 
              onChange={(e) => setRequiredQuestionsCount(e.target.value ? Number(e.target.value) : null)}
              placeholder={`الافتراضي: ${questions.length || 0}`}
              className="w-full px-4 py-3 rounded-xl border border-stone-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between border-t border-stone-100 pt-6">
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
                    </div>
                  ))}
                  <div className="flex items-center gap-4 pt-2">
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

function Grader({ user, exam, onComplete, onCancel }: any) {
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isGrading, setIsGrading] = useState(false);
  const [gradingResults, setGradingResults] = useState<any[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setImages([...images, ...newFiles]);
      const newPreviews = newFiles.map(file => URL.createObjectURL(file));
      setPreviews([...previews, ...newPreviews]);
    }
  };

  const startGrading = async () => {
    if (images.length === 0) return alert('يرجى رفع صور أوراق الطلاب');
    setIsGrading(true);
    try {
      const { results } = await gradeStudentPaper(previews, exam.questions, exam.totalGrade, exam.requiredQuestionsCount);
      setGradingResults(results);
      setCurrentResultIndex(0);
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء التصحيح التلقائي');
    } finally {
      setIsGrading(false);
    }
  };

  const saveAllResults = async () => {
    try {
      for (const result of gradingResults) {
        await addDoc(collection(db, 'results'), {
          ...result,
          examId: exam.id,
          examTitle: exam.title,
          authorUid: user.uid,
          createdAt: serverTimestamp()
        });
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
              className="px-8 py-3 rounded-2xl border border-stone-200 font-medium hover:bg-stone-50 transition-colors"
            >
              اختيار الصور
            </button>
            <button 
              onClick={startGrading}
              disabled={images.length === 0 || isGrading}
              className="px-8 py-3 rounded-2xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
            >
              {isGrading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
              بدء التصحيح الذكي
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
              {currentGrading.gradings.map((g: any, i: number) => {
                // Find question or sub-question
                let question: any = null;
                exam.questions.forEach((q: any) => {
                  if (q.id === g.questionId) question = q;
                  q.subQuestions?.forEach((sq: any) => {
                    if (sq.id === g.questionId) question = sq;
                  });
                });

                return (
                  <div key={i} className="p-6 bg-stone-50 rounded-2xl border border-stone-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold">سؤال {i + 1}: {question?.text}</span>
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
                        <span className="text-stone-400">/ {question?.grade}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="space-y-1">
                        <span className="text-stone-400 block">إجابة الطالب:</span>
                        <p className="p-3 bg-white rounded-xl border border-stone-100 italic">"{g.studentAnswer}"</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-stone-400 block">الإجابة النموذجية:</span>
                        <p className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-800">"{question?.answer}"</p>
                      </div>
                    </div>
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

function ResultsView({ results, exams, onBack }: any) {
  const exportPDF = (result: any) => {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    doc.setFont("helvetica");
    doc.text(`Exam Results: ${result.examTitle}`, 105, 20, { align: 'center' });
    doc.text(`Student: ${result.studentName}`, 105, 30, { align: 'center' });
    doc.text(`Total Grade: ${result.totalGrade}`, 105, 40, { align: 'center' });

    const tableData = result.gradings.map((g: any, i: number) => [
      i + 1,
      g.studentAnswer,
      g.grade,
      g.feedback
    ]);

    autoTable(doc, {
      startY: 50,
      head: [['#', 'Student Answer', 'Grade', 'Feedback']],
      body: tableData,
    });

    doc.save(`${result.studentName}_result.pdf`);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif italic">نتائج الطلاب</h2>
          <p className="text-stone-500">سجل بجميع الأوراق التي تم تصحيحها</p>
        </div>
        <button onClick={onBack} className="text-stone-400 hover:text-stone-900 transition-colors">العودة</button>
      </div>

      <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
        <table className="w-full text-right">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200">
              <th className="px-6 py-4 font-bold text-stone-500 text-sm text-right">اسم الطالب</th>
              <th className="px-6 py-4 font-bold text-stone-500 text-sm text-right">الامتحان</th>
              <th className="px-6 py-4 font-bold text-stone-500 text-sm text-right">الدرجة</th>
              <th className="px-6 py-4 font-bold text-stone-500 text-sm text-right">التاريخ</th>
              <th className="px-6 py-4 font-bold text-stone-500 text-sm text-left">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {results.map((res: any) => (
              <tr key={res.id} className="hover:bg-stone-50 transition-colors">
                <td className="px-6 py-4 font-bold">{res.studentName}</td>
                <td className="px-6 py-4 text-stone-500">{res.examTitle}</td>
                <td className="px-6 py-4">
                  <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full font-bold text-sm">
                    {res.totalGrade}
                  </span>
                </td>
                <td className="px-6 py-4 text-stone-400 text-sm">
                  {res.createdAt?.toDate().toLocaleDateString('ar-EG')}
                </td>
                <td className="px-6 py-4 text-left">
                  <button 
                    onClick={() => exportPDF(res)}
                    className="p-2 text-stone-400 hover:text-emerald-600 transition-colors"
                    title="تحميل PDF"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-20 text-center text-stone-400">
                  لا توجد نتائج مسجلة بعد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

// Smart Grader - AI Powered Exam System (Netlify Optimized)
import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Trash2, Save, FileText, Upload, CheckCircle, 
  XCircle, ChevronDown, ChevronUp, Download, LogIn, 
  LogOut, Loader2, FileUp, List, Settings, User,
  HelpCircle, CheckSquare, Type, LayoutGrid, Image as ImageIcon,
  ArrowRight, Calendar, Folder, FolderOpen, Users, Camera, Layers,
  Phone, MessageCircle, Printer, BookOpen, PlusCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, addDoc, query, where, onSnapshot, 
  serverTimestamp, doc, updateDoc, deleteDoc, getDoc, setDoc,
  getDocFromServer, increment, getDocs, writeBatch, orderBy
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import { Question, gradeStudentPaper, extractExamFromImages, extractExamFromDualImages } from './services/geminiService';
import jsPDF from 'jspdf';

const ARABIC_BRANCH_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function ContactButtons({ className }: { className?: string }) {
  return (
    <div className={cn("bg-white/50 backdrop-blur-sm p-4 rounded-2xl border border-white/50 space-y-3 mt-8 max-w-sm w-full", className)}>
      <p className="text-stone-500 text-sm font-bold text-center mb-2">للتواصل مع الإدارة والتفعيل:</p>
      <div className="grid grid-cols-1 gap-2">
        <a 
          href="tel:07706118992" 
          className="flex items-center justify-center gap-2 text-stone-700 bg-white border border-stone-200 py-2.5 rounded-xl font-bold hover:bg-stone-50 transition-all shadow-sm group"
        >
          <Phone className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
          <span dir="ltr">07706118992</span>
        </a>
        <a 
          href="https://wa.me/9647706118992" 
          target="_blank" 
          rel="noreferrer"
          translate="no"
          className="bg-[#25D366] text-white py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-sm group"
        >
          <MessageCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
          تواصل عبر واتساب
        </a>
      </div>
    </div>
  );
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
      let technicalDetails = "";
      
      try {
        if (this.state.error?.message) {
          try {
            const parsed = JSON.parse(this.state.error.message);
            if (parsed.error) {
              errorMessage = `خطأ في قاعدة البيانات: ${parsed.error}`;
            } else {
              errorMessage = this.state.error.message;
            }
          } catch (e) {
            // Not a JSON error, just use the raw message
            errorMessage = this.state.error.message;
          }
        }
        
        // Add technical details for debugging
        technicalDetails = this.state.error?.stack || String(this.state.error);
      } catch (e) {}

      return (
        <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4 text-center" dir="rtl">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-200">
            <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-stone-900 mb-2">عذراً، حدث خطأ</h2>
            <p className="text-stone-600 mb-4">{errorMessage}</p>
            
            {technicalDetails && (
              <details className="mb-6 text-right">
                <summary className="text-[10px] text-stone-400 cursor-pointer hover:text-stone-600">التفاصيل التقنية (للمطور)</summary>
                <pre className="mt-2 p-3 bg-stone-50 rounded-xl text-[8px] text-stone-500 text-left overflow-auto max-h-32 dir-ltr">
                  {technicalDetails}
                </pre>
              </details>
            )}

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
  questionsCount: number;
  gradingsCount: number;
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

// --- PDF Generation Utility ---
const generatePDFFromElement = async (element: HTMLElement, fileName: string, options: { padding?: string, useElementWidth?: boolean, ignoreImages?: boolean } = {}) => {
  try {
    console.log(`[PDF] Starting generation for: ${fileName}, ignoreImages: ${!!options.ignoreImages}`);
    
    // Check if element is valid
    if (!element) {
      throw new Error('العنصر المطلوب تصويره غير موجود');
    }

    // Ensure element has some visibility/dimensions for html2canvas
    const originalStyle = element.style.cssText;
    if (element.offsetHeight === 0) {
      console.warn('[PDF] Element has 0 height, attempting to force dimensions');
      element.style.display = 'block';
      element.style.visibility = 'visible';
      element.style.position = 'relative';
    }

    // Ensure all images are loaded before capturing (only if not ignoring them)
    if (!options.ignoreImages) {
      const images = element.getElementsByTagName('img');
      await Promise.all(Array.from(images).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      }));
    }

    // Small delay to ensure styles and images are fully rendered
    await new Promise(resolve => setTimeout(resolve, options.ignoreImages ? 600 : 1200));

    const canvas = await html2canvas(element, {
      scale: 2, 
      useCORS: !options.ignoreImages,
      allowTaint: false, 
      logging: true, // Enable logging for debugging
      backgroundColor: '#ffffff',
      windowWidth: options.useElementWidth ? (element.scrollWidth || 1200) : 1200,
      onclone: (clonedDoc, clonedElement) => {
        if (clonedElement instanceof HTMLElement) {
          clonedElement.style.position = 'static';
          clonedElement.style.visibility = 'visible';
          clonedElement.style.display = 'block';
          clonedElement.style.opacity = '1';
          clonedElement.style.width = '210mm';
          clonedElement.style.margin = '0';
          clonedElement.style.boxSizing = 'border-box';
          
          if (options.padding) {
            clonedElement.style.padding = options.padding;
          }

          // Aggressively remove oklch from all elements in the clone
          // html2canvas fails when it encounters oklch() in computed styles
          const allElements = clonedElement.querySelectorAll('*');
          allElements.forEach(el => {
            if (el instanceof HTMLElement) {
              // Remove any inline styles that might use oklch
              const style = el.getAttribute('style');
              if (style && style.includes('oklch')) {
                el.setAttribute('style', style.replace(/oklch\([^)]+\)/g, '#888'));
              }
            }
          });

          // Remove problematic CSS rules from the cloned document to prevent html2canvas from crashing
          try {
            const styleSheets = Array.from(clonedDoc.styleSheets);
            styleSheets.forEach(sheet => {
              try {
                const rules = Array.from(sheet.cssRules);
                for (let i = rules.length - 1; i >= 0; i--) {
                  if (rules[i].cssText.includes('oklch')) {
                    sheet.deleteRule(i);
                  }
                }
              } catch (e) { /* Ignore cross-origin sheet errors */ }
            });
          } catch (e) { /* Ignore global errors */ }

          // Inject a style tag to override Tailwind 4's oklch variables with safe hex values
          const styleTag = clonedDoc.createElement('style');
          styleTag.innerHTML = `
            :root, * {
              --color-stone-50: #fafaf9 !important;
              --color-stone-100: #f5f5f4 !important;
              --color-stone-200: #e7e5e4 !important;
              --color-stone-300: #d6d3d1 !important;
              --color-stone-400: #a8a29e !important;
              --color-stone-500: #78716c !important;
              --color-stone-600: #57534e !important;
              --color-stone-700: #44403c !important;
              --color-stone-800: #292524 !important;
              --color-stone-900: #1c1917 !important;
              --color-emerald-50: #ecfdf5 !important;
              --color-emerald-100: #d1fae5 !important;
              --color-emerald-600: #059669 !important;
              --color-emerald-700: #047857 !important;
              --color-emerald-800: #065f46 !important;
              --color-red-500: #ef4444 !important;
              --color-red-600: #dc2626 !important;
            }
            /* Force hex for common classes */
            .bg-emerald-600 { background-color: #059669 !important; }
            .text-emerald-600 { color: #059669 !important; }
            .bg-stone-900 { background-color: #1c1917 !important; }
            .text-stone-900 { color: #1c1917 !important; }
          `;
          clonedDoc.head.appendChild(styleTag);
          
          const clonedImages = clonedElement.getElementsByTagName('img');
          for (let i = 0; i < clonedImages.length; i++) {
            if (options.ignoreImages) {
              clonedImages[i].style.display = 'none';
            } else {
              if (!clonedImages[i].src.startsWith('data:')) {
                clonedImages[i].crossOrigin = 'anonymous';
              }
              clonedImages[i].style.display = 'block';
              clonedImages[i].style.maxWidth = '100%';
            }
          }
        }
      }
    });
    
    // Restore original style if modified
    if (originalStyle) {
      element.style.cssText = originalStyle;
    }

    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error(`أبعاد الصفحة غير صالحة (W: ${canvas.width}, H: ${canvas.height})`);
    }

    const imgData = canvas.toDataURL('image/jpeg', 0.9); 
    if (imgData === 'data:,') throw new Error('فشل استخراج بيانات الصورة من الصفحة');

    const pdf = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4'
    });
    
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const imgProps = pdf.getImageProperties(imgData);
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
    
    const pageHeight = pdf.internal.pageSize.getHeight();
    let heightLeft = pdfHeight;
    let position = 0;

    pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - pdfHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(fileName);
    console.log(`[PDF] Successfully saved: ${fileName}`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    const errorMsg = error instanceof Error ? error.message : 'خطأ غير معروف';
    alert(`عذراً، حدث خطأ تقني أثناء إنشاء ملف PDF: ${errorMsg}. يرجى محاولة فتح تفاصيل الطالب أولاً ثم التحميل.`);
  }
};

function GradingResultItem({ question, gradings, onGradeChange, level = 1 }: any) {
  const grading = gradings?.find((g: any) => g.questionId === question.id);
  const hasSub = question.subQuestions && question.subQuestions.length > 0;
  
  // Try to extract a clean label (e.g., "س1" or "أ")
  let label = question.text.split(/[:\-\.\/\(\)\[\]]/)[0].trim();
  if (label.length > 15 || label.length === 0) label = "";

  return (
    <div className={cn(
      "p-4 md:p-6 rounded-2xl border space-y-3 transition-all",
      level === 1 ? "bg-stone-50 border-stone-100 shadow-sm" : "bg-white border-stone-50 mr-2 md:mr-6"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2 flex-1">
          <div className="flex items-start gap-2">
            <span className="font-bold text-stone-700 whitespace-nowrap">
              {level === 1 ? "سؤال " : ""}{label || ""}:
            </span>
            <span className="text-stone-800">{question.text}</span>
          </div>
          {question.questionImage && (
            <img 
              src={question.questionImage} 
              alt="سؤال" 
              className="w-48 h-auto max-h-64 object-contain rounded-xl border border-stone-200 mt-2" 
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
            />
          )}
        </div>
        {!hasSub && grading && (
          <div className="flex items-center gap-2 mr-4">
            {onGradeChange ? (
              <input 
                type="number" 
                value={grading.grade} 
                onChange={(e) => onGradeChange(question.id, Number(e.target.value))}
                className="w-16 px-2 py-1 rounded-lg border border-stone-200 text-center font-bold text-emerald-600 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            ) : (
              <div className="px-4 py-2 bg-white rounded-xl border border-stone-200 font-bold text-emerald-600 shadow-sm">
                {grading.grade}
              </div>
            )}
            <span className="text-stone-400 font-medium">/ {question.grade || '?'}</span>
          </div>
        )}
      </div>

      {!hasSub && grading && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div className="space-y-2">
              <span className="text-stone-400 font-bold flex items-center gap-1 uppercase tracking-wider text-[10px]">
                <User className="w-3 h-3" /> إجابة الطالب:
              </span>
              <p className="p-4 bg-white rounded-2xl border border-stone-100 italic text-stone-700 leading-relaxed shadow-sm">"{grading.studentAnswer}"</p>
            </div>
            <div className="space-y-2">
              <span className="text-stone-400 font-bold flex items-center gap-1 uppercase tracking-wider text-[10px]">
                <CheckCircle className="w-3 h-3" /> الإجابة النموذجية:
              </span>
              <div className="flex flex-col gap-3">
                <p className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 text-emerald-900 leading-relaxed shadow-sm">"{question.answer || 'غير متوفرة'}"</p>
                {question.answerImage && (
                  <img 
                    src={question.answerImage} 
                    alt="إجابة نموذجية" 
                    className="w-48 h-auto max-h-64 object-contain rounded-xl border border-emerald-100" 
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                  />
                )}
              </div>
            </div>
          </div>
          {grading.feedback && (
            <div className="pt-4 border-t border-stone-100">
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1">
                <FileText className="w-3 h-3" /> ملاحظات المصحح:
              </span>
              <p className="text-stone-600 mt-2 leading-relaxed bg-stone-100/50 p-3 rounded-xl">{grading.feedback}</p>
            </div>
          )}
        </div>
      )}

      {hasSub && (
        <div className="space-y-4 mt-6 border-r-2 border-stone-100 pr-2">
          {question.subQuestions.map((sq: any) => (
            <GradingResultItem 
              key={sq.id} 
              question={sq} 
              gradings={gradings} 
              onGradeChange={onGradeChange} 
              level={level + 1} 
            />
          ))}
        </div>
      )}
    </div>
  );
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
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setPendingCount(0);
      return;
    }
    
    const isAdminEmail = user.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com';
    const isAdminRole = userProfile?.role === 'admin';
    
    if (!isAdminEmail && !isAdminRole) {
      setPendingCount(0);
      return;
    }

    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allUsers = snapshot.docs.map(doc => doc.data());
      const pCount = allUsers.filter((u: any) => !u.status || u.status === 'pending').length;
      console.log("Nav: Calculated pending count (inclusive):", pCount);
      setPendingCount(pCount);
    }, (error) => console.error("Pending users listener error:", error));
    return () => unsubscribe();
  }, [user?.email, userProfile?.role]);

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
            let data = userDoc.data() as UserProfile;
            const isAdminEmail = u.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com';
            
            // Auto-approve if status is pending or missing
            if (data.status !== 'approved' && data.status !== 'rejected') {
              console.log("Auth: Auto-approving existing pending user...");
              await updateDoc(userDocRef, { status: 'approved' });
              data.status = 'approved';
            }

            if (isAdminEmail && data.role !== 'admin') {
              console.log("Auth: Updating admin role...");
              await updateDoc(userDocRef, { role: 'admin' });
              data.role = 'admin';
            }
            console.log("Auth: User profile loaded:", data);
            setUserProfile(data);
          } else {
            console.log("Auth: No user profile found. Creating new profile...");
            const isAdminEmail = u.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com';
            const newProfile: UserProfile = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || '',
              status: 'approved',
              role: isAdminEmail ? 'admin' : 'user',
              pageLimit: 100,
              pagesUsed: 0,
              questionsCount: 0,
              gradingsCount: 0,
              createdAt: serverTimestamp()
            };
            await setDoc(userDocRef, newProfile);
            console.log("Auth: New profile created:", newProfile);
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
      
      const errorMessage = error.message || "";
      const isMissingInitialState = errorMessage.includes("missing initial state") || 
                                   errorMessage.includes("sessionStorage is inaccessible");
      
      if (error.code === 'auth/unauthorized-domain') {
        alert("خطأ: هذا النطاق غير مصرح به في إعدادات Firebase. يرجى التأكد من إضافة رابط المعاينة الحالي في Firebase Console > Authentication > Settings > Authorized domains.");
      } else if (isMissingInitialState) {
        alert("تنبيه: تعذر إكمال تسجيل الدخول بسبب قيود في المتصفح أو بيئة العرض (Iframe).\n\nالحل: يرجى الضغط على زر 'Open in new tab' أو 'فتح في نافذة جديدة' في أعلى الصفحة لتشغيل التطبيق بشكل مستقل، ثم حاول تسجيل الدخول مرة أخرى.");
      } else {
        alert("حدث خطأ أثناء تسجيل الدخول: " + errorMessage);
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
          
          <ContactButtons />
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
                translate="no"
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
          <div className="mb-6">
            <ContactButtons />
          </div>
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
              className="text-lg md:text-xl font-bold font-serif italic cursor-pointer whitespace-nowrap"
              onClick={() => setView('dashboard')}
            >
              المصحح الذكي
            </h1>
            <div className="hidden md:flex items-center gap-4">
              <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<LayoutGrid className="w-4 h-4" />} label="لوحة التحكم" />
              <NavButton active={view === 'create-exam'} onClick={() => setView('create-exam')} icon={<Plus className="w-4 h-4" />} label="إنشاء امتحان" />
              <NavButton active={view === 'results'} onClick={() => setView('results')} icon={<List className="w-4 h-4" />} label="النتائج" />
              {(userProfile?.role === 'admin' || user.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com') && (
                <div className="relative">
                  <NavButton active={view === 'admin'} onClick={() => setView('admin')} icon={<Users className="w-4 h-4" />} label="الإدارة" />
                  {pendingCount > 0 && (
                    <span className="absolute -top-1 -left-1 w-5 h-5 bg-red-600 text-white text-[10px] font-black rounded-full flex items-center justify-center animate-bounce shadow-lg ring-2 ring-white">
                      {pendingCount}
                    </span>
                  )}
                </div>
              )}
              <div className="h-4 w-px bg-stone-200 mx-2 hidden xl:block" />
              <div className="hidden xl:flex items-center gap-4">
                <a href="tel:07706118992" className="flex items-center gap-1.5 text-[10px] font-black text-stone-400 uppercase tracking-tighter hover:text-emerald-600 transition-colors">
                  <Phone className="w-3 h-3" />
                  اتصال
                </a>
                <a href="https://wa.me/9647706118992" target="_blank" rel="noreferrer" translate="no" className="flex items-center gap-1.5 text-[10px] font-black text-stone-400 uppercase tracking-tighter hover:text-[#25D366] transition-colors">
                  <MessageCircle className="w-3 h-3" />
                  واتساب
                </a>
              </div>
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
            {user.email === 'asmaomar5566@gmail.com' && (
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
            )}
            <div className="flex items-center gap-2 px-1.5 md:px-3 py-1.5 bg-stone-100 rounded-full">
              <img src={user.photoURL || ''} alt="" className="w-6 h-6 rounded-full" />
              <span className="hidden sm:inline text-sm font-medium">{user.displayName}</span>
            </div>
            <button onClick={logout} className="p-2 text-stone-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Bottom Navigation for Mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-stone-200 z-50 px-2 py-1 pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
        <div className="flex items-center justify-around max-w-md mx-auto">
          <NavButton mobile active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<LayoutGrid className="w-5 h-5" />} label="الرئيسية" />
          <NavButton mobile active={view === 'create-exam'} onClick={() => setView('create-exam')} icon={<Plus className="w-5 h-5" />} label="امتحان" />
          <NavButton mobile active={view === 'results'} onClick={() => setView('results')} icon={<List className="w-5 h-5" />} label="النتائج" />
          {(userProfile?.role === 'admin' || user.email?.toLowerCase().trim() === 'asmaomar5566@gmail.com') && (
            <div className="relative">
              <NavButton mobile active={view === 'admin'} onClick={() => setView('admin')} icon={<Users className="w-5 h-5" />} label="الإدارة" />
              {pendingCount > 0 && (
                <span className="absolute -top-1 -left-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-bounce border-2 border-white shadow-sm">
                  {pendingCount}
                </span>
              )}
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-2 sm:p-4 md:p-8 pb-24 md:pb-8">
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
              sessions={sessions}
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
          {view === 'admin' && (userProfile?.role === 'admin' || user.email === 'asmaomar5566@gmail.com') && (
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
    console.log("AdminDashboard: Starting users listener...");
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log("AdminDashboard: Received users snapshot, size:", snapshot.size);
      const fetchedUsers = snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserProfile));
      console.log("AdminDashboard: Users data:", fetchedUsers);
      setUsers(fetchedUsers);
      setLoading(false);
    }, (error) => {
      console.error("AdminDashboard: Admin view users listener error:", error);
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

  const pendingUsers = users.filter(u => !u.status || (u.status as string) === 'pending');
  const activeUsers = users.filter(u => (u.status as string) === 'approved' && (u.role !== 'admin' || u.email?.toLowerCase()?.trim() === 'asmaomar5566@gmail.com'));

  useEffect(() => {
    console.log("AdminDashboard Check: Total users:", users.length);
    console.log("AdminDashboard Check: Pending users:", pendingUsers.length);
    console.log("AdminDashboard Check: Active users:", activeUsers.length);
    if (users.length > 0) {
      console.log("AdminDashboard Check: First user status:", users[0].status);
    }
  }, [users, pendingUsers.length, activeUsers.length]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 md:space-y-8 pb-10"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-bold font-serif italic">لوحة تحكم المدير</h2>
          <p className="text-xs text-stone-400">إدارة المستخدمين والصلاحيات وباقات الصفحات</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-xl text-sm font-bold shadow-sm">
            إجمالي السجلات في القاعدة: {users.length}
          </div>
          <div className="bg-stone-100 text-stone-600 px-4 py-2 rounded-xl text-sm font-bold shadow-sm flex items-center gap-2">
            قيد الانتظار: {pendingUsers.length}
          </div>
        </div>
      </div>

      {users.length === 0 && !loading && (
        <div className="p-12 text-center bg-white rounded-3xl border-2 border-dashed border-stone-200 text-stone-400">
          لم يتم العثور على أي مستخدمين في قاعدة البيانات. 
          <br/>
          تأكد من أنك مسجل دخول بالحساب الصحيح وأن الحسابات الأخرى قد أكملت عملية التسجيل.
        </div>
      )}

      {pendingUsers.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-amber-600 flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            طلبات انضمام جديدة ({pendingUsers.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingUsers.map(u => (
              <div key={u.uid} className="bg-white p-6 rounded-3xl border border-amber-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4 w-full">
                  <div className="w-12 h-12 bg-stone-100 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-stone-400">
                    {u.displayName?.charAt(0) || u.email?.charAt(0) || '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold truncate">{u.displayName || 'بدون اسم'}</p>
                    <p className="text-xs text-stone-400 truncate">{u.email}</p>
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button 
                    onClick={() => updateUserStatus(u.uid, 'approved')}
                    className="flex-1 sm:flex-none bg-emerald-600 text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors"
                  >
                    قبول
                  </button>
                  <button 
                    onClick={() => updateUserStatus(u.uid, 'rejected')}
                    className="flex-1 sm:flex-none bg-red-50 text-red-600 px-6 py-2 rounded-xl text-sm font-bold hover:bg-red-100 transition-colors"
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
        
        {/* Desktop Table */}
        <div className="hidden lg:block bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-sm">
          <table className="w-full text-right">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">المستخدم</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">الاستهلاك (صفحات)</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">أسئلة مستخرجة</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">أوراق مصححة</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">الحد</th>
                <th className="px-6 py-4 text-sm font-bold text-stone-500">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {activeUsers.map(u => (
                <tr key={u.uid} className="hover:bg-stone-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-stone-100 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-stone-400">
                        {u.displayName?.charAt(0) || u.email?.charAt(0) || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{u.displayName || 'بدون اسم'}</p>
                        <p className="text-[10px] text-stone-400 truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                        <div 
                          className={cn("h-full transition-all", (u.pagesUsed || 0) / (u.pageLimit || 1) > 0.9 ? "bg-red-500" : "bg-emerald-500")}
                          style={{ width: `${Math.min(100, ((u.pagesUsed || 0) / (u.pageLimit || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold">{u.pagesUsed || 0}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-stone-600">{u.questionsCount || 0}</td>
                  <td className="px-6 py-4 text-sm font-medium text-stone-600">{u.gradingsCount || 0}</td>
                  <td className="px-6 py-4">
                    <select 
                      value={u.pageLimit}
                      onChange={(e) => updateUserLimit(u.uid, Number(e.target.value))}
                      className="w-28 bg-stone-50 px-3 py-1.5 rounded-lg border border-stone-200 text-xs outline-none focus:ring-2 focus:ring-emerald-500 text-center font-bold cursor-pointer"
                    >
                      <option value="100">100 صفحة</option>
                      <option value="500">500 صفحة</option>
                      <option value="1000">1000 صفحة</option>
                      <option value="1500">1500 صفحة</option>
                      <option value="2000">2000 صفحة</option>
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
            </tbody>
          </table>
        </div>

        {/* Mobile/Tablet Cards */}
        <div className="lg:hidden space-y-4">
          {activeUsers.map(u => (
            <div key={u.uid} className="bg-white p-5 rounded-3xl border border-stone-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-stone-100 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-stone-400">
                    {u.displayName?.charAt(0) || u.email?.charAt(0) || '?'}
                  </div>
                  <div>
                    <p className="font-bold text-sm">{u.displayName || 'بدون اسم'}</p>
                    <p className="text-[10px] text-stone-400">{u.email}</p>
                  </div>
                </div>
                <button 
                  onClick={() => deleteUser(u.uid)}
                  className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 py-3 border-y border-stone-50">
                <div className="text-center">
                  <p className="text-[10px] text-stone-400 mb-1">صفحات</p>
                  <p className="text-sm font-bold text-emerald-600">{u.pagesUsed}</p>
                </div>
                <div className="text-center border-x border-stone-100">
                  <p className="text-[10px] text-stone-400 mb-1">أسئلة</p>
                  <p className="text-sm font-bold text-stone-700">{u.questionsCount || 0}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-stone-400 mb-1">تصحيح</p>
                  <p className="text-sm font-bold text-stone-700">{u.gradingsCount || 0}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-stone-400">الاستهلاك</span>
                    <span className="font-bold">{Math.round((u.pagesUsed / u.pageLimit) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div 
                      className={cn("h-full", u.pagesUsed / u.pageLimit > 0.9 ? "bg-red-500" : "bg-emerald-500")}
                      style={{ width: `${Math.min(100, (u.pagesUsed / u.pageLimit) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="w-28">
                  <p className="text-[10px] text-stone-400 mb-1">الحد المسموح</p>
                  <select 
                    value={u.pageLimit}
                    onChange={(e) => updateUserLimit(u.uid, Number(e.target.value))}
                    className="w-full bg-stone-50 px-2 py-1.5 rounded-lg border border-stone-200 text-xs outline-none font-bold cursor-pointer"
                  >
                    <option value="100">100</option>
                    <option value="500">500</option>
                    <option value="1000">1000</option>
                    <option value="1500">1500</option>
                    <option value="2000">2000</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>

        {activeUsers.length === 0 && (
          <div className="bg-stone-50 p-12 rounded-3xl border border-dashed border-stone-200 text-center text-stone-400 text-sm">
            لا يوجد مستخدمين نشطين حالياً
          </div>
        )}
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
            crossOrigin="anonymous"
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

function NavButton({ active, onClick, icon, label, mobile = false }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, mobile?: boolean }) {
  return (
    <button 
      onClick={onClick}
      translate="no"
      className={cn(
        "flex items-center transition-all",
        mobile 
          ? "flex-col gap-1 px-2 py-1 flex-1" 
          : "gap-2 px-4 py-2 rounded-xl text-sm font-medium",
        active 
          ? (mobile ? "text-emerald-600" : "bg-emerald-50 text-emerald-700") 
          : "text-stone-500 hover:bg-stone-100"
      )}
    >
      <div className={cn(mobile && "p-1 rounded-lg", active && mobile && "bg-emerald-50")}>
        {icon}
      </div>
      <span className={cn(mobile ? "text-[10px] font-bold" : "text-sm")}>{label}</span>
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold font-serif italic mb-1">مرحباً بك مجدداً</h2>
          <p className="text-sm md:text-base text-stone-500">إليك الامتحانات التي قمت بإنشائها</p>
        </div>
        <button 
          onClick={onNewExam}
          translate="no"
          className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-medium flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20 w-full md:w-auto"
        >
          <Plus className="w-5 h-5" />
          امتحان جديد
        </button>
      </div>

      <div className="bg-stone-50 border border-stone-200 p-6 rounded-3xl flex flex-col md:flex-row items-center gap-6 justify-between">
        <div className="space-y-1 text-center md:text-right">
          <h3 className="font-bold text-stone-800">هل تحتاج مساعدة في التفعيل؟</h3>
          <p className="text-sm text-stone-500">تواصل معنا لتفعيل حسابك أو لطلب الدعم الفني</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
          <a href="tel:07706118992" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-white border border-stone-200 px-6 py-3 rounded-xl font-bold hover:bg-stone-100 transition-all shadow-sm">
            <Phone className="w-4 h-4 text-emerald-600" />
            <span dir="ltr">07706118992</span>
          </a>
          <a href="https://wa.me/9647706118992" target="_blank" rel="noreferrer" translate="no" className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#25D366] text-white px-6 py-3 rounded-xl font-bold hover:opacity-90 transition-all shadow-sm">
            <MessageCircle className="w-4 h-4" />
            واتساب الدعم
          </a>
        </div>
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
  const [savingStatus, setSavingStatus] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [showPrintMenu, setShowPrintMenu] = useState(false);
  const [printMode, setPrintMode] = useState<'questions' | 'both'>('questions');
  const [extractionImages, setExtractionImages] = useState<string[]>([]);
  const [dualQImages, setDualQImages] = useState<string[]>([]);
  const [dualAImages, setDualAImages] = useState<string[]>([]);
  const [extractionMode, setExtractionMode] = useState<'single' | 'dual' | 'manual' | null>(null);

  const extractionInputRef = useRef<HTMLInputElement>(null);
  const extractionCameraInputRef = useRef<HTMLInputElement>(null);
  const dualQInputRef = useRef<HTMLInputElement>(null);
  const dualAInputRef = useRef<HTMLInputElement>(null);
  const examPrintRef = useRef<HTMLDivElement>(null);
  const examFullPrintRef = useRef<HTMLDivElement>(null);

  const uploadImageToStorage = async (base64: string, path: string) => {
    if (!base64 || !base64.startsWith('data:image')) return base64;
    
    setSavingStatus('جاري رفع الصور...');
    console.log(`[Storage] Starting upload to: ${path}`);
    try {
      const storageRef = ref(storage, path);
      
      // Convert base64 to Blob for more reliable upload
      const response = await fetch(base64);
      const blob = await response.blob();
      
      // Add a timeout to the upload
      const uploadPromise = uploadBytes(storageRef, blob);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Upload timeout')), 45000)
      );
      
      await Promise.race([uploadPromise, timeoutPromise]);
      
      const url = await getDownloadURL(storageRef);
      console.log(`[Storage] Upload successful: ${url}`);
      return url;
    } catch (error) {
      console.error(`[Storage] Error uploading image to ${path}:`, error);
      // Fallback to base64 so the save can at least attempt to proceed
      return base64; 
    }
  };

  const processQuestionsForStorage = async (qs: Question[]): Promise<Question[]> => {
    if (!qs || qs.length === 0) return [];
    
    const processed = [];
    console.log(`[Storage] Processing ${qs.length} questions...`);
    
    let count = 0;
    for (const q of qs) {
      count++;
      setSavingStatus(`جاري معالجة السؤال ${count} من ${qs.length}...`);
      const newQ = { ...q };
      
      // 1. Process sub-questions recursively
      if (q.subQuestions && q.subQuestions.length > 0) {
        newQ.subQuestions = await processQuestionsForStorage(q.subQuestions);
      } else {
        newQ.subQuestions = [];
      }
      
      // 2. Upload images for the current question in parallel
      const uploadTasks = [];
      
      if (q.questionImage && q.questionImage.startsWith('data:image')) {
        uploadTasks.push(
          uploadImageToStorage(q.questionImage, `exams/${user.uid}/${q.id}_q_${Date.now()}`)
            .then(url => { newQ.questionImage = url; })
        );
      }
      
      if (q.answerImage && q.answerImage.startsWith('data:image')) {
        uploadTasks.push(
          uploadImageToStorage(q.answerImage, `exams/${user.uid}/${q.id}_a_${Date.now()}`)
            .then(url => { newQ.answerImage = url; })
        );
      }
      
      if (uploadTasks.length > 0) {
        await Promise.all(uploadTasks);
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
    if (extractionMode === 'single' && extractionImages.length === 0) return;
    if (extractionMode === 'dual' && (dualQImages.length === 0 || dualAImages.length === 0)) {
      alert('يرجى اختيار صور الأسئلة والأجوبة معاً');
      return;
    }

    setIsExtracting(true);
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const apiKey = urlParams.get('key') || localStorage.getItem('GEMINI_API_KEY_AUTO') || import.meta.env.VITE_GEMINI_API_KEY;
      
      if (!apiKey) {
        alert('يرجى توفير مفتاح API أولاً');
        return;
      }

      let result;
      if (extractionMode === 'single') {
        result = await extractExamFromImages(extractionImages, apiKey);
      } else {
        result = await extractExamFromDualImages(dualQImages, dualAImages, apiKey);
      }

      console.log('Extraction result:', result);
      
      if (result.title) setTitle(result.title);
      if (result.requiredQuestionsCount) setRequiredQuestionsCount(result.requiredQuestionsCount);
      
      if (result.questions && result.questions.length > 0) {
        // Update user pagesUsed
        if (userProfile) {
          const totalPages = extractionMode === 'single' ? extractionImages.length : (dualQImages.length + dualAImages.length);
          try {
            await setDoc(doc(db, 'users', user.uid), {
              pagesUsed: (userProfile.pagesUsed || 0) + totalPages,
              questionsCount: (userProfile.questionsCount || 0) + (result.questions?.length || 0)
            }, { merge: true });
          } catch (e) {
            handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
          }
        }

        const ensureIds = (qs: Question[]): Question[] => {
          return qs.map(q => ({
            ...q,
            id: q.id || Math.random().toString(36).substr(2, 9),
            subQuestions: q.subQuestions ? ensureIds(q.subQuestions) : []
          }));
        };
        setQuestions(ensureIds(result.questions));
        alert('تم استخراج الأسئلة والأجوبة بنجاح');
      } else {
        alert('تمت المعالجة ولكن لم يتم العثور على بيانات واضحة. يرجى التأكد من جودة الصور.');
      }
      
      setExtractionImages([]);
      setDualQImages([]);
      setDualAImages([]);
      setExtractionMode(null);
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء استخراج البيانات');
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
    if (!title || questions.length === 0) {
      if (extractionMode === 'dual' && (dualQImages.length > 0 || dualAImages.length > 0)) {
        if (dualQImages.length === 0 || dualAImages.length === 0) {
          alert('يرجى رفع صور الأسئلة والأجوبة معاً لإتمام العملية بنجاح');
          return;
        }
      }
      return alert('يرجى إدخال عنوان الامتحان وسؤال واحد على الأقل، أو استكمال استخراج الأسئلة من الصور');
    }
    setIsSaving(true);
    setSavingStatus('جاري التحضير للحفظ...');
    try {
      const processedQuestions = await processQuestionsForStorage(questions);
      
      setSavingStatus('جاري حفظ البيانات في قاعدة البيانات...');
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
      // Add padding to ensure content is not cut off and has nice margins
      await generatePDFFromElement(ref.current, `${title || 'exam'}_${mode}.pdf`, { 
        useElementWidth: true,
        padding: '15mm' 
      });
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-4xl mx-auto space-y-8 px-0.5 sm:px-0"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4" data-html2canvas-ignore>
        <h2 className="text-2xl md:text-3xl font-bold font-serif italic">
          {initialData ? 'تعديل الامتحان' : 'إنشاء امتحان جديد'}
        </h2>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={onCancel} className="flex-1 md:flex-none px-6 py-2 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors">إلغاء</button>
          {questions.length > 0 && (
            <div className="flex gap-2 flex-grow md:flex-grow-0">
               <div className="relative">
                <button 
                  onClick={() => setShowPrintMenu(!showPrintMenu)}
                  className="w-full md:w-auto px-4 py-2 rounded-xl bg-stone-100 text-stone-600 flex items-center justify-center gap-2 hover:bg-stone-200 transition-all font-bold text-sm"
                >
                  <Printer className="w-4 h-4" />
                  <span className="hidden sm:inline">تحميل PDF</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showPrintMenu ? 'rotate-180' : ''}`} />
                </button>
                {showPrintMenu && (
                  <div className="absolute top-full left-0 mt-2 bg-white rounded-2xl border border-stone-200 shadow-xl overflow-hidden z-50 w-48">
                    <button 
                      onClick={() => { printExam('questions'); setShowPrintMenu(false); }}
                      className="w-full text-right px-4 py-3 hover:bg-stone-50 transition-colors flex items-center gap-3 border-b border-stone-100 text-sm"
                    >
                      <FileText className="w-4 h-4 text-stone-400" />
                      تحميل الأسئلة فقط
                    </button>
                    <button 
                      onClick={() => { printExam('both'); setShowPrintMenu(false); }}
                      className="w-full text-right px-4 py-3 hover:bg-stone-50 transition-colors flex items-center gap-3 text-sm"
                    >
                      <BookOpen className="w-4 h-4 text-emerald-400" />
                      الأسئلة والأجوبة
                    </button>
                  </div>
                )}
              </div>
               <button 
                onClick={saveExam}
                disabled={isSaving}
                className="flex-1 md:flex-none bg-emerald-600 text-white px-6 md:px-8 py-2 rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Structured Extraction Options */}
      {!initialData && questions.length === 0 && !extractionMode && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-html2canvas-ignore>
          <button 
            onClick={() => {
              setExtractionMode('dual');
              setDualQImages([]);
              setDualAImages([]);
            }}
            className="flex flex-col items-center gap-4 p-6 bg-emerald-50 border-2 border-emerald-100 rounded-3xl hover:border-emerald-300 hover:bg-emerald-100/50 transition-all text-right group ring-1 ring-emerald-200"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <Layers className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-bold text-emerald-900 mb-1 leading-tight">الخيار الأول: (أسئلة + أجوبة) منفصلة</p>
              <p className="text-[11px] text-emerald-700 leading-relaxed">استخراج من صورتين مختلفتين، صورة لورقة الأسئلة وصورة لورقة الأجوبة النموذجية.</p>
            </div>
          </button>

          <button 
            onClick={() => {
              setExtractionMode('single');
              extractionInputRef.current?.click();
            }}
            className="flex flex-col items-center gap-4 p-6 bg-stone-50 border-2 border-stone-100 rounded-3xl hover:border-emerald-300 hover:bg-white transition-all text-right group"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <FileUp className="w-6 h-6 text-stone-600" />
            </div>
            <div>
              <p className="font-bold text-stone-900 mb-1 leading-tight">الخيار الثاني: ورقة (سؤال وجواب)</p>
              <p className="text-[11px] text-stone-500 leading-relaxed">يرفع صورة واحدة لكل سؤال وتحته الجواب، سيتم الربط تلقائياً.</p>
            </div>
          </button>

          <button 
            onClick={() => {
              setExtractionMode('single');
              extractionCameraInputRef.current?.click();
            }}
            className="flex flex-col items-center gap-4 p-6 bg-stone-50 border-2 border-stone-100 rounded-3xl hover:border-emerald-300 hover:bg-white transition-all text-right group"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <Camera className="w-6 h-6 text-stone-600" />
            </div>
            <div>
              <p className="font-bold text-stone-900 mb-1 leading-tight">الخيار الثالث: الفتح السريع (الكاميرا)</p>
              <p className="text-[11px] text-stone-500 leading-relaxed">تصوير ورقة الامتحان والأجوبة بشكل هجين وسريع ومباشر عبر كاميرا الجهاز.</p>
            </div>
          </button>

          <button 
            onClick={() => setExtractionMode('manual')}
            className="flex flex-col items-center gap-4 p-6 bg-blue-50 border-2 border-blue-100 rounded-3xl hover:border-blue-300 hover:bg-white transition-all text-right group"
          >
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
              <PlusCircle className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-blue-900 mb-1 leading-tight">الخيار الرابع: إضافة يدوية</p>
              <p className="text-[11px] text-blue-500 leading-relaxed">كتابة الأسئلة والأجوبة وتحديد الدرجات يدوياً دون الحاجة لاستخراج من الصور.</p>
            </div>
          </button>
        </div>
      )}

      {/* Hidden file inputs moved here for better management */}
      <div className="hidden">
        <input type="file" ref={extractionInputRef} onChange={handleExtractionFileChange} accept="image/*" multiple />
        <input type="file" ref={extractionCameraInputRef} onChange={handleExtractionFileChange} accept="image/*" capture="environment" />
        <input type="file" ref={dualQInputRef} onChange={(e) => {
          const files = Array.from(e.target.files || []);
          Promise.all(files.map(f => new Promise<string>(r => {
            const fr = new FileReader(); fr.onloadend = () => r(fr.result as string); fr.readAsDataURL(f);
          }))).then(res => setDualQImages(prev => [...prev, ...res]));
        }} accept="image/*" multiple />
        <input type="file" ref={dualAInputRef} onChange={(e) => {
          const files = Array.from(e.target.files || []);
          Promise.all(files.map(f => new Promise<string>(r => {
            const fr = new FileReader(); fr.onloadend = () => r(fr.result as string); fr.readAsDataURL(f);
          }))).then(res => setDualAImages(prev => [...prev, ...res]));
        }} accept="image/*" multiple />
      </div>
      {/* Extraction Image Previews and Final Processing Card */}
      {(extractionImages.length > 0 || extractionMode === 'dual') && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 space-y-4"
          data-html2canvas-ignore
        >
          {extractionMode === 'single' ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-emerald-800 font-bold flex items-center gap-2">
                  <ImageIcon className="w-5 h-5" />
                  صور جاهزة للاستخراج ({extractionImages.length})
                </h3>
                <div className="flex gap-2">
                  <button 
                    onClick={() => { setExtractionImages([]); setExtractionMode(null); }}
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
                    بدء الاستخراج الذكي (أسئلة فقط)
                  </button>
                </div>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {extractionImages.map((img, i) => (
                  <div key={i} className="relative flex-shrink-0">
                    <img src={img} alt="" className="w-24 h-24 object-cover rounded-xl border border-emerald-200" crossOrigin="anonymous" />
                    <button 
                      onClick={() => setExtractionImages(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-emerald-800 font-bold flex items-center gap-2">
                  <Layers className="w-5 h-5" />
                  استخراج الأسئلة والأجوبة معاً
                </h3>
                <button 
                  onClick={() => { setExtractionMode(null); setDualQImages([]); setDualAImages([]); }}
                  className="text-stone-500 text-sm hover:underline"
                >
                  إلغاء
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Questions Box */}
                <div className="bg-white p-4 rounded-2xl border-2 border-dashed border-stone-200 hover:border-emerald-300 transition-colors cursor-pointer" onClick={() => dualQInputRef.current?.click()}>
                  <div className="text-center space-y-2 mb-4">
                    <Plus className="w-6 h-6 mx-auto text-stone-400" />
                    <p className="font-bold text-stone-600">صور الأسئلة</p>
                    <p className="text-[10px] text-stone-400">({dualQImages.length} صور محملة)</p>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {dualQImages.map((img, i) => (
                      <img key={i} src={img} className="w-12 h-12 object-cover rounded-lg border border-stone-100" />
                    ))}
                  </div>
                </div>

                {/* Answers Box */}
                <div className="bg-white p-4 rounded-2xl border-2 border-dashed border-stone-200 hover:border-emerald-300 transition-colors cursor-pointer" onClick={() => dualAInputRef.current?.click()}>
                  <div className="text-center space-y-2 mb-4">
                    <Plus className="w-6 h-6 mx-auto text-stone-400" />
                    <p className="font-bold text-stone-600">صور الأجوبة النموذجية</p>
                    <p className="text-[10px] text-stone-400">({dualAImages.length} صور محملة)</p>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {dualAImages.map((img, i) => (
                      <img key={i} src={img} className="w-12 h-12 object-cover rounded-lg border border-stone-100" />
                    ))}
                  </div>
                </div>
              </div>

              <button 
                onClick={handleExtract}
                disabled={isExtracting || dualQImages.length === 0 || dualAImages.length === 0}
                className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isExtracting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                بدء استخراج الأسئلة والأجوبة معاً
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* Meta Section - Conditioned on Mode/Extraction Success */}
      {(extractionMode === 'manual' || (questions.length > 0 && !isExtracting)) && (
        <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6 animate-in fade-in duration-500">
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
          
          {/* Show structural fields ONLY if manual mode OR AI questions-only (no answers) */}
          {(extractionMode === 'manual' || !questions.some(q => q.answer)) && (
            <>
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
            </>
          )}
        </div>
      </div>
    )}

      {/* Official Exam Header for PDF (Questions Only) */}
        <div className="fixed left-[-9999px] top-0 w-[210mm] pdf-export-container" ref={examPrintRef}>
          <div className="px-[20mm] py-[25mm] bg-white space-y-8 text-right" dir="rtl" style={{ boxSizing: 'border-box' }}>
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
                    <h4 className="text-xl font-bold leading-relaxed">س{idx + 1}: {q.text}</h4>
                    <span className="font-bold">({q.grade} درجة)</span>
                  </div>
                  {q.questionImage && <img src={q.questionImage} className="max-h-64 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                  
                  {q.answer && (
                    <div className="text-emerald-700 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 mb-6">
                      <p className="font-bold mb-1 underline">الإجابة النموذجية:</p>
                      <p className="whitespace-pre-wrap">{q.answer}</p>
                    </div>
                  )}

                  <div className="mr-6 space-y-4">
                    {q.subQuestions?.map((sq, sqIdx) => (
                      <div key={sq.id} className="space-y-4">
                        <div className="flex justify-between">
                          <p className="font-medium leading-relaxed">
                            {q.subStyle === 'letters' ? `${String.fromCharCode(1571 + sqIdx)}- ` : `${sqIdx + 1}- `}
                            {sq.text}
                          </p>
                          <span className="text-sm">({sq.grade} درجة)</span>
                        </div>
                        {sq.questionImage && <img src={sq.questionImage} className="max-h-48 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                        
                        {sq.answer && (
                          <div className="text-sm text-stone-500 border-r-2 border-stone-100 pr-3 mr-2 mb-4">
                            <span className="font-bold">الجواب: </span>
                            <span>{sq.answer}</span>
                          </div>
                        )}
                        
                        <div className="mr-6 space-y-4">
                          {sq.subQuestions?.map((ssq, ssqIdx) => (
                            <div key={ssq.id} className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <p className="leading-relaxed">{ssqIdx + 1}- {ssq.text}</p>
                                <span>({ssq.grade} درجة)</span>
                              </div>
                              {ssq.answer && (
                                <div className="text-xs text-stone-500 border-r-2 border-stone-100 pr-3 mr-2">
                                  <span className="font-bold">الجواب: </span>
                                  <span>{ssq.answer}</span>
                                </div>
                              )}
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
          <div className="px-[20mm] py-[25mm] bg-white space-y-8 text-right" dir="rtl" style={{ boxSizing: 'border-box' }}>
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
                    <h4 className="text-xl font-bold leading-relaxed">س{idx + 1}: {q.text}</h4>
                    <span className="bg-stone-900 text-white px-4 py-1 rounded-full text-sm">{q.grade} درجة</span>
                  </div>
                  
                  {q.answer && (
                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                      <p className="text-emerald-800 font-bold mb-2">الإجابة النموذجية:</p>
                      <p className="whitespace-pre-wrap">{q.answer}</p>
                      {q.answerImage && <img src={q.answerImage} className="mt-4 max-h-64 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                    </div>
                  )}

                  <div className="mr-6 space-y-6">
                    {q.subQuestions?.map((sq, sqIdx) => (
                      <div key={sq.id} className="space-y-6 border-r-2 border-stone-100 pr-4">
                        <div className="flex justify-between font-bold">
                          <p className="leading-relaxed">{q.subStyle === 'letters' ? `${String.fromCharCode(1571 + sqIdx)}- ` : `${sqIdx + 1}- `} {sq.text}</p>
                          <span>{sq.grade} درجة</span>
                        </div>
                        {sq.answer && (
                          <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 text-sm">
                            <p className="font-bold text-stone-500 mb-1">الجواب:</p>
                            <p className="whitespace-pre-wrap">{sq.answer}</p>
                            {sq.answerImage && <img src={sq.answerImage} className="mt-2 max-h-48 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                          </div>
                        )}
                        {sq.subQuestions && sq.subQuestions.length > 0 && (
                          <div className="mr-6 space-y-4">
                            {sq.subQuestions.map((ssq, ssqIdx) => (
                              <div key={ssq.id} className="space-y-2 border-r border-stone-100 pr-4">
                                <div className="flex justify-between font-bold text-sm">
                                  <p className="leading-relaxed">{ssqIdx + 1}- {ssq.text}</p>
                                  <span>{ssq.grade} درجة</span>
                                </div>
                                {ssq.answer && (
                                  <div className="bg-white p-2 rounded border border-stone-100 text-xs">
                                    <p className="font-bold text-stone-400 mb-1">الجواب:</p>
                                    <p className="whitespace-pre-wrap">{ssq.answer}</p>
                                    {ssq.answerImage && <img src={ssq.answerImage} className="mt-1 max-h-32 object-contain rounded-lg" referrerPolicy="no-referrer" crossOrigin="anonymous" />}
                                  </div>
                                )}
                              </div>
                            ))}
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

        {(extractionMode === 'manual' || questions.length > 0) && (
          <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-stone-100 pt-6" data-html2canvas-ignore>
              <h3 className="text-xl font-bold">الأسئلة</h3>
              {(extractionMode === 'manual' || !questions.some(q => q.answer)) && (
                <button 
                  onClick={addQuestion}
                  className="text-emerald-600 flex items-center gap-1 text-sm font-bold hover:underline"
                >
                  <Plus className="w-4 h-4" /> إضافة سؤال
                </button>
              )}
            </div>
            
            <div className="space-y-4">
              {questions.map((q, index) => (
              <div key={q.id} className="p-2 sm:p-6 bg-stone-50 rounded-2xl border border-stone-200 space-y-3 relative group">
                <button 
                  onClick={() => removeQuestion(q.id)}
                  className="absolute top-2 left-2 sm:top-4 sm:left-4 p-1.5 sm:p-2 text-red-500 sm:text-stone-300 hover:text-red-500 hover:bg-red-50 bg-white sm:bg-transparent shadow-sm sm:shadow-none border border-red-100 sm:border-none rounded-xl opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all z-10"
                  title="حذف هذا السؤال بالكامل"
                >
                  <Trash2 className="w-5 h-5 md:w-4 md:h-4" />
                </button>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 md:gap-4">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 bg-white rounded-lg flex items-center justify-center font-bold text-stone-400 border border-stone-200 shrink-0">{index + 1}</span>
                    {/* Status Indicators - more polished */}
                    <div className="flex items-center gap-2">
                       {(q.questionImage || q.answerImage) && (
                         <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full border border-emerald-200 text-[10px] font-bold shadow-sm">
                           <ImageIcon className="w-3 h-3" /> مرفق صور
                         </div>
                       )}
                       {(q.subQuestions?.length || 0) > 0 && (
                         <div className="flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full border border-blue-200 text-[10px] font-bold shadow-sm">
                           <Layers className="w-3 h-3" /> نظام {q.subStyle === 'letters' ? 'فروع' : 'نقاط'}
                         </div>
                       )}
                    </div>
                  </div>
                  <div className="hidden sm:block flex-1" />
                  <div className="flex items-center justify-between sm:justify-end gap-2">
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

                {/* Quick Add Menu */}
                <div className="space-y-2 py-1" data-html2canvas-ignore>
                  {(!q.subQuestions?.length && !q.questionImage && !q.answerImage) && (
                    <p className="text-[10px] font-bold text-stone-400 mb-1">بإمكانك إضافة صورة أو فروع أو نقاط إذا كان السؤال الرئيسي يحتوي على ذلك:</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {!q.subQuestions?.length && !q.questionImage && !q.answerImage && (
                      <button 
                        onClick={() => updateQuestion(q.id, { questionImage: '' })}
                        className="text-[10px] text-stone-500 hover:text-emerald-600 flex items-center gap-1 bg-white border border-stone-100 px-3 py-1.5 rounded-lg transition-all shadow-sm"
                      >
                        <ImageIcon className="w-3 h-3 text-emerald-500" /> إضافة صور للسؤال
                      </button>
                    )}
                  {(!q.subQuestions || q.subQuestions.length === 0) && (
                    <>
                      <button 
                        onClick={() => addSubQuestion(q.id, undefined, 'letters')}
                        className="text-[10px] text-stone-500 hover:text-emerald-600 flex items-center gap-1 bg-white border border-stone-100 px-3 py-1.5 rounded-lg transition-all"
                      >
                        <Layers className="w-3 h-3" /> إضافة فروع (أ، ب، ج)
                      </button>
                      <button 
                        onClick={() => addSubQuestion(q.id, undefined, 'numbers')}
                        className="text-[10px] text-stone-500 hover:text-emerald-600 flex items-center gap-1 bg-white border border-stone-100 px-3 py-1.5 rounded-lg transition-all"
                      >
                        <Plus className="w-3 h-3" /> إضافة نقاط (1، 2، 3)
                      </button>
                    </>
                  )}
                  {(q.subQuestions?.length || 0) > 0 && (
                    <div className="flex flex-wrap items-center gap-3 w-full border-b border-stone-100 pb-3">
                      <div className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-bold flex items-center gap-2 flex-1">
                        <Layers className="w-3.5 h-3.5" />
                        نظام المكونات مفعل: بإمكانك إضافة الصور والإجابات لكل {q.subStyle === 'letters' ? 'فرع' : 'نقطة'} بالأسفل.
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => addSubQuestion(q.id, undefined, q.subStyle || 'letters')}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-all flex items-center gap-1.5 text-[10px] font-bold"
                          title={q.subStyle === 'letters' ? "إضافة فرع جديد" : "إضافة نقطة جديدة"}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          إضافة {q.subStyle === 'letters' ? 'فرع' : 'نقطة'} جديد
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

                {(!q.subQuestions || q.subQuestions.length === 0) && (q.questionImage !== undefined || q.answerImage !== undefined || q.questionImage || q.answerImage) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-300">
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
                {(q.subQuestions?.length || 0) > 0 && (
                <div className="mr-0 sm:mr-4 md:mr-8 space-y-2.5 border-r-2 border-emerald-100 pr-1.5 sm:pr-3 md:pr-4 animate-in slide-in-from-right duration-300">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-3">
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
                    <div key={sq.id} className="p-1.5 sm:p-4 bg-blue-50/30 rounded-xl border border-blue-100 space-y-2.5 relative group/sub shadow-sm transition-all hover:bg-blue-50/50">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-blue-600 shrink-0">
                            {q.subStyle === 'letters' ? `(${ARABIC_BRANCH_LETTERS[sqIndex % ARABIC_BRANCH_LETTERS.length]})` : `${sqIndex + 1}-`}
                          </span>
                          <div className="flex items-center gap-1">
                            {(sq.questionImage || sq.answerImage) && (
                              <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-md border border-emerald-200 text-[8px] font-bold shadow-sm">
                                <ImageIcon className="w-2 h-2" /> مرفق صور
                              </div>
                            )}
                            {(sq.subQuestions?.length || 0) > 0 && (
                              <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-md border border-blue-200 text-[8px] font-bold shadow-sm">
                                <Layers className="w-2 h-2" /> يضم نقاط
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-1 gap-2">
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
                            className="flex-1 bg-white px-3 py-1.5 rounded-lg border border-blue-200 text-sm outline-none focus:ring-2 focus:ring-blue-500 overflow-hidden resize-none placeholder:text-stone-400"
                          />
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
                          <button 
                            onClick={() => removeQuestion(sq.id, q.id)}
                            className="absolute -left-2 -top-2 sm:-left-10 md:-left-12 sm:top-1/2 sm:-translate-y-1/2 p-1.5 sm:p-2 text-red-500 sm:text-stone-300 hover:text-red-600 hover:bg-red-50 bg-white sm:bg-transparent shadow-sm sm:shadow-none border border-red-100 sm:border-none rounded-xl opacity-100 sm:opacity-0 group-hover/sub:opacity-100 transition-all z-10"
                            title={q.subStyle === 'letters' ? "حذف هذا الفرع" : "حذف هذه النقطة"}
                          >
                            <Trash2 className="w-4 h-4 sm:w-5 sm:h-5 md:w-4 md:h-4" />
                          </button>
                          <div className="flex flex-col gap-1">
                            {(!sq.subQuestions?.length && !sq.questionImage && q.subStyle === 'letters') && (
                              <p className="text-[9px] font-bold text-stone-400">بإمكانك إضافة صورة أو نقاط لهذا الفرع:</p>
                            )}
                            <div className="flex items-center gap-2">
                              <ImageUpload 
                                label="صورة" 
                                value={sq.questionImage} 
                                onChange={(base64) => updateQuestion(sq.id, { questionImage: base64 }, q.id)}
                                onRemove={() => updateQuestion(sq.id, { questionImage: undefined }, q.id)}
                                compact
                              />
                              {!sq.subQuestions?.length && q.subStyle === 'letters' && (
                                <button 
                                  onClick={() => addSubQuestion(q.id, sq.id, 'numbers')}
                                  className="text-[9px] text-blue-600 hover:text-blue-700 flex items-center gap-1 bg-white border border-blue-100 px-2 py-1 rounded-md transition-all shadow-sm"
                                  title="بدء إضافة نقاط داخل هذا الفرع"
                                >
                                  <Plus className="w-2.5 h-2.5" /> إضافة نقاط
                                </button>
                              )}
                            </div>
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
                            
                        </div>
                      </div>

                      {/* Level 3: Points inside a Branch */}
                      <div className="mr-0 sm:mr-4 md:mr-6 space-y-2 border-r-2 border-blue-200 pr-1 sm:pr-3">
                        {sq.subQuestions && sq.subQuestions.length > 0 && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                            <span className="text-[9px] font-bold text-blue-500">النقاط داخل هذا الفرع:</span>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] text-stone-400">المطلوب حلها:</span>
                                <input 
                                  type="number" 
                                  value={sq.requiredSubCount || ''} 
                                  onChange={(e) => updateQuestion(sq.id, { requiredSubCount: e.target.value ? Number(e.target.value) : undefined }, q.id)}
                                  placeholder={sq.subQuestions?.length.toString()}
                                  className="w-8 px-1 py-0.5 rounded border border-blue-200 text-[9px] text-center"
                                />
                              </div>
                              <button 
                                onClick={() => addSubQuestion(q.id, sq.id, 'numbers')}
                                className="text-[9px] text-emerald-600 hover:text-emerald-700 flex items-center gap-1 bg-white border border-emerald-100 px-2.5 py-1 rounded-md transition-all shadow-sm"
                              >
                                <Plus className="w-2.5 h-2.5" /> إضافة نقطة جديدة
                              </button>
                            </div>
                          </div>
                        )}
                        {sq.subQuestions?.map((ssq, ssqIndex) => (
                          <div key={ssq.id} className="relative group/point animate-in slide-in-from-right-2 duration-300">
                            <button 
                              onClick={() => removeQuestion(ssq.id, q.id, sq.id)}
                              className="absolute -left-2 -top-2 sm:-left-10 sm:top-1/2 sm:-translate-y-1/2 p-1.5 sm:p-2 text-red-500 sm:text-stone-300 hover:text-red-600 hover:bg-red-50 bg-white sm:bg-transparent shadow-md sm:shadow-none border border-red-100 sm:border-none rounded-lg opacity-100 sm:opacity-0 group-hover/point:opacity-100 transition-all z-10"
                              title="حذف هذه النقطة"
                            >
                              <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-3.5 md:h-3.5" />
                            </button>
                            <div className="flex flex-col gap-1.5 bg-emerald-50/20 p-1.5 sm:p-3 rounded-lg border border-emerald-100 shadow-sm transition-all hover:bg-emerald-50/40">
                              <div className="flex items-start gap-2">
                                <span className="text-[10px] font-bold text-emerald-600 mt-1 shrink-0">{ssqIndex + 1}-</span>
                                <div className="flex-1 space-y-2">
                                  <div className="flex items-center gap-1.5">
                                    <textarea 
                                      value={ssq.text} 
                                      onChange={(e) => {
                                        updateQuestion(ssq.id, { text: e.target.value }, q.id, sq.id);
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                      }}
                                      onFocus={(e) => {
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                      }}
                                      placeholder="نص النقطة..."
                                      rows={1}
                                      className="flex-1 bg-white px-2 sm:px-3 py-1.5 rounded border border-emerald-200 text-[11px] outline-none resize-none overflow-hidden placeholder:text-stone-300 shadow-sm"
                                    />
                                    <div className="flex items-center gap-1 shrink-0">
                                      <ImageUpload 
                                        label="سؤال" 
                                        value={ssq.questionImage} 
                                        onChange={(base64) => updateQuestion(ssq.id, { questionImage: base64 }, q.id, sq.id)}
                                        onRemove={() => updateQuestion(ssq.id, { questionImage: undefined }, q.id, sq.id)}
                                        compact
                                      />
                                      <input 
                                        type="number" 
                                        value={ssq.grade || ''} 
                                        onChange={(e) => updateQuestion(ssq.id, { grade: Number(e.target.value) }, q.id, sq.id)}
                                        placeholder="درجة"
                                        className="w-10 px-1 py-0.5 rounded border border-emerald-200 text-[10px] text-center bg-white"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <div className="p-1 bg-emerald-100 rounded-md">
                                      <CheckSquare className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-emerald-700" />
                                    </div>
                                    <textarea 
                                      value={ssq.answer} 
                                      onChange={(e) => {
                                        updateQuestion(ssq.id, { answer: e.target.value }, q.id, sq.id);
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                      }}
                                      onFocus={(e) => {
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                      }}
                                      placeholder="الجواب النموذجي للنقطة..."
                                      rows={1}
                                      className="flex-1 bg-white/80 px-2 sm:px-3 py-1.5 rounded border border-emerald-100 text-[10px] outline-none min-h-[32px] resize-none overflow-hidden shadow-sm"
                                    />
                                    <ImageUpload 
                                      label="جواب" 
                                      value={ssq.answerImage} 
                                      onChange={(base64) => updateQuestion(ssq.id, { answerImage: base64 }, q.id, sq.id)}
                                      onRemove={() => updateQuestion(ssq.id, { answerImage: undefined }, q.id, sq.id)}
                                      compact
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {(!sq.subQuestions || sq.subQuestions.length === 0) && (
                        <div className="space-y-2 animate-in fade-in duration-300">
                          <div className="flex items-center gap-1.5 px-0.5">
                            <CheckSquare className="w-3 h-3 text-emerald-600" />
                            <span className="text-[9px] font-bold text-stone-500 text-right">إجابة الفرع النموذجية:</span>
                          </div>
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
                            placeholder="أدخل الإجابة النموذجية لهذا الفرع..."
                            rows={1}
                            className="w-full bg-emerald-50/30 px-3 py-2 rounded-lg border border-emerald-100 text-xs outline-none focus:ring-2 focus:ring-emerald-500 overflow-hidden resize-none min-h-[40px]"
                          />
                          <div className="grid grid-cols-2 gap-4 mt-2">
                            <ImageUpload 
                              label="صورة الجواب للفرع" 
                              value={sq.answerImage} 
                              onChange={(base64) => updateQuestion(sq.id, { answerImage: base64 }, q.id)}
                              onRemove={() => updateQuestion(sq.id, { answerImage: undefined }, q.id)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                )}

                {(!q.subQuestions || q.subQuestions.length === 0) && (
                  <div className="space-y-2 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center gap-2 px-1">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-xs font-bold text-stone-500">الإجابة النموذجية للسؤال:</span>
                    </div>
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
                      placeholder="اكتب الإجابة التي سيتم التصحيح بناءً عليها..."
                      rows={1}
                      className="w-full bg-emerald-50/50 px-4 py-3 rounded-xl border border-emerald-100 outline-none focus:ring-2 focus:ring-emerald-500 placeholder:text-stone-400 text-stone-700 min-h-[80px] text-sm"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function VisualPaperOverlay({ imageUrl, gradings, studentName, totalGrade, maxGrade, isFirstPage }: any) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setDimensions({ width: naturalWidth, height: naturalHeight });
  };

  return (
    <div ref={containerRef} className="relative w-full rounded-2xl overflow-hidden shadow-sm border border-stone-200 bg-stone-100">
      <img 
        src={imageUrl} 
        alt="" 
        className="w-full h-auto block" 
        onLoad={handleImageLoad}
        crossOrigin="anonymous"
      />
      {dimensions.width > 0 && (
        <svg 
          viewBox="0 0 1000 1000" 
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          {/* Marks for each grading */}
          {gradings.map((g: any, i: number) => {
            if (!g.box) return null;
            const [ymin, xmin, ymax, xmax] = g.box;
            const isCorrect = g.grade > 0;
            const isFull = g.grade >= (g.maxGrade || 0);

            return (
              <g key={i}>
                {/* The Mark (Check or Cross) */}
                <text 
                  x={xmax > 900 ? xmin - 10 : xmax + 10} 
                  y={(ymin + ymax) / 2} 
                  fontSize="48" 
                  fill={isCorrect ? "#059669" : "#dc2626"}
                  className="font-bold select-none drop-shadow-sm"
                  textAnchor={xmax > 900 ? "end" : "start"}
                  dominantBaseline="middle"
                >
                  {isCorrect ? "✓" : "×"}
                </text>
                {/* The Grade for the question */}
                <rect 
                  x={xmax > 900 ? xmin - 50 : xmax + 50} 
                  y={ymin} 
                  width="45" 
                  height="35" 
                  rx="6"
                  fill="white"
                  fillOpacity="0.9"
                  stroke={isCorrect ? "#059669" : "#dc2626"}
                  strokeWidth="2"
                />
                <text 
                  x={xmax > 900 ? xmin - 27 : xmax + 72} 
                  y={ymin + 22} 
                  fontSize="20" 
                  fill={isCorrect ? "#059669" : "#dc2626"}
                  className="font-bold select-none"
                  textAnchor="middle"
                >
                  {g.grade}
                </text>
              </g>
            );
          })}

          {/* Student Final Grade Overlay (Top Right) */}
          {isFirstPage && (
            <g transform="translate(800, 50)">
              <circle cx="50" cy="50" r="45" fill="white" fillOpacity="0.9" stroke="#059669" strokeWidth="4" />
              <text x="50" y="45" fontSize="24" fill="#059669" fontWeight="bold" textAnchor="middle">الدرجة</text>
              <line x1="20" y1="52" x2="80" y2="52" stroke="#059669" strokeWidth="2" />
              <text x="50" y="78" fontSize="22" fill="#059669" fontWeight="bold" textAnchor="middle">{totalGrade} / {maxGrade}</text>
              
              <text x="-150" y="40" fontSize="24" fill="#374151" fontWeight="bold" textAnchor="end" className="italic">{studentName}</text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

function Grader({ user, userProfile, exam, sessions, onComplete, onCancel }: any) {
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [gradingMode, setGradingMode] = useState<'digital' | 'paper'>('digital');
  const [isGrading, setIsGrading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' });
  const [gradingResults, setGradingResults] = useState<any[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [targetSessionId, setTargetSessionId] = useState<string>('new');
  const [newSessionName, setNewSessionName] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const examSessions = sessions.filter((s: any) => s.examId === exam.id);

  useEffect(() => {
    if (examSessions.length === 0) {
      setTargetSessionId('new');
      const date = new Date().toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
      setNewSessionName(`تصحيح - ${date}`);
    }
  }, [examSessions.length]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      if (images.length + newFiles.length > 24) {
        alert('عذراً، لا يمكن رفع أكثر من 24 صفحة في المرة الواحدة.');
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
            pagesUsed: (userProfile.pagesUsed || 0) + images.length,
            gradingsCount: (userProfile.gradingsCount || 0) + results.length
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
    if (targetSessionId === 'new' && !newSessionName.trim()) {
      alert('يرجى إدخال اسم للمجلد الجديد');
      return;
    }

    setIsSaving(true);
    try {
      // 1. Get or Create a session document
      let sessionId = targetSessionId;
      
      if (targetSessionId === 'new') {
        const sessionRef = await addDoc(collection(db, 'sessions'), {
          examId: exam.id,
          examTitle: exam.title,
          sessionName: newSessionName || exam.title,
          authorUid: user.uid,
          studentCount: gradingResults.length,
          createdAt: serverTimestamp()
        });
        sessionId = sessionRef.id;
      } else {
        await updateDoc(doc(db, 'sessions', targetSessionId), {
          studentCount: increment(gradingResults.length)
        });
      }

      // 2. Save each result with the sessionId
      for (const result of gradingResults) {
        try {
          await addDoc(collection(db, 'results'), {
            studentName: result.studentName,
            gradings: result.gradings,
            totalGrade: result.totalGrade,
            sessionId: sessionId,
            examId: exam.id,
            examTitle: exam.title,
            authorUid: user.uid,
            createdAt: serverTimestamp()
          });
        } catch (e) {
          handleFirestoreError(e, OperationType.CREATE, 'results');
        }
      }
      setShowSaveModal(false);
      onComplete();
    } catch (e) {
      console.error(e);
      alert('حدث خطأ أثناء حفظ النتائج');
    } finally {
      setIsSaving(false);
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
                <img src={url} alt="" className="w-full h-full object-cover" crossOrigin="anonymous" />
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

          <div className="flex flex-col items-center gap-2">
            <p className="text-[10px] text-emerald-600 font-bold flex items-center gap-1 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
              <HelpCircle className="w-3 h-3" />
              بإمكانك رفع حتى 24 صفحة في المرة الواحدة لضمان سرعة المعالجة
            </p>
            <div className="flex flex-col items-center gap-4 w-full">
              <div className="flex bg-stone-100 p-1.5 rounded-2xl gap-2 w-full max-w-sm">
              <button 
                onClick={() => setGradingMode('digital')}
                className={cn(
                  "flex-1 flex flex-col items-center py-3 rounded-xl transition-all gap-1",
                  gradingMode === 'digital' 
                    ? "bg-white text-emerald-700 shadow-sm" 
                    : "text-stone-400 hover:text-stone-600"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <FileText className="w-4 h-4" />
                  <span className="font-bold text-sm">تقرير رقمي</span>
                </div>
                <span className="text-[10px] opacity-70">عرض النتائج كتقرير وجدول</span>
              </button>
              <button 
                onClick={() => setGradingMode('paper')}
                className={cn(
                  "flex-1 flex flex-col items-center py-3 rounded-xl transition-all gap-1",
                  gradingMode === 'paper' 
                    ? "bg-white text-emerald-700 shadow-sm" 
                    : "text-stone-400 hover:text-stone-600"
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  <span className="font-bold text-sm">تصحيح ورقي</span>
                </div>
                <span className="text-[10px] opacity-70">وضع العلامات على صورة الورقة</span>
              </button>
            </div>

            <div className="flex justify-center gap-4 w-full">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 px-4 sm:px-8 py-3 rounded-2xl border border-stone-200 font-medium hover:bg-stone-50 transition-colors flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">اختيار الصور</span>
                <span className="sm:hidden text-xs">ارفع صور</span>
              </button>
              <button 
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 px-4 sm:px-8 py-3 rounded-2xl border border-stone-200 font-medium hover:bg-stone-50 transition-colors flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" />
                <span className="hidden sm:inline">فتح الكاميرا</span>
                <span className="sm:hidden text-xs">الكاميرا</span>
              </button>
              <button 
                onClick={startGrading}
                disabled={images.length === 0 || isGrading}
                className="flex-[2] px-6 sm:px-8 py-3 rounded-2xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isGrading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                {isGrading && progress.total > 0 
                  ? `${progress.phase === 'compressing' ? 'جاري ضغط الصور' : 'جاري التصحيح'} (${progress.current}/${progress.total})...` 
                  : (gradingMode === 'paper' ? 'بدء التصحيح الورقي' : 'بدء التصحيح الذكي')}
              </button>
            </div>
          </div>
        </div>
      </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
          id="current-grading-result"
        >
          <div className="bg-white p-4 sm:p-8 rounded-3xl border border-stone-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-stone-100 pb-6">
              <div>
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
                  {gradingMode === 'digital' ? 'تم التصحيح بنجاح' : 'تصحيح ورقي مباشر'}
                </span>
                <h3 className="text-xl sm:text-2xl font-bold mt-1">الطالب: {currentGrading.studentName}</h3>
              </div>
              <div className="text-right">
                <span className="text-stone-400 text-sm">المجموع الكلي</span>
                <div className="text-2xl sm:text-4xl font-bold text-emerald-600">{currentGrading.totalGrade} <span className="text-lg text-stone-300">/ {exam.totalGrade}</span></div>
              </div>
            </div>

            {gradingMode === 'digital' ? (
              <div className="space-y-4">
                {exam.questions.map((q: any) => (
                  <GradingResultItem 
                    key={q.id} 
                    question={q} 
                    gradings={currentGrading.gradings} 
                    onGradeChange={(qId: string, newGrade: number) => {
                      const newGradings = currentGrading.gradings.map((g: any) => 
                        g.questionId === qId ? { ...g, grade: newGrade } : g
                      );
                      const newTotal = newGradings.reduce((acc: any, curr: any) => acc + curr.grade, 0);
                      const newResults = [...gradingResults];
                      newResults[currentResultIndex] = { ...currentGrading, gradings: newGradings, totalGrade: newTotal };
                      setGradingResults(newResults);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-8">
                {Array.from(new Set(currentGrading.gradings.map((g: any) => g.pageIndex)))
                  .filter((idx): idx is number => idx !== undefined && idx !== null)
                  .sort((a, b) => a - b)
                  .map((pageIdx, i) => (
                    <div key={pageIdx} className="space-y-2">
                      <div className="flex items-center justify-between text-stone-400 text-xs px-2">
                        <span>الصفحة {i + 1}</span>
                        <span>رقم الصورة في المتصفح: {pageIdx + 1}</span>
                      </div>
                      <VisualPaperOverlay 
                        imageUrl={previews[pageIdx]}
                        gradings={currentGrading.gradings.filter((g: any) => g.pageIndex === pageIdx)}
                        studentName={currentGrading.studentName}
                        totalGrade={currentGrading.totalGrade}
                        maxGrade={exam.totalGrade}
                        isFirstPage={i === 0}
                      />
                    </div>
                  ))
                }
                {currentGrading.gradings.every((g: any) => g.pageIndex === undefined) && (
                  <div className="text-center p-12 bg-stone-50 rounded-2xl border-2 border-dashed border-stone-200 text-stone-400">
                    لم يتم تحديد مواقع الإجابات على الورقة لهذا الطالب. يرجى استخدام التقرير الرقمي.
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col md:flex-row justify-between items-center gap-6 pt-6 border-t border-stone-100">
              <div className="flex flex-wrap items-center justify-center gap-3 w-full md:w-auto">
                <div className="flex gap-2">
                  <button 
                    disabled={currentResultIndex === 0}
                    onClick={() => setCurrentResultIndex(currentResultIndex - 1)}
                    className="px-4 py-2 rounded-xl border border-stone-200 disabled:opacity-30 hover:bg-stone-50 transition-colors"
                  >
                    السابق
                  </button>
                  <button 
                    disabled={currentResultIndex === gradingResults.length - 1}
                    onClick={() => setCurrentResultIndex(currentResultIndex + 1)}
                    className="px-4 py-2 rounded-xl border border-stone-200 disabled:opacity-30 hover:bg-stone-50 transition-colors"
                  >
                    التالي
                  </button>
                </div>
                <span className="text-stone-400 text-sm font-medium bg-stone-50 px-3 py-1.5 rounded-lg">
                  طالب {currentResultIndex + 1} من {gradingResults.length}
                </span>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto mt-4 md:mt-0 pb-4 md:pb-0">
                <button 
                  onClick={async () => {
                    const element = document.getElementById(`current-grading-result`);
                    if (element) {
                      const isPaper = gradingMode === 'paper';
                      await generatePDFFromElement(
                        element, 
                        `${currentGrading.studentName}_${isPaper ? 'تصحيح_ورقي' : 'نتيجة'}.pdf`, 
                        { padding: isPaper ? '5mm' : '20mm', ignoreImages: !isPaper }
                      );
                    }
                  }}
                  className="flex-1 sm:flex-none px-4 py-3 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 flex items-center justify-center gap-2 transition-all font-bold"
                >
                  <Download className="w-4 h-4" />
                  {gradingMode === 'paper' ? 'تحميل الأوراق المصححة (PDF)' : 'تحميل النتيجة (PDF)'}
                </button>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setGradingResults([])} 
                    className="flex-1 px-4 py-3 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors text-sm font-medium border border-transparent"
                  >
                    إلغاء
                  </button>
                  {gradingMode === 'paper' && (
                    <button 
                      onClick={async () => {
                        setIsSaving(true);
                        try {
                          alert('سيبدأ الآن تحميل أوراق جميع الطلاب... قد يستغرق هذا وقتاً طويلاً. يرجى الانتظار.');
                          for (let i = 0; i < gradingResults.length; i++) {
                            setCurrentResultIndex(i);
                            // Wait for render
                            await new Promise(r => setTimeout(r, 1500));
                            const element = document.getElementById(`current-grading-result`);
                            if (element) {
                              await generatePDFFromElement(
                                element, 
                                `طالب_${i+1}_${gradingResults[i].studentName}_تصحيح_ورقي.pdf`, 
                                { padding: '5mm', ignoreImages: false }
                              );
                            }
                          }
                        } finally {
                          setIsSaving(false);
                        }
                      }} 
                      className="flex-1 px-4 py-3 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold hover:bg-emerald-100 active:scale-95 transition-all text-center flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      تحميل الكل
                    </button>
                  )}
                  <button 
                    onClick={() => setShowSaveModal(true)} 
                    className="flex-[2] px-8 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 active:scale-95 transition-all text-center"
                  >
                    {gradingMode === 'paper' ? 'حفظ في المجلد' : 'حفظ جميع النتائج'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Save Modal */}
          <AnimatePresence>
            {showSaveModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => !isSaving && setShowSaveModal(false)}
                  className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
                >
                  <div className="p-8 space-y-6">
                    <div className="flex items-center gap-3 text-emerald-600">
                      <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center">
                        <Folder className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-stone-900">حفظ النتائج</h3>
                        <p className="text-stone-400 text-sm">اختر كيف تريد تنظيم هذه النتائج</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {examSessions.length > 0 && (
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-stone-700 block mr-1">إضافة إلى مجلد موجود:</label>
                          <select 
                            value={targetSessionId}
                            onChange={(e) => setTargetSessionId(e.target.value)}
                            className="w-full p-4 rounded-2xl border border-stone-200 bg-stone-50 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                          >
                            <option value="new">+ إنشاء مجلد جديد</option>
                            {examSessions.map((s: any) => (
                              <option key={s.id} value={s.id}>{s.sessionName || s.examTitle} ({s.studentCount} طلاب)</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {targetSessionId === 'new' && (
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-stone-700 block mr-1">اسم المجلد الجديد:</label>
                          <input 
                            type="text"
                            value={newSessionName}
                            onChange={(e) => setNewSessionName(e.target.value)}
                            placeholder="مثلاً: تصحيح الشهر الأول"
                            className="w-full p-4 rounded-2xl border border-stone-200 bg-stone-50 outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
                            autoFocus
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button 
                        disabled={isSaving}
                        onClick={() => setShowSaveModal(false)}
                        className="flex-1 py-4 rounded-2xl font-bold text-stone-400 hover:bg-stone-50 transition-colors"
                      >
                        إلغاء
                      </button>
                      <button 
                        disabled={isSaving}
                        onClick={saveAllResults}
                        className="flex-[2] bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        تأكيد الحفظ
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Hidden container for PDF capture of current result */}
          <div className="fixed top-[-9999px] left-0 w-[210mm] pdf-export-container">
            <div id="current-grading-result" className="bg-white p-10 space-y-8">
              <div className="flex items-center justify-between border-b border-stone-100 pb-6">
                <div>
                  <h3 className="text-3xl font-bold">الطالب: {currentGrading.studentName}</h3>
                  <p className="text-stone-500 mt-2 text-lg">الامتحان: {exam.title}</p>
                </div>
                <div className="text-right">
                  <span className="text-stone-400 text-sm">الدرجة النهائية</span>
                  <div className="text-5xl font-bold text-emerald-600">
                    {currentGrading.totalGrade}
                    <span className="text-xl text-stone-300"> / {exam.totalGrade}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                {exam.questions.map((q: any) => (
                  <GradingResultItem 
                    key={q.id} 
                    question={q} 
                    gradings={currentGrading.gradings} 
                  />
                ))}
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

  const [isExporting, setIsExporting] = useState(false);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const resultPrintRef = useRef<HTMLDivElement>(null);
  const allResultsPrintRef = useRef<HTMLDivElement>(null);

  const exportPDF = async (result: any) => {
    console.log(`[ResultsView] Exporting PDF for student: ${result.studentName}`);
    setIsExporting(true);
    try {
      // 1. Priority: Use the visible ref if it's the same student
      if (selectedResult?.id === result.id && resultPrintRef.current) {
        console.log(`[ResultsView] Using visible resultPrintRef`);
        await generatePDFFromElement(resultPrintRef.current, `${result.studentName}_نتيجة.pdf`, { padding: '20mm', ignoreImages: true });
        return;
      }

      // 2. Fallback: Use the hidden list element
      const element = document.getElementById(`print-result-list-${result.id}`);
      if (element) {
        console.log(`[ResultsView] Using hidden list element`);
        await generatePDFFromElement(element, `${result.studentName}_نتيجة.pdf`, { padding: '20mm', ignoreImages: true });
      } else {
        console.warn(`[ResultsView] Element not found for result: ${result.id}`);
        alert('يرجى فتح تفاصيل الطالب أولاً لتحميل الملف');
      }
    } catch (error) {
      console.error(`[ResultsView] Error in exportPDF:`, error);
    } finally {
      setIsExporting(false);
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

  const deleteSession = async (e: React.MouseEvent, session: any) => {
    e.stopPropagation();
    if (!confirm(`هل أنت متأكد من حذف المجلد "${session.sessionName || session.examTitle}"؟ سيتم حذف جميع نتائج الطلاب المرتبطة به.`)) return;

    try {
      // 1. Delete all results associated with this session
      const resultsQuery = query(collection(db, 'results'), where('sessionId', '==', session.id));
      const resultsSnapshot = await getDocs(resultsQuery);
      
      const batch = writeBatch(db);
      resultsSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      // 2. Delete the session itself
      batch.delete(doc(db, 'sessions', session.id));
      
      await batch.commit();
      alert('تم حذف المجلد وجميع نتائجه بنجاح.');
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('حدث خطأ أثناء حذف المجلد.');
    }
  };

  if (selectedResult) {
    const exam = exams.find((e: any) => e.id === selectedResult.examId);
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-8"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2 md:px-0" data-html2canvas-ignore>
          <button onClick={() => setSelectedResult(null)} className="flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors w-fit font-bold">
            <ArrowRight className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
            العودة لقائمة الطلاب
          </button>
          <button 
            onClick={() => exportPDF(selectedResult)}
            disabled={isExporting}
            className="w-full sm:w-auto bg-emerald-600 text-white px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-sm"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            تحميل تقرير النتيجة (PDF)
          </button>
        </div>

        <div ref={resultPrintRef} id={`print-result-${selectedResult.id}`} className="bg-white p-4 md:p-8 border shadow-sm rounded-3xl space-y-8 pdf-export-container">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-stone-100 pb-6 gap-6">
            <div className="text-right">
              <h3 className="text-xl md:text-2xl font-bold text-stone-900 break-words">{selectedResult.studentName || 'اسم غير معروف'}</h3>
              <p className="text-stone-500 mt-1 text-sm md:text-base">{selectedResult.examTitle || 'امتحان غير محدد'}</p>
              {selectedResult.createdAt && (
                <p className="text-stone-400 text-[10px] md:text-sm mt-1">التاريخ: {selectedResult.createdAt.toDate().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              )}
            </div>
            <div className="text-right md:text-left flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center bg-stone-50 md:bg-transparent p-4 md:p-0 rounded-2xl border border-stone-100 md:border-0">
              <span className="text-stone-400 text-xs font-bold md:text-sm">الدرجة النهائية</span>
              <div className="text-3xl md:text-5xl font-bold text-emerald-600">
                {selectedResult.totalGrade}
                <span className="text-lg md:text-xl text-stone-300"> / {exam?.totalGrade || '?'}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {exam?.questions.map((q: any) => (
              <GradingResultItem 
                key={q.id} 
                question={q} 
                gradings={selectedResult.gradings} 
              />
            ))}
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-2">
          <button onClick={() => setSelectedSession(null)} className="flex items-center gap-2 text-stone-500 hover:text-stone-900 transition-colors w-fit font-bold text-sm">
            <ArrowRight className="w-5 h-5" />
            العودة للقائمة الرئيسية
          </button>
          <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-2xl border border-stone-100 shadow-sm">
            <div className="text-right sm:ml-6 ml-0 mb-4 sm:mb-0">
              <h3 className="text-lg font-bold text-stone-900">{selectedSession.sessionName || selectedSession.examTitle}</h3>
              <p className="text-stone-400 text-xs">{selectedSession.createdAt?.toDate().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            <button 
              onClick={exportAllPDF}
              disabled={isExportingAll}
              className="w-full sm:w-auto bg-emerald-600 text-white px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-600/20 font-bold"
            >
              {isExportingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              تحميل كل النتائج (PDF)
            </button>
          </div>
        </div>

        {/* Hidden area for printing all results */}
        <div className="fixed top-[-9999px] left-0 w-[210mm] pdf-export-container" ref={allResultsPrintRef}>
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
                {exams.find((e: any) => e.id === res.examId)?.questions.map((q: any) => (
                  <GradingResultItem 
                    key={q.id} 
                    question={q} 
                    gradings={res.gradings} 
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Hidden area for individual printing from list */}
        <div className="fixed top-[-9999px] left-0 w-[210mm] pdf-export-container">
          {sessionResults.map((res: any) => (
            <div key={res.id} id={`print-result-list-${res.id}`} className="bg-white p-10">
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
                {exams.find((e: any) => e.id === res.examId)?.questions.map((q: any) => (
                  <GradingResultItem 
                    key={q.id} 
                    question={q} 
                    gradings={res.gradings} 
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="md:hidden divide-y divide-stone-100">
            {sessionResults.length > 0 ? sessionResults.map((res: any) => (
              <div 
                key={res.id} 
                className="p-5 active:bg-stone-50 transition-colors space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="font-bold text-stone-900 break-all max-w-[200px]">{res.studentName || 'بدون اسم'}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">الدرجة النهائية:</span>
                      <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                        {res.totalGrade ?? 0}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => exportPDF(res)}
                    className="p-3 bg-stone-50 text-stone-400 rounded-xl hover:text-emerald-600 transition-colors"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </div>
                <button 
                  onClick={() => setSelectedResult(res)}
                  className="w-full py-3.5 rounded-xl bg-stone-900 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md shadow-stone-900/10"
                >
                  عرض تفاصيل النتيجة
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
              </div>
            )) : (
              <div className="p-16 text-center space-y-4">
                <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
                  <FileText className="w-8 h-8 text-stone-300" />
                </div>
                <div>
                  <p className="text-stone-900 font-bold">لا توجد نتائج</p>
                  <p className="text-stone-400 text-sm">لم يتم العثور على نتائج مسجلة لهذه المجموعة.</p>
                </div>
              </div>
            )}
          </div>

          <table className="hidden md:table w-full text-right">
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
                  <td className="px-6 py-5 font-bold text-stone-900">{res.studentName}</td>
                  <td className="px-6 py-5">
                    <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl font-black text-sm border border-emerald-100/50">
                      {res.totalGrade}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-left">
                    <div className="flex items-center justify-end gap-3">
                      <button 
                        onClick={() => setSelectedResult(res)}
                        className="px-5 py-2 rounded-xl bg-stone-900 text-white text-xs font-bold hover:bg-emerald-600 transition-all shadow-sm active:scale-95"
                      >
                        عرض التفاصيل
                      </button>
                      <button 
                        onClick={() => exportPDF(res)}
                        className="p-2.5 bg-stone-50 text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                        title="تحميل النتيجة PDF"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sessionResults.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-10 text-center text-stone-400 italic">لا توجد نتائج في هذه المجموعة</td>
                </tr>
              )}
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold font-serif italic">نتائج الطلاب</h2>
          <p className="text-sm md:text-base text-stone-500">مجموعات التصحيح المنظمة حسب التاريخ</p>
        </div>
        <button onClick={onBack} className="text-stone-400 hover:text-stone-900 transition-colors w-fit">العودة</button>
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
              <div className="flex flex-col items-end gap-2">
                <div className="text-[10px] font-bold text-stone-400 bg-stone-50 px-2 py-1 rounded-lg">
                  {session.createdAt?.toDate().toLocaleDateString('ar-EG', { month: 'short', year: 'numeric' })}
                </div>
                <button 
                  onClick={(e) => deleteSession(e, session)}
                  className="p-2 text-stone-300 hover:text-red-500 transition-colors"
                  title="حذف المجلد"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <h3 className="text-lg font-bold mb-2 group-hover:text-emerald-600 transition-colors">{session.sessionName || session.examTitle}</h3>
            <div className="flex items-center gap-4 text-xs text-stone-500">
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" /> 
                {session.studentCount === 1 ? 'طالب واحد' : 
                 session.studentCount === 2 ? 'طالبان' : 
                 session.studentCount <= 10 ? `${session.studentCount} طلاب` :
                 `${session.studentCount} طالب`}
              </span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {session.createdAt?.toDate().toLocaleDateString('ar-EG')}</span>
            </div>
            <div className="mt-6 pt-4 border-t border-stone-50 flex items-center justify-between text-xs font-bold text-emerald-600 transition-all group-hover:bg-emerald-50/50 rounded-xl px-2">
              <span className="flex items-center gap-2">عرض تفاصيل المجموعة</span>
              <ArrowRight className="w-4 h-4 rotate-180 transition-transform group-hover:translate-x-1" />
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

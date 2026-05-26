import { GoogleGenAI, Type } from "@google/genai";

// ─────────────────────────────────────────────────────────────────────────────
// Friendly error messages
// ─────────────────────────────────────────────────────────────────────────────
const friendlyError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  const safe = raw
    .replace(/AIza[A-Za-z0-9_\-]{30,}/g, 'AIza***')
    .replace(/api[_-]?key[:\s'"]+[A-Za-z0-9_\-]{10,}/gi, 'api_key:***')
    .replace(/sk-[A-Za-z0-9_\-]{20,}/g, 'sk-***');
  let code: number | null = null;
  try {
    const m = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (m) code = JSON.parse(m[0])?.error?.code ?? null;
  } catch { }
  if (raw.includes('suspended') || raw.includes('Permission denied'))
    return '🚫 مفتاح API موقوف. افتح الإعدادات (⚙️) وأدخل مفتاحاً جديداً.';
  if (code === 503 || raw.includes('high demand') || raw.includes('UNAVAILABLE'))
    return '🔄 الخادم مشغول حالياً. انتظر دقيقة أو دقيقتين ثم أعد المحاولة.';
  if (code === 429 || raw.includes('quota') || raw.includes('rate limit') || raw.includes('RESOURCE_EXHAUSTED'))
    return '⏳ تم تجاوز حد الاستخدام. انتظر بضع دقائق ثم أعد المحاولة.';
  if (code === 401 || raw.includes('UNAUTHENTICATED') || raw.includes('Unauthorized'))
    return '🔑 مفتاح API غير صحيح. افتح الإعدادات (⚙️) وتأكد من المفتاح.';
  if (code === 403 || raw.includes('Forbidden'))
    return '⛔ المفتاح لا يملك صلاحية استخدام هذا النموذج.';
  if (code === 400 || raw.includes('INVALID_ARGUMENT'))
    return '⚠️ خطأ في البيانات. تأكد من وضوح الصور وأعد المحاولة.';
  if (code === 500 || raw.includes('INTERNAL'))
    return '🛠️ خطأ داخلي في خادم Gemini. أعد المحاولة بعد لحظات.';
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError'))
    return '🌐 انقطع الاتصال بالإنترنت. تحقق من اتصالك وأعد المحاولة.';
  if (raw.includes('JSON') || raw.includes('SyntaxError'))
    return '📄 فشل في قراءة النتيجة. أعد المحاولة أو قلّل عدد الصور.';
  if (raw.includes('timeout') || raw.includes('AbortError'))
    return '⌛ انتهت مهلة الطلب. قلّل عدد الصور وأعد المحاولة.';
  console.error('[geminiService] Unhandled error:', safe);
  return '❌ حدث خطأ غير متوقع. أعد المحاولة أو تحقق من إعدادات مفتاح API.';
};

export interface Question {
  id: string;
  text: string;
  answer: string;
  grade: number;
  type: 'text' | 'true-false' | 'multiple-choice' | 'fill-in-the-blanks';
  options?: string[];
  subQuestions?: Question[];
  requiredSubCount?: number;
  subStyle?: 'numbers' | 'letters';
  questionImage?: string;
  answerImage?: string;
}

export interface GradingResult {
  questionId: string;
  studentAnswer: string;
  grade: number;
  feedback: string;
  box?: [number, number, number, number];
  pageIndex?: number;
}

const getApiKey = () => {
  const viteKey = import.meta.env?.VITE_GEMINI_API_KEY;
  if (viteKey && viteKey !== 'undefined' && viteKey !== '') return viteKey.trim();
  try {
    const envKey = process.env?.GEMINI_API_KEY || (process.env as any)?.VITE_GEMINI_API_KEY;
    if (envKey && envKey !== 'undefined' && envKey !== '') return envKey.trim();
  } catch (e) { }
  return (localStorage.getItem('GEMINI_API_KEY_FALLBACK') || '').trim();
};

const getApiKeyErrorMessage = () => {
  const isCloudflare = window.location.hostname.includes('.pages.dev');
  if (isCloudflare) return 'مفتاح API غير مضبوط. تأكد من إضافة VITE_GEMINI_API_KEY في Cloudflare Pages → Settings → Environment Variables ثم أعد النشر.';
  return 'مفتاح API غير مضبوط. يرجى الضغط على أيقونة الترس (⚙️) وإدخال مفتاح Gemini API.';
};

const cleanJson = (text: string) => {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

async function compressImage(url: string, maxWidth = 800, maxHeight = 800, quality = 0.5): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width, height = img.height;
      if (width > height) { if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; } }
      else { if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; } }
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not get canvas context'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = () => reject(new Error('فشل في تحميل الصورة'));
  });
}

function fixInlineSubQuestions(q: any, parentId?: string, level: number = 1): any {
  const id = q.id || `${parentId || 'q'}_${Math.random().toString(36).substr(2, 4)}`;
  if (q.subQuestions && q.subQuestions.length > 0) {
    return { ...q, id, subQuestions: q.subQuestions.map((sq: any, i: number) => fixInlineSubQuestions(sq, `${id}_${i}`, level + 1)) };
  }
  return { ...q, id };
}

export async function extractExamFromDualImages(
  questionImages: string[], answerImages: string[]
): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    const qImagesData = await Promise.all(questionImages.map(b64 => compressImage(b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`, 1500, 1500, 0.7)));
    const aImagesData = await Promise.all(answerImages.map(b64 => compressImage(b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`, 1500, 1500, 0.7)));

    const prompt = `Analyze these Iraqi exam questions and their model answers. Match them.
    Output a JSON object with:
    - title: String (exam subject)
    - requiredQuestionsCount: Number (if specified)
    - questions: Array of objects with {text, grade, answer, type, options, subQuestions: []}
    CRITICAL: Preserve Arabic digits (٠-٩). Nest sub-questions. Copy grades exactly. Clean redundant identifiers from text.`;

    const parts: any[] = [{ text: "QUESTIONS IMAGES:" }];
    qImagesData.forEach(data => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: "MODEL ANSWERS IMAGES:" });
    aImagesData.forEach(data => parts.push({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", contents: { parts },
      config: { responseMimeType: "application/json", temperature: 0.1, systemInstruction: "You are an expert Iraqi teacher. Extract exam data precisely into JSON." }
    });
    const data = JSON.parse(cleanJson(response.text || '{}'));
    if (data && Array.isArray(data.questions)) data.questions = data.questions.map((q: any) => fixInlineSubQuestions(q));
    return data || { title: "", questions: [] };
  } catch (error) {
    console.error("Extraction error:", error);
    throw new Error(friendlyError(error));
  }
}

export async function extractExamFromImages(base64Images: string[]): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    const imagesData = await Promise.all(base64Images.map(b64 => compressImage(b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`, 1500, 1500, 0.7)));

    const prompt = `Extract questions from this Iraqi exam paper. Output JSON with: title, requiredQuestionsCount, questions [{text, grade, answer, type}].
    CRITICAL: Preserve Arabic digits. Nest sub-questions. Copy grades exactly. Clean redundant identifiers.`;

    const parts: any[] = [...imagesData.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } })), { text: prompt }];

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", contents: { parts },
      config: { responseMimeType: "application/json", temperature: 0.1, systemInstruction: "You are an expert Iraqi teacher. Extract exam data into JSON. DO NOT perform arithmetic during extraction — copy exactly what is written." }
    });
    const data = JSON.parse(cleanJson(response.text || '{}'));
    if (data && Array.isArray(data.questions)) data.questions = data.questions.map((q: any) => fixInlineSubQuestions(q));
    return data || { title: "", questions: [] };
  } catch (error) {
    console.error("Extraction error:", error);
    throw new Error(friendlyError(error));
  }
}

export async function gradeStudentPaper(
  imageUrls: string[],
  questions: Question[],
  totalExamGrade: number,
  requiredQuestionsCount: number,
  subject: string = "عام",
  onProgress?: (current: number, total: number, phase: 'compressing' | 'grading') => void
): Promise<{ results: { studentName: string; gradings: GradingResult[]; totalGrade: number }[] }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    if (onProgress) onProgress(0, imageUrls.length, 'compressing');
    const base64ImagesData: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      base64ImagesData.push(await compressImage(imageUrls[i], 2000, 2000, 0.85));
      if (onProgress) onProgress(i + 1, imageUrls.length, 'compressing');
    }

    const flattenedQuestions: any[] = [];
    const flatten = (qs: Question[], parentText: string = "", path: string = "") => {
      qs.forEach((q, index) => {
        let label = q.text.split(/[:\-\.\/\(\)\[\]]/)[0].trim();
        if (label.length > 15 || label.length === 0) label = `سؤال ${index + 1}`;
        const fullPath = path ? `${path} / ${label}` : label;
        const combinedText = parentText ? `${parentText} - ${q.text}` : q.text;
        if (!q.subQuestions || q.subQuestions.length === 0) {
          flattenedQuestions.push({ id: q.id, label: fullPath, text: combinedText, answer: q.answer, grade: q.grade, type: q.type });
        } else {
          flatten(q.subQuestions, combinedText, fullPath);
        }
      });
    };
    flatten(questions);

    if (onProgress) onProgress(0, 100, 'grading');
    const isMath = subject.includes('رياضيات') || subject.toLowerCase().includes('math');

    const prompt = `You are evaluating a student's handwritten exam paper image.

Subject: ${subject}.
Questions and model answers: ${JSON.stringify(flattenedQuestions)}.
Total Max Grade: ${totalExamGrade}.
Required Questions Count: ${requiredQuestionsCount || 'All'}.

WARNING — MOST IMPORTANT RULE:
You must read the student's written answer EXACTLY as ink on paper. Never compute or verify arithmetic.
If the student wrote "3×4=10", STUDENT_FINAL = 10 (not 12). If they wrote "15÷3=6", STUDENT_FINAL = 6 (not 5).
The value after the last "=" is the student's answer. Copy it. Do not evaluate it.

For each question follow these steps EXACTLY:

STEP 1 — READ STUDENT'S FINAL WRITTEN VALUE
Find the answer area for this question in the image.
STUDENT_FINAL = the ink value after the last "=" sign written by the student.
If student circled/boxed a value → [BOXED: value] = STUDENT_FINAL.
Do NOT compute. Do NOT verify. The ink shape after = is STUDENT_FINAL.

STEP 2 — READ MODEL ANSWER FINAL VALUE
MODEL_FINAL = value after the last "=" in the 'answer' field. Do NOT compute. Just read.

STEP 3 — COMPARE AS TEXT STRINGS
Normalize Arabic-Indic digits (٠-٩) to Western (0-9) for comparison only.
Are STUDENT_FINAL and MODEL_FINAL numerically equal?
${isMath ? `
✅ YES → full grade. studentAnswer = STUDENT_FINAL. Done.
❌ NO  → go to Step 4.

STEP 4 — FIND WHERE STUDENT'S WORK DIVERGED FROM MODEL ANSWER
Read the student's FULL written working (all lines) and compare step-by-step with model answer.
Find the FIRST step where the student's written work differs from the model answer.

Error types:
① ORDER_OF_OPERATIONS: student applied +/− before ×/÷ when they shouldn't → grade 0.
② SIGN_ERROR: wrong operator at a step → partial grade (50%).
③ ARITHMETIC_SLIP: right operator, wrong computed result at one step → deduct 1 mark max.
④ WRONG_METHOD: completely different approach → 0 or based on validity.
⑤ INCOMPLETE: stopped before finishing → partial for correct steps done.
` : `
✅ Match → full grade.
❌ No match → compare meaning of student answer with model answer. Partial credit proportionally.
`}

OUTPUT — JSON only:
{"results":[{"studentName":"...","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[ymin,xmin,ymax,xmax],"pageIndex":number}]}]}

• studentAnswer = STUDENT_FINAL if Step 3 passed, or full working if Step 4 reached.
• grade = full (Step 3) or based on divergence analysis (Step 4).
• feedback = Arabic (العربية الفصحى):
  Step 3 pass → brief praise.
  Step 4 → "الطالب كتب [STUDENT_FINAL]، الجواب النموذجي [MODEL_FINAL]. في الخطوة [N]: الطالب كتب [ما كتبه] بينما الصواب [ما يجب]. [نوع الخطأ]."
• box = [ymin,xmin,ymax,xmax] student answer location (0–1000).
• pageIndex = 0-based image index.`;

    const parts: any[] = base64ImagesData.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } }));
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath
          ? "أنت مقيّم امتحانات رياضيات. القاعدة الأهم: لا تعيد حساب أي شيء كتبه الطالب. إذا كتب 3×4=10 فجوابه هو 10. إذا كتب 15÷3=6 فجوابه هو 6. STUDENT_FINAL هو الرقم بعد آخر = في خط الطالب — اقرأه كنقش حبر فقط. قارنه بـ MODEL_FINAL. إن اختلفا ابحث في الخطوات عن أول نقطة اختلاف. الملاحظات بالعربية الفصحى."
          : "أنت مقيّم امتحانات. اقرأ جواب الطالب النهائي كما هو مكتوب ولا تعيد حسابه. قارنه بالجواب النموذجي وامنح الدرجة المناسبة. الملاحظات بالعربية الفصحى."
      }
    });

    if (onProgress) onProgress(100, 100, 'grading');

    const data = JSON.parse(cleanJson(response.text || '{}'));
    const results = data.results || (data.gradings ? [{ studentName: data.studentName || 'طالب غير معروف', gradings: data.gradings, totalGrade: data.totalGrade }] : []);

    return {
      results: results.map((r: any) => {
        const gradingsWithMax = (r.gradings || []).map((g: any) => ({
          ...g,
          maxGrade: g.maxGrade || flattenedQuestions.find(fq => fq.id === g.questionId)?.grade || 0
        }));
        const computedTotal = gradingsWithMax.reduce((acc: number, g: any) => acc + (Number(g.grade) || 0), 0);
        return { ...r, gradings: gradingsWithMax, totalGrade: computedTotal };
      })
    };
  } catch (error: any) {
    console.error("Grading error:", error);
    throw new Error(friendlyError(error));
  }
}

export async function gradeMultipleStudents(
  imageUrls: string[],
  questions: Question[],
  totalExamGrade: number,
  requiredQuestionsCount: number,
  subject: string = "عام",
  onProgress?: (current: number, total: number, phase: 'compressing' | 'grading') => void
): Promise<{ results: { studentName: string; gradings: GradingResult[]; totalGrade: number }[] }> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(getApiKeyErrorMessage());
    const ai = new GoogleGenAI({ apiKey });

    if (onProgress) onProgress(0, imageUrls.length, 'compressing');
    const base64ImagesData: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      base64ImagesData.push(await compressImage(imageUrls[i], 2000, 2000, 0.85));
      if (onProgress) onProgress(i + 1, imageUrls.length, 'compressing');
    }

    const flattenedQuestions: any[] = [];
    const flatten = (qs: Question[], parentText: string = "", path: string = "") => {
      qs.forEach((q, index) => {
        let label = q.text.split(/[:\-\.\/\(\)\[\]]/)[0].trim();
        if (label.length > 15 || label.length === 0) label = `سؤال ${index + 1}`;
        const fullPath = path ? `${path} / ${label}` : label;
        const combinedText = parentText ? `${parentText} - ${q.text}` : q.text;
        if (!q.subQuestions || q.subQuestions.length === 0) {
          flattenedQuestions.push({ id: q.id, label: fullPath, text: combinedText, answer: q.answer, grade: q.grade, type: q.type });
        } else {
          flatten(q.subQuestions, combinedText, fullPath);
        }
      });
    };
    flatten(questions);

    if (onProgress) onProgress(0, 100, 'grading');
    const isMath = subject.includes('رياضيات') || subject.toLowerCase().includes('math');
    const imageParts: any[] = base64ImagesData.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } }));

    // ─────────────────────────────────────────────────────────────────────
    // CALL 1 — BLIND TRANSCRIPTION
    // Model sees images only — no questions, no answers.
    // Cannot "fix" what it doesn't know is wrong.
    // ─────────────────────────────────────────────────────────────────────
    const questionLabels = flattenedQuestions.map(q => ({ id: q.id, label: q.label }));

    const transcribePrompt = `You are a DUMB optical scanner with zero math knowledge. You convert ink to text.

For each question label listed here: ${JSON.stringify(questionLabels)}
Find the handwritten answer area for that question and copy EVERY ink mark exactly.

ABSOLUTE RULES — VIOLATION = SYSTEM FAILURE:
1. YOU HAVE NO MATH KNOWLEDGE. You cannot add, subtract, multiply, divide, or evaluate anything.
2. Copy EVERY character exactly as written: digits, operators (+−×÷√=<>), Arabic/Western numerals.
3. If student wrote "3×4=10" → you write "3×4=10". You do NOT write "3×4=12". EVER.
4. If student wrote "5+3=7" → you write "5+3=7". You do NOT write "5+3=8". EVER.
5. The = sign and what follows it is PART OF THE ANSWER. Never replace the value after = with a computed result.
6. [BOXED: value] — student circled or boxed a final answer.
7. Crossed-out text: skip it.
8. Blank area: write "BLANK".
9. Unclear ink: copy best guess + "?".
10. Multi-line working: copy ALL lines in order, separated by " | ".

CRITICAL: You are copying INK SHAPES. 3×4=10 has three ink shapes after = : "1" and "0". Copy "10". Not "12".

Output JSON only:
{"studentName": "...", "transcriptions": [{"id": "...", "rawText": "..."}]}

- studentName: student's name from paper, otherwise "طالب".
- id: must match exactly from question labels list.
- rawText: every ink mark in the answer area, copied character by character, exactly as written.`;

    const transcribeResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [...imageParts, { text: transcribePrompt }] },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: "You are a zero-intelligence optical character recognition scanner. You have NO knowledge of mathematics, arithmetic, language, or meaning. You see only ink shapes and you copy them. If you see the ink shapes '3×4=10' you output '3×4=10'. You never compute. You never verify. You never correct. The digit after = is just an ink shape to copy, not a result to validate. Copy every ink shape exactly as it appears."
      }
    });

    const transcribeData = JSON.parse(cleanJson(transcribeResponse.text || '{}'));
    const studentName: string = transcribeData.studentName || 'طالب غير معروف';
    const transcriptions: { id: string, rawText: string }[] = transcribeData.transcriptions || [];

    const questionsWithRaw = flattenedQuestions.map(q => ({
      ...q,
      studentRawText: transcriptions.find(t => t.id === q.id)?.rawText || 'BLANK'
    }));

    // ─────────────────────────────────────────────────────────────────────
    // CALL 2 — COMPARISON ONLY (text only, no images)
    // Model receives transcribed text + expected answers.
    // Cannot re-read or re-interpret the student's work.
    // ─────────────────────────────────────────────────────────────────────
    const comparePrompt = `You are a strict answer comparator. You receive transcribed student answers and compare them against expected answers.

Subject: ${subject}.
Student name: ${studentName}.
Questions with expected answers and transcribed student text:
${JSON.stringify(questionsWithRaw)}
Total Max Grade: ${totalExamGrade}.
Required Questions Count: ${requiredQuestionsCount || 'All'}.

IMPORTANT — THE TRANSCRIBED TEXT IS GROUND TRUTH:
The studentRawText was copied ink-by-ink from the student's paper. It is EXACTLY what the student wrote.
If studentRawText says "3×4=10" then the student wrote 3×4=10. The student's answer IS 10.
Do NOT recompute. Do NOT verify arithmetic in studentRawText. Treat it as a fixed string.

For each question:

STEP 1 — IDENTIFY STUDENT'S FINAL WRITTEN VALUE:
  Look for a [BOXED: value] in studentRawText → that is STUDENT_FINAL.
  If no box: STUDENT_FINAL = the value written after the LAST "=" sign in studentRawText.
  If no "=" sign: STUDENT_FINAL = the entire studentRawText trimmed.
  If studentRawText is "BLANK" → grade 0, feedback "لم يجب", done.
  DO NOT COMPUTE. STUDENT_FINAL is read from the text string, not calculated.

STEP 2 — IDENTIFY MODEL'S FINAL VALUE:
  MODEL_FINAL = the value after the last "=" in the 'answer' field.
  If no "=": MODEL_FINAL = the full 'answer' field trimmed.
  DO NOT COMPUTE. Just read the string.

STEP 3 — COMPARE AS STRINGS (allow Arabic/Western digit equivalence):
  Normalize: convert Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) to Western (0-9) for comparison only.
  Are STUDENT_FINAL and MODEL_FINAL numerically equal?
  ✅ YES → full grade. studentAnswer = STUDENT_FINAL. Done.
  ❌ NO  → go to Step 4.

STEP 4 — LOCATE DIVERGENCE (only if Step 3 failed):
${isMath ? `  Compare studentRawText steps against 'answer' steps to find FIRST divergence point.
  ① ORDER_OF_OPERATIONS: student applied lower-priority op before higher-priority? → grade 0.
  ② SIGN_ERROR: wrong operator (+−×÷√) at correct position? → partial grade (50%).
  ③ ARITHMETIC_SLIP: correct operator, wrong computed result at one step? → deduct 1 mark max.
  ④ WRONG_METHOD: completely different approach? → 0 or based on validity.
  ⑤ INCOMPLETE: stopped mid-way? → partial for correct steps done.`
    : `  Compare meaning of studentRawText with expected answer. Partial credit proportionally.`}

Output JSON only:
{"results":[{"studentName":"${studentName}","gradings":[{"questionId":"...","studentAnswer":"...","grade":number,"maxGrade":number,"feedback":"...","box":[0,0,0,0],"pageIndex":0}]}]}

- studentAnswer: STUDENT_FINAL (Step 2 pass) or full studentRawText (Step 4 reached).
- grade: full (Step 3 pass) or 0/partial (Step 4).
- feedback: Arabic (العربية الفصحى).
  Step 3 pass → brief praise.
  Step 4 → "الطالب كتب [STUDENT_FINAL] والجواب النموذجي [MODEL_FINAL]. الخطأ: [وصف دقيق لنقطة الانحراف]."
- box/pageIndex: set to 0.`;

    const compareResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [{ text: comparePrompt }] },
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        systemInstruction: isMath
          ? "أنت مقارن نصوص صارم للرياضيات. تستقبل نصاً منسوخاً حرفياً من ورقة الطالب. هذا النص هو الحقيقة المطلقة — لا تعيد حساب أي شيء فيه. إذا كتب 3×4=10 فجوابه هو 10 وليس 12. استخرج الرقم بعد آخر علامة = في النص المنسوخ كـ STUDENT_FINAL. استخرج الرقم بعد آخر = في حقل answer كـ MODEL_FINAL. قارنهما كنصين. إن تطابقا درجة كاملة. إن اختلفا ابحث في خطوات النص عن أول نقطة اختلاف. الملاحظات بالعربية الفصحى."
          : "أنت مقارن نصوص. النص المنسوخ هو ما كتبه الطالب فعلاً — لا تعيد حسابه. قارن معناه بالجواب المتوقع وأعط الدرجة. الملاحظات بالعربية الفصحى."
      }
    });

    if (onProgress) onProgress(100, 100, 'grading');

    const data = JSON.parse(cleanJson(compareResponse.text || '{}'));
    const results = data.results || (data.gradings ? [{ studentName, gradings: data.gradings, totalGrade: data.totalGrade }] : []);

    return {
      results: results.map((r: any) => {
        const gradingsWithMax = (r.gradings || []).map((g: any) => ({
          ...g,
          maxGrade: g.maxGrade || flattenedQuestions.find(fq => fq.id === g.questionId)?.grade || 0
        }));
        const computedTotal = gradingsWithMax.reduce((acc: number, g: any) => acc + (Number(g.grade) || 0), 0);
        return { ...r, gradings: gradingsWithMax, totalGrade: computedTotal };
      })
    };
  } catch (error: any) {
    console.error("Grading error:", error);
    throw new Error(friendlyError(error));
  }
}

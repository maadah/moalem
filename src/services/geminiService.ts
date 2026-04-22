import { GoogleGenAI, Type } from "@google/genai";

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
  box?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized to 1000
  pageIndex?: number;
}

const getApiKey = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const urlKey = urlParams.get('key');
  if (urlKey) {
    localStorage.setItem('GEMINI_API_KEY_AUTO', urlKey);
    window.history.replaceState({}, document.title, window.location.pathname);
    return urlKey;
  }

  const envKey = import.meta.env.VITE_GEMINI_API_KEY || 
                 (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '') ||
                 (typeof process !== 'undefined' ? process.env.VITE_GEMINI_API_KEY : '');
  
  if (envKey && envKey !== 'undefined' && envKey !== 'null' && envKey !== '') {
    return envKey;
  }

  return localStorage.getItem('GEMINI_API_KEY_AUTO') || '';
};

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRetryable = 
        error.message?.includes('503') || 
        error.message?.includes('500') || 
        error.message?.includes('429') || 
        error.message?.includes('quota') ||
        error.message?.includes('high demand') ||
        error.message?.includes('UNAVAILABLE');

      if (!isRetryable || i === maxRetries - 1) throw error;
      
      const delay = initialDelay * Math.pow(2, i);
      console.warn(`Retryable error occurred (attempt ${i + 1}/${maxRetries}). Retrying in ${delay}ms...`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function robustJsonParse(text: string): any {
  if (!text) return null;
  
  try {
    return JSON.parse(text);
  } catch (e) {
    console.warn("Initial JSON parse failed, attempting cleaning...");
  }

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  
  cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => {
    if (match === '\n') return '\\n';
    if (match === '\r') return '\\r';
    if (match === '\t') return '\\t';
    return '';
  });

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn("Cleaned JSON parse failed, attempting structural repair...");
  }

  const stack: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') stack.push('}');
    else if (cleaned[i] === '[') stack.push(']');
    else if (cleaned[i] === '}' || cleaned[i] === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === cleaned[i]) {
        stack.pop();
      }
    }
  }
  
  const quoteMatches = cleaned.match(/"/g);
  if (quoteMatches && quoteMatches.length % 2 !== 0) {
    cleaned += '"';
  }

  while (stack.length > 0) {
    cleaned += stack.pop();
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Structural repair failed.");
  }

  return null;
}

export async function extractExamFromImages(base64Images: string[], apiKey: string): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `
    You are an expert at reading Arabic Iraqi school exam papers. Analyze the provided image(s) and extract ALL questions into a structured JSON.

    ============================================================
    STEP 1 — UNDERSTAND THE IRAQI EXAM HIERARCHY
    ============================================================
    Iraqi exams follow this 3-level hierarchy:

    Level 1 — MAIN QUESTION:   starts with  س١ / س٢ / س٣  (or س1, س2, س3)
    Level 2 — BRANCH:          starts with  أ / ب / ج       (Arabic letters)
    Level 3 — POINT:           starts with  ١ / ٢ / ٣       (numbers)

    NON-LEAF parents (those that contain sub-items) do NOT get their own answer field.

    ============================================================
    STEP 2 — HANDLE INLINE NOTATION
    ============================================================
    When you see  "س١/أ"  or  "س١ أ"  on the SAME LINE:
      • "س١" is the MAIN QUESTION (Level 1)
      • "أ" is the FIRST BRANCH (Level 2)
    You MUST split them into a nested hierarchy.

    OUTPUT FORMAT:
    {
      "title": "Exam title",
      "requiredQuestionsCount": <number>,
      "questions": [ ... ]
    }
  `;

  const imageParts = await Promise.all(base64Images.map(async (base64) => {
    const dataUrl = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
    const compressedData = await compressImage(dataUrl);
    return {
      inlineData: {
        data: compressedData,
        mimeType: "image/jpeg",
      },
    };
  }));

  const questionSchema: any = {
    type: Type.OBJECT,
    required: ["id", "text", "type"],
    properties: {
      id: { type: Type.STRING },
      text: { type: Type.STRING },
      answer: { type: Type.STRING },
      grade: { type: Type.NUMBER },
      type: { type: Type.STRING },
      subStyle: { type: Type.STRING },
      requiredSubCount: { type: Type.NUMBER },
      subQuestions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["id", "text", "type"],
          properties: {
            id: { type: Type.STRING },
            text: { type: Type.STRING },
            answer: { type: Type.STRING },
            grade: { type: Type.NUMBER },
            type: { type: Type.STRING },
            subQuestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["id", "text", "type"],
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  grade: { type: Type.NUMBER },
                  type: { type: Type.STRING }
                }
              }
            }
          }
        }
      }
    }
  };

  const response = await retryWithBackoff(() => ai.models.generateContent({
    model: "gemini-1.5-flash",
    contents: [{ 
      role: 'user', 
      parts: [...imageParts, { text: prompt }] 
    }],
    config: {
      systemInstruction: "You are a professional Iraqi exam digitizer. Splitting 'سX/أ' into main question and branch sub-question is mandatory.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["questions"],
        properties: {
          title: { type: Type.STRING },
          requiredQuestionsCount: { type: Type.NUMBER },
          questions: { type: Type.ARRAY, items: questionSchema }
        }
      }
    }
  }));

  const text = response.text || '';
  let parsed = robustJsonParse(text);
  if (parsed && Array.isArray(parsed.questions)) {
    parsed.questions = parsed.questions.map(q => fixInlineSubQuestions(q));
  }
  return parsed || { title: "", questions: [] };
}

const ARABIC_BRANCH_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
const ARABIC_DIGITS_RE = /^[١٢٣٤٥٦٧٨٩٠1-9]/;

function isLetterLabel(ch: string): boolean {
  return ARABIC_BRANCH_LETTERS.some(l => ch.startsWith(l));
}

function makeId(base: string, suffix: string | number): string {
  return `${base}_auto_${suffix}`;
}

function fixInlineSubQuestions(q: Question, parentId?: string): Question {
  const id = q.id || makeId(parentId || 'q', Math.random().toString(36).slice(2, 6));

  if (q.subQuestions && q.subQuestions.length > 0) {
    return {
      ...q,
      id,
      subQuestions: q.subQuestions.map((sq, i) => fixInlineSubQuestions(sq, `${id}_${i}`)),
    };
  }

  const text = (q.text || '').trim();
  const inlinePattern = /^(س\s*[١٢٣٤٥٦٧٨٩٠\d]*)\s*[\/\\]\s*([أبجدهوزحطي١٢٣٤٥٦٧٨٩٠1-9])([\s\S]*)$/u;
  const inlineMatch = text.match(inlinePattern);

  if (inlineMatch) {
    const mainLabel = inlineMatch[1].trim();
    const firstBranchChar = inlineMatch[2];
    const remainder = inlineMatch[3];

    const segments = splitIntoBranchSegments(firstBranchChar + remainder);

    if (segments.length > 0) {
      const subQuestions: Question[] = segments.map((seg, i) => ({
        id: makeId(id, i),
        text: seg.label + '/ ' + seg.body.trim(),
        answer: '',
        grade: 0,
        type: q.type || 'text',
      }));

      const subStyle: 'letters' | 'numbers' = isLetterLabel(segments[0].label) ? 'letters' : 'numbers';

      return {
        ...q,
        id,
        text: mainLabel,
        subQuestions,
        subStyle,
        answer: "" as any,
      };
    }
  }

  const multiLineSegments = splitIntoBranchSegments(text);
  if (multiLineSegments.length >= 2) {
    const subQuestions: Question[] = multiLineSegments.map((seg, i) => ({
      id: makeId(id, i),
      text: seg.label + '/ ' + seg.body.trim(),
      answer: '',
      grade: 0,
      type: q.type || 'text',
    }));

    const subStyle: 'letters' | 'numbers' = isLetterLabel(multiLineSegments[0].label) ? 'letters' : 'numbers';
    const firstIdx = text.indexOf(multiLineSegments[0].label);
    const mainText = firstIdx > 0 ? text.slice(0, firstIdx).trim() : q.text;

    return {
      ...q,
      id,
      text: mainText || q.text,
      subQuestions,
      subStyle,
      answer: "" as any,
    };
  }

  return { ...q, id };
}

interface BranchSegment { label: string; body: string; }

function splitIntoBranchSegments(text: string): BranchSegment[] {
  const normalised = text.replace(/\r\n?/g, '\n');
  const labelRe = /(?:^|\n|(?<=\/\s*))([أبجدهوزحطي١٢٣٤٥٦٧٨٩٠1-9])[\s\/\-\.]*/gu;

  const matches: { label: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(normalised)) !== null) {
    matches.push({ label: m[1], index: m.index + (m[0].length - m[0].trimStart().length) });
  }

  if (matches.length < 1) return [];

  const segments: BranchSegment[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i].label.length;
    let bodyStart = start;
    if (normalised[bodyStart] && /[\s\/\-\.]/.test(normalised[bodyStart])) bodyStart++;

    const end = i + 1 < matches.length ? matches[i + 1].index : normalised.length;
    const body = normalised.slice(bodyStart, end).trim();
    segments.push({ label: matches[i].label, body });
  }

  return segments;
}

async function compressImage(url: string, maxWidth = 2560, maxHeight = 2560, quality = 0.9): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('Could not get canvas context');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = reject;
  });
}

export async function gradeStudentPaper(
  imageUrls: string[],
  questions: Question[],
  totalExamGrade: number,
  requiredQuestionsCount: number,
  onProgress?: (current: number, total: number, phase: 'compressing' | 'grading') => void
): Promise<{ results: { studentName: string; gradings: GradingResult[]; totalGrade: number }[] }> {
  if (onProgress) onProgress(0, imageUrls.length, 'compressing');
  const base64Images = await Promise.all(imageUrls.map(async (url, idx) => {
    const compressed = await compressImage(url);
    if (onProgress) onProgress(idx + 1, imageUrls.length, 'compressing');
    return compressed;
  }));

  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key missing");
  const ai = new GoogleGenAI({ apiKey });

  const flattenedQuestions: any[] = [];
  const leafQuestionIds = new Set<string>();

  const flatten = (qs: Question[], parentText: string = "", path: string = "") => {
    qs.forEach((q, index) => {
      let label = q.text.split(/[:\-\.\/\(\)\[\]]/)[0].trim();
      if (label.length > 15 || label.length === 0) label = `Item ${index + 1}`;
      const fullPath = path ? `${path} / ${label}` : label;
      const combinedText = parentText ? `${parentText} - ${q.text}` : q.text;
      
      if (!q.subQuestions || q.subQuestions.length === 0) {
        flattenedQuestions.push({ id: q.id, label: fullPath, text: combinedText, modelAnswer: q.answer, maxGrade: q.grade, type: q.type });
        leafQuestionIds.add(q.id);
      } else {
        flatten(q.subQuestions, combinedText, fullPath);
      }
    });
  };
  flatten(questions);

  const gradingSchema = {
    type: Type.OBJECT,
    properties: {
      results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            studentName: { type: Type.STRING },
            gradings: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionId: { type: Type.STRING },
                  studentAnswer: { type: Type.STRING },
                  grade: { type: Type.NUMBER },
                  feedback: { type: Type.STRING },
                  box: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                  pageIndex: { type: Type.NUMBER }
                }
              }
            },
            totalGrade: { type: Type.NUMBER }
          }
        }
      }
    }
  };

  const prompt = `Grade student handwritten papers.
    Questions: ${JSON.stringify(flattenedQuestions)}
    Total Grade: ${totalExamGrade}
    Required: ${requiredQuestionsCount}
    Use IDs exactly. Feedback in Arabic.`;

  const response = await retryWithBackoff(() => ai.models.generateContent({
    model: "gemini-1.5-flash",
    contents: [{ 
      role: "user", 
      parts: [...base64Images.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } })), { text: prompt }] 
    }],
    config: {
      systemInstruction: "You are a professional Arabic teacher. Grading must be consistent and fair. Use only provided IDs.",
      responseMimeType: "application/json",
      responseSchema: gradingSchema,
      temperature: 0.1
    }
  }));

  const text = response.text || '';
  const parsed = robustJsonParse(text);
  return { results: parsed?.results || [] };
}

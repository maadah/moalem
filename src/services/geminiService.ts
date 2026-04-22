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
  // 1. Check URL parameters (e.g., ?key=...)
  const urlParams = new URLSearchParams(window.location.search);
  const urlKey = urlParams.get('key');
  if (urlKey) {
    localStorage.setItem('GEMINI_API_KEY_AUTO', urlKey);
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
    return urlKey;
  }

  // 2. Check Netlify/Environment Variable (Vite bakes these at build time)
  const envKey = import.meta.env.VITE_GEMINI_API_KEY || 
                 (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : '') ||
                 (typeof process !== 'undefined' ? process.env.VITE_GEMINI_API_KEY : '');
  
  if (envKey && envKey !== 'undefined' && envKey !== 'null' && envKey !== '') {
    return envKey;
  }

  // 3. Check Local Storage
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
  
  // 1. Try direct parse
  try {
    return JSON.parse(text);
  } catch (e) {
    console.warn("Initial JSON parse failed, attempting cleaning...");
  }

  // 2. Clean common markdown and control characters
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  
  // Handle unescaped newlines and control characters
  cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, (match) => {
    if (match === '\n') return '\\n';
    if (match === '\r') return '\\r';
    if (match === '\t') return '\\t';
    return '';
  });

  // 3. Try parsing cleaned version
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn("Cleaned JSON parse failed, attempting structural repair...");
  }

  // 4. Structural repair for truncated JSON
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
    console.error("Structural repair failed. Last resort: partial extraction.");
  }

  // 5. Last resort: partial extraction of the results array
  try {
    const resultsMatch = cleaned.match(/"results"\s*:\s*\[/);
    if (resultsMatch) {
      const startIndex = resultsMatch.index!;
      let partial = "{" + cleaned.substring(startIndex);
      
      const pStack: string[] = [];
      for (let i = 0; i < partial.length; i++) {
        if (partial[i] === '{') pStack.push('}');
        else if (partial[i] === '[') pStack.push(']');
        else if (partial[i] === '}' || partial[i] === ']') {
          if (pStack.length > 0 && pStack[pStack.length - 1] === partial[i]) {
            pStack.pop();
          }
        }
      }
      while (pStack.length > 0) {
        partial += pStack.pop();
      }
      return JSON.parse(partial);
    }
  } catch (e) {
    console.error("Partial extraction failed.");
  }

  throw new Error("فشل في تحليل استجابة الذكاء الاصطناعي (JSON Parse Error). يرجى المحاولة مرة أخرى.");
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

    A main question may contain:
      - No sub-items at all         → it is a leaf, needs its own answer field
      - Only branches (أ، ب، ج)    → branches are the leaves
      - Only points (١، ٢، ٣)      → points are the leaves
      - Both branches AND points    → points inside each branch are the leaves

    LEAF = the deepest item in the tree → it needs an answer field.
    NON-LEAF parents (those that contain sub-items) do NOT get their own answer field.

    ============================================================
    STEP 2 — HANDLE INLINE NOTATION  ← THIS IS THE KEY FIX
    ============================================================
    Iraqi exams often write  "س١/أ"  or  "س١/ أ"  or  "س١ أ"  on the SAME LINE.
    This does NOT mean there is one question called "س١/أ".
    It means:
      • "س١" is the MAIN QUESTION (Level 1) — its text is whatever comes before the branch label
      • "أ" is the FIRST BRANCH (Level 2) — its text is whatever comes after the slash

    PARSING RULE FOR INLINE NOTATION:
    When you see a pattern like  "سX / Y"  or  "سX/Y"  where Y is a branch letter (أ,ب,ج) or point number:
      1. Create a main question object for  سX.
      2. Inside its subQuestions array, create a sub-question for  Y.
      3. The text of the sub-question starts from Y's content, not from "سX/Y".

    EXAMPLES of inline notation you must split correctly:
      "س١/أجد ناتج ما يلي"  →  main question س١, branch أ with text "جد ناتج ما يلي"
      "س٢/ أ/ اقرأ الأعداد"  →  main question س٢, branch أ with text "اقرأ الأعداد"
      "س١/أ"  followed later by  "ب/"  on a new line  →  both أ and ب are branches of س١

    ============================================================
    STEP 3 — DETECT BRANCH / POINT SEPARATORS
    ============================================================
    Branches and points can appear in two ways:
      A) INLINE with the parent:   "س١/أ نص الفرع"     (split as described above)
      B) ON A NEW LINE:            "أ/" or "أ-" or "أ." or just "أ" at start of line

    In BOTH cases, the branch/point must be nested inside the parent question as a subQuestion.

    ============================================================
    STEP 4 — requiredSubCount
    ============================================================
    If a question says "الاجابة عن اثنين فقط" or "فرعين فقط" or "خمسة فقط",
    set requiredSubCount on that question/branch to the number mentioned.
    The top-level instruction "الاجابة عن خمس اسئلة فقط" → set requiredQuestionsCount on the root.

    ============================================================
    STEP 5 — subStyle
    ============================================================
    Set "subStyle": "letters"  on a question whose direct children are branches (أ، ب، ج).
    Set "subStyle": "numbers"  on a question whose direct children are numbered points (١، ٢، ٣).

    ============================================================
    STEP 6 — grade
    ============================================================
    Grades are usually printed in parentheses like (٢٠درجة) next to the question label.
    Assign the grade to that question object. If no grade is visible, use 0.

    ============================================================
    STEP 7 — FULL EXAMPLE
    ============================================================
    Suppose the image contains:

        س١/أجد ناتج ما يلي:          (٢٠درجة)
            ٥٩٣٨٠٨٧١٩  +  ١٢٢٤٧٩٨٣٠
            ٧٤٨٣٢٣٦١٦  -  ١٣٩٣٩٠١٧٧
        ب/أكتب العدد بالصورة التحليلية ← ٤٢١٤٣٠٢

    Correct JSON structure:
    {
      "id": "q1",
      "text": "س١",
      "grade": 20,
      "type": "text",
      "subStyle": "letters",
      "subQuestions": [
        {
          "id": "q1a",
          "text": "أ/ جد ناتج ما يلي:\n٥٩٣٨٠٨٧١٩ + ١٢٢٤٧٩٨٣٠\n٧٤٨٣٢٣٦١٦ - ١٣٩٣٩٠١٧٧",
          "grade": 0,
          "type": "text",
          "answer": ""
        },
        {
          "id": "q1b",
          "text": "ب/ أكتب العدد بالصورة التحليلية ← ٤٢١٤٣٠٢",
          "grade": 0,
          "type": "text",
          "answer": ""
        }
      ]
    }

    ============================================================
    STEP 8 — ADDITIONAL RULES
    ============================================================
    - Scan the ENTIRE image top-to-bottom. Do not miss any question.
    - Generate unique string IDs for every object (q1, q1a, q1b, q2, q2a, q2a1 …).
    - type is always "text" unless you see true/false or multiple choice options.
    - Extract math expressions, formulas, and numbers exactly as printed.
    - Escape all double quotes inside JSON strings.
    - Return ONLY valid JSON — no markdown fences, no explanation text.

    OUTPUT FORMAT:
    {
      "title": "Exam title extracted from the paper",
      "requiredQuestionsCount": <number or omit if not specified>,
      "questions": [ ... array of main question objects ... ]
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

  // Define recursive schema for questions
  const questionSchema: any = {
    type: Type.OBJECT,
    required: ["id", "text", "type"],
    properties: {
      id: { type: Type.STRING },
      text: { type: Type.STRING },
      answer: { type: Type.STRING },
      grade: { type: Type.NUMBER },
      type: { type: Type.STRING },
      options: { type: Type.ARRAY, items: { type: Type.STRING } },
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
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
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
    model: "gemini-flash-latest",
    contents: { parts: [...imageParts, { text: prompt }] },
    config: {
      systemInstruction: `You are a professional Arabic exam digitizer specializing in Iraqi school exams.
Your MOST IMPORTANT rule: When you see "سX/أ" or "سX/ أ" on the same line, you MUST split it into:
  - A main question for سX
  - A branch subQuestion for أ (or whatever letter/number follows the slash)
Never treat "سX/أ" as a single flat question. Always nest the branch inside the main question.
Return only valid JSON with no markdown or extra text.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["questions"],
        properties: {
          title: { type: Type.STRING },
          requiredQuestionsCount: { type: Type.NUMBER },
          questions: {
            type: Type.ARRAY,
            items: questionSchema
          }
        }
      }
    }
  }));

  return robustJsonParse(response.text || '');
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
      
      const base64 = canvas.toDataURL('image/jpeg', quality);
      resolve(base64.split(',')[1]);
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
  const totalImages = imageUrls.length;
  
  if (onProgress) onProgress(0, totalImages, 'compressing');
  
  const compressionPromises = imageUrls.map(async (url, index) => {
    try {
      const compressed = await compressImage(url);
      if (onProgress) onProgress(index + 1, totalImages, 'compressing');
      return compressed;
    } catch (e) {
      console.error(`Error compressing image ${index}:`, e);
      return null;
    }
  });

  const compressedResults = await Promise.all(compressionPromises);
  const base64Images = compressedResults.filter((img): img is string => img !== null);

  if (base64Images.length === 0) {
    throw new Error("فشل في معالجة الصور المرفوعة.");
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("مفتاح API مفقود. يرجى التأكد من إعداد GEMINI_API_KEY في متغيرات البيئة.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const validQuestionIds = new Set<string>();
  const collectIds = (qs: Question[]) => {
    qs.forEach(q => {
      validQuestionIds.add(q.id);
      if (q.subQuestions) collectIds(q.subQuestions);
    });
  };
  collectIds(questions);

  const flattenedQuestions: any[] = [];
  const leafQuestionIds = new Set<string>();

  const flatten = (qs: Question[], parentText: string = "", path: string = "") => {
    qs.forEach((q, index) => {
      let label = q.text.split(/[:\-\.\/\(\)\[\]]/)[0].trim();
      if (label.length > 15 || label.length === 0) label = `Item ${index + 1}`;
      
      const fullPath = path ? `${path} / ${label}` : label;
      const combinedText = parentText ? `${parentText} - ${q.text}` : q.text;
      
      if (!q.subQuestions || q.subQuestions.length === 0) {
        flattenedQuestions.push({
          id: q.id,
          label: fullPath,
          text: combinedText,
          modelAnswer: q.answer,
          maxGrade: q.grade,
          type: q.type
        });
        leafQuestionIds.add(q.id);
      } else {
        flatten(q.subQuestions, combinedText, fullPath);
      }
    });
  };
  flatten(questions);

  const BATCH_SIZE = 10; 
  const allResults: any[] = [];

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
                  box: { 
                    type: Type.ARRAY, 
                    items: { type: Type.NUMBER },
                    description: "Bounding box [ymin, xmin, ymax, xmax] of the student's answer on the page, normalized to 1000."
                  },
                  pageIndex: { 
                    type: Type.NUMBER,
                    description: "0-based index of the image/page within the provided batch where this answer was found."
                  }
                }
              }
            },
            totalGrade: { type: Type.NUMBER }
          }
        }
      }
    }
  };

  const totalBatches = Math.ceil(base64Images.length / BATCH_SIZE);

  for (let i = 0; i < base64Images.length; i += BATCH_SIZE) {
    const currentBatchIndex = Math.floor(i / BATCH_SIZE) + 1;
    if (onProgress) onProgress(currentBatchIndex, totalBatches, 'grading');
    
    const batch = base64Images.slice(i, i + BATCH_SIZE);
    
    const prompt = `
      You are an expert teacher grading student handwritten exam papers. Your goal is to be EXTREMELY CONSISTENT and FAIR.
      
      EXAM QUESTIONS AND MODEL ANSWERS (Use these IDs exactly):
      ${JSON.stringify(flattenedQuestions, null, 2)}
      
      TOTAL EXAM GRADE: ${totalExamGrade}
      REQUIRED QUESTIONS COUNT: ${requiredQuestionsCount}
      
      GRADING PHILOSOPHY:
      - **Consistency**: The same answer must ALWAYS receive the same grade.
      - **Accuracy**: Compare the student's answer carefully with the model answer.
      - **Partial Credit**: If an answer is partially correct, award partial points based on the completeness and correctness of the key points.
      - **Handwriting**: Be patient with handwriting, but if it's completely illegible, award 0.
      
      INSTRUCTIONS:
      1. Analyze the provided images (Batch ${currentBatchIndex} of ${totalBatches}).
      2. **STRICT QUESTION MAPPING**: You MUST ONLY grade the questions listed in the "EXAM QUESTIONS" section above. 
      3. **MATCH IDs**: You MUST use the exact "id" from the list provided above for each grading result.
      4. **HIERARCHY HANDLING**: 
         - The "label" field (e.g., "س2 / أ") tells you which question and branch it is.
         - If a student writes "س2" followed by "أ", map the answer for "أ" to the ID associated with label "س2 / أ".
      5. **DO NOT HALLUCINATE**: Only use IDs from the provided list.
      6. **STUDENT ANSWER EXTRACTION**: Extract the FULL text of the student's handwritten answer verbatim.
      7. **ARABIC FEEDBACK ONLY**: Provide all feedback and student names in Arabic.
      8. **CONCISE FEEDBACK**: Provide short, constructive feedback (max 15 words). Explain WHY the grade was given if it's not a full mark.
      9. Calculate the total grade for the student.
      10. **VISUAL MARKING**: For each answer, detect its bounding box [ymin, xmin, ymax, xmax] and the image index where it appeared (0 to ${batch.length - 1}).
      11. **DETERMINISM**: Be objective. Do not let external factors influence the grade.
    `;

    const imageParts = batch.map((base64) => ({
      inlineData: {
        data: base64,
        mimeType: "image/jpeg",
      },
    }));

    try {
      const result = await retryWithBackoff(() => ai.models.generateContent({
        model: "gemini-flash-latest", 
        contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
        config: {
          systemInstruction: "You are a professional Arabic teacher. Your grading must be 100% consistent, objective, and fair. Always provide feedback in Arabic. Strictly follow the provided question IDs.",
          responseMimeType: "application/json",
          responseSchema: gradingSchema,
          temperature: 0.1,
          topP: 0.1,
          topK: 1
        },
      }));

      const parsed = robustJsonParse(result.text || '');
      
      if (parsed && parsed.results && Array.isArray(parsed.results)) {
        const filteredResults = parsed.results.map((student: any) => {
          const gradings = student.gradings || [];
          const uniqueGradings: any[] = [];
          const seenIds = new Set<string>();

          gradings.forEach((g: any) => {
            if (leafQuestionIds.has(g.questionId) && !seenIds.has(g.questionId)) {
              if (g.pageIndex !== undefined) {
                g.pageIndex = i + g.pageIndex;
              }
              
              const qInfo = flattenedQuestions.find(fq => fq.id === g.questionId);
              if (qInfo) {
                g.maxGrade = qInfo.maxGrade;
                g.label = qInfo.label;
              }
              
              uniqueGradings.push(g);
              seenIds.add(g.questionId);
            }
          });

          return {
            ...student,
            gradings: uniqueGradings
          };
        }).filter((student: any) => student.gradings.length > 0);
        
        allResults.push(...filteredResults);
      }
    } catch (e: any) {
      console.error(`Error in grading batch ${i}:`, e);
      if (e.message?.includes('429') || e.message?.includes('quota')) {
        throw new Error("تم تجاوز حصة استخدام API (Quota Exceeded). يرجى المحاولة لاحقاً.");
      }
      if (allResults.length > 0) {
        console.warn("Returning partial results due to error in batch.");
        break; 
      }
      throw new Error(`خطأ في معالجة الصور: ${e.message || 'خطأ غير معروف'}`);
    }
  }

  // Merge results by student name
  const mergedMap = new Map<string, any>();
  
  const normalizeName = (name: string) => {
    return name
      .trim()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ');
  };

  allResults.forEach(res => {
    const normName = normalizeName(res.studentName);
    if (mergedMap.has(normName)) {
      const existing = mergedMap.get(normName);
      
      res.gradings.forEach((newG: any) => {
        const existingIdx = existing.gradings.findIndex((eg: any) => eg.questionId === newG.questionId);
        if (existingIdx > -1) {
          if ((newG.grade || 0) > (existing.gradings[existingIdx].grade || 0)) {
            existing.gradings[existingIdx] = newG;
          }
        } else {
          existing.gradings.push(newG);
        }
      });
      
      existing.totalGrade = existing.gradings.reduce((sum: number, g: any) => sum + (g.grade || 0), 0);
    } else {
      mergedMap.set(normName, { ...res, gradings: [...res.gradings] });
    }
  });

  return { results: Array.from(mergedMap.values()) };
}

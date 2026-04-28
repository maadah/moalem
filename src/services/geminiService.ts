import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

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

const getApiKeys = () => {
  const keys: string[] = [];
  
  // Prefer process.env as per skill guidelines
  const envKey = process.env.GEMINI_API_KEY;
  if (envKey && envKey !== 'undefined' && envKey !== 'null' && envKey !== '') {
    keys.push(envKey);
  }

  // Fallbacks for specific environments
  const viteKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (viteKey && !keys.includes(viteKey)) {
    keys.push(viteKey);
  }

  const urlParams = new URLSearchParams(window.location.search);
  const urlKey = urlParams.get('key');
  if (urlKey && !keys.includes(urlKey)) {
    keys.push(urlKey);
  }

  const localKey = localStorage.getItem('GEMINI_API_KEY_AUTO');
  if (localKey && !keys.includes(localKey)) {
    keys.push(localKey);
  }

  return keys.length > 0 ? keys : [''];
};

async function retryWithBackoff<T>(
  fn: (apiKey: string) => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 2000
): Promise<T> {
  const apiKeys = getApiKeys();
  let lastError: any;
  
  // Try each API key
  for (const apiKey of apiKeys) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn(apiKey);
      } catch (error: any) {
        lastError = error;
        const errorMsg = error.message || "";
        
        // If it's a quota error, we should try the NEXT API key immediately
        const isQuotaError = errorMsg.includes('429') || 
                            errorMsg.includes('quota') ||
                            errorMsg.includes('RESOURCE_EXHAUSTED');

        if (isQuotaError) {
          console.warn(`Quota exceeded for an API key. Switching to next key...`);
          break; // Break internal retry loop to switch key
        }

        const isRetryable = 
          errorMsg.includes('503') || 
          errorMsg.includes('500') || 
          errorMsg.includes('high demand') ||
          errorMsg.includes('UNAVAILABLE');

        if (!isRetryable || i === maxRetries - 1) {
          // If not retryable or last attempt for this key, and not a quota error
          // we might want to try the next key anyway as a last resort
          break; 
        }
        
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Retryable error occurred (attempt ${i + 1}/${maxRetries}). Retrying in ${delay}ms...`, errorMsg);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
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

export async function extractExamFromDualImages(
  questionImages: string[],
  answerImages: string[],
  apiKey?: string // API key is optional now as we use rotation inside
): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  const prompt = `
    You are an expert at reading Arabic Iraqi school exam papers AND their model answers. 
    You are provided with two sets of images:
    1. QUESTION IMAGES: Contains the exam questions.
    2. ANSWER IMAGES: Contains the model answers for those questions.

    Your mission is to analyze both sets, extract the questions, and MATCH each question to its correct model answer from the answer images.

    ============================================================
    STEP 1 — HIERARCHAL EXTRACTION (Iraqi Format)
    ============================================================
    Level 1 — MAIN QUESTION:   starts with س١ / س٢ / س٣ (or س1, س2, س3)
    Level 2 — BRANCH:          starts with أ / ب / ج (Arabic letters)
    Level 3 — POINT:           starts with ١ / ٢ / ٣ (numbers)

    ============================================================
    STEP 2 — ANSWER MATCHING
    ============================================================
    • Look at the ANSWER IMAGES. They usually follow the same numbering.
    • Match the answer for س1 أ 1 to the corresponding question entry.
    • If an answer is found for a specific branch or point, put it in the 'answer' field of that leaf node.
    • If a question segment doesn't have an explicit answer in the images, leave it empty.

    OUTPUT FORMAT:
    {
      "title": "Exam title (from question papers)",
      "requiredQuestionsCount": <number>,
      "questions": [ ... ]
    }
  `;

  const qImageParts = await Promise.all(questionImages.map(async (base64) => {
    const dataUrl = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
    const compressedData = await compressImage(dataUrl);
    return { inlineData: { data: compressedData, mimeType: "image/jpeg" } };
  }));

  const aImageParts = await Promise.all(answerImages.map(async (base64) => {
    const dataUrl = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
    const compressedData = await compressImage(dataUrl);
    return { inlineData: { data: compressedData, mimeType: "image/jpeg" } };
  }));

  const response = await retryWithBackoff((currentKey) => {
    const ai = new GoogleGenAI({ apiKey: currentKey });
    return ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: [
        { text: "QUESTION IMAGES:" },
        ...qImageParts,
        { text: "ANSWER IMAGES:" },
        ...aImageParts,
        { text: prompt }
      ],
      config: {
        systemInstruction: `You are a professional teacher. Match questions to answers with perfect accuracy. 
        Arabic text must be preserved exactly. Ensure the 3-level hierarchy is strictly followed.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["questions"],
          properties: {
            title: { type: Type.STRING },
            requiredQuestionsCount: { type: Type.NUMBER },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["id", "text", "type", "subStyle"],
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  grade: { type: Type.NUMBER },
                  type: { type: Type.STRING },
                  subStyle: { type: Type.STRING, enum: ["numbers", "letters"] },
                  subQuestions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      required: ["id", "text", "type", "subStyle"],
                      properties: {
                        id: { type: Type.STRING },
                        text: { type: Type.STRING },
                        answer: { type: Type.STRING },
                        grade: { type: Type.NUMBER },
                        type: { type: Type.STRING },
                        subStyle: { type: Type.STRING, enum: ["numbers", "letters"] },
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
              }
            }
          }
        }
      }
    });
  });

  const text = response.text || '';
  let parsed = robustJsonParse(text);
  if (parsed && Array.isArray(parsed.questions)) {
    parsed.questions = parsed.questions.map((q: any) => fixInlineSubQuestions(q));
  }
  return parsed || { title: "", questions: [] };
}

export async function extractExamFromImages(base64Images: string[], apiKey?: string): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  // We ignore the passed apiKey if we have multiple keys to rotate from environment
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

  const response = await retryWithBackoff((currentKey) => {
    const ai = new GoogleGenAI({ apiKey: currentKey });
    return ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: [
        ...imageParts,
        { text: prompt }
      ],
      config: {
        systemInstruction: `You are a high-end Iraqi Exam Digitization Expert. Your mission is to deconstruct math papers with 100% architectural accuracy.
        
        STRICT HIERARCHY (3 LEVELS):
        1. Main Question (س1, س2...): The root container.
           - 'text': Should be ONLY the label (e.g., "س1"). If there is a global instruction like "أجب عن خمسة أسئلة", it goes into the overall 'title' field.
           - 'subStyle': ALWAYS "letters".
        2. Branch (أ، ب، ج...): The sub-section.
           - 'text': Use the instruction text (e.g., "جد ناتج ما يلي :") or the standalone question text.
           - 'subStyle': ALWAYS "numbers" (even if it currently has no sub-questions, for future consistency).
           - Labels like "أ/" or "ب/" MUST NOT be included in the 'text'.
        3. Point (1, 2, 3...): The specific math problems or multiple choice items.
           - 'text': The actual problem (e.g., "5 + 5"). Labels like "1-" MUST NOT be in the 'text'.
           - 'subQuestions': MUST be empty. Never nest deeper than this.
   
        CRITICAL CLEANING RULES:
        1. If a Question has branches (أ، ب), it MUST be Level 1.
        2. If a Branch has sub-items (1, 2, 3), it MUST have those items as Level 3 subQuestions.
        3. If a question is just "س1/أ/ 5+5", then Level 1 is "س1", and Level 2 is "5+5" (with empty subQuestions).
        4. STICKY HIERARCHY: Do not start a new Main Question (س2) when you see branch "ب/". Ensure all branches (أ، ب، ج) are siblings under the same parent Question.
        5. NO HALUCINATIONS: Do not invent numbering. If the paper says "أ", use Level 2. If it says "1", use Level 3.
   
        CRITICAL CONSTRAINTS:
        - NO NESTED POINTS: A point (Level 3) cannot have subQuestions. It is a leaf node.
        - STICKY BRANCHES: Every Branch (أ, ب, ج..) belongs to the LAST mentioned Question (س1, س2..).
        - PRECISE GRADES: Map grades (درجة) to numeric 'grade' field. Ignore placeholders like "00001".
        - MAPPING EXAMPLE:
          "س1 / أ / جد ناتج ما يلي : 1- 5+5 2- 6+6" 
          Should become:
          { "text": "س1", "subStyle": "letters", "subQuestions": [
              { "text": "جد ناتج ما يلي :", "subStyle": "numbers", "subQuestions": [
                  { "text": "5+5" }, { "text": "6+6" }
              ]}
          ]}
        - VALIDATION: Ensure the hierarchy matches the paper. If "ب" is in the paper, it's a subQuestion of the same "س" as "أ".`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["questions"],
          properties: {
            title: { type: Type.STRING },
            requiredQuestionsCount: { type: Type.NUMBER },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["id", "text", "type", "subStyle"],
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  grade: { type: Type.NUMBER },
                  type: { type: Type.STRING },
                  subStyle: { type: Type.STRING, enum: ["numbers", "letters"] },
                  subQuestions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      required: ["id", "text", "type", "subStyle"],
                      properties: {
                        id: { type: Type.STRING },
                        text: { type: Type.STRING },
                        answer: { type: Type.STRING },
                        grade: { type: Type.NUMBER },
                        type: { type: Type.STRING },
                        subStyle: { type: Type.STRING, enum: ["numbers", "letters"] },
                        subQuestions: { // Added Level 3
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
              }
            }
          }
        }
      }
    });
  });

  const text = response.text || '';
  let parsed = robustJsonParse(text);
  if (parsed && Array.isArray(parsed.questions)) {
    parsed.questions = parsed.questions.map((q: any) => fixInlineSubQuestions(q));
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

function fixInlineSubQuestions(q: Question, parentId?: string, level: number = 1): Question {
  const id = q.id || makeId(parentId || 'q', Math.random().toString(36).slice(2, 6));

  // If Gemini already provided a structure, trust its hierarchy and just fill missing IDs
  if (q.subQuestions && q.subQuestions.length > 0) {
    return {
      ...q,
      id,
      // Default subStyle if missing but children exist
      subStyle: q.subStyle || (level === 1 ? 'letters' : 'numbers'),
      subQuestions: q.subQuestions.map((sq, i) => fixInlineSubQuestions(sq, `${id}_${i}`, level + 1)),
    };
  }

  // Prevent splitting of text beyond level 2 (don't split points themselves)
  if (level >= 3) return { ...q, id };

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
  // Iraqi labels often look like: أ/, ب), 1-, ١.
  // We look for a character at start of line followed strictly by / or ) or - or .
  const labelRe = /(?:^|\n)([أبجدهوزحطي١٢٣٤٥٦٧٨٩٠1-9])[\s]*[\/\)\-\.](?!\d)/gu;

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

  const prompt = `Grade student handwritten papers.
    Questions: ${JSON.stringify(flattenedQuestions)}
    Total Grade: ${totalExamGrade}
    Required: ${requiredQuestionsCount}
    Use IDs exactly. Feedback in Arabic.`;

  const response = await retryWithBackoff((currentKey) => {
    const ai = new GoogleGenAI({ apiKey: currentKey });
    return ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...base64Images.map(data => ({ inlineData: { data, mimeType: "image/jpeg" } })),
        { text: prompt }
      ],
      config: {
        systemInstruction: "You are a professional Arabic teacher. Grading must be consistent and fair. Use only provided IDs.",
        responseMimeType: "application/json",
        responseSchema: {
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
        },
        temperature: 0.1
      }
    });
  });

  const text = response.text || '';
  const parsed = robustJsonParse(text);
  return { results: parsed?.results || [] };
}

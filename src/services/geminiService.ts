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
  // Check both import.meta.env and process.env for maximum compatibility
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
  // Balance braces and brackets
  let openBraces = (cleaned.match(/\{/g) || []).length;
  let closeBraces = (cleaned.match(/\}/g) || []).length;
  let openBrackets = (cleaned.match(/\[/g) || []).length;
  let closeBrackets = (cleaned.match(/\]/g) || []).length;

  // If it's cut off inside a string, close the string first
  const quoteMatches = cleaned.match(/"/g);
  if (quoteMatches && quoteMatches.length % 2 !== 0) {
    cleaned += '"';
  }

  // Close open structures in reverse order
  // We'll use a stack-based approach for better accuracy
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
      
      // Balance this partial string
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
    Analyze the provided images of an exam paper and extract EVERY SINGLE question, branch, and point into a structured JSON format.
    
    THINKING STEP:
    1. Identify general exam instructions (e.g., "Answer 5 questions only").
    2. Mentally list all the main questions (e.g., س1, س2, س3, س4, س5, س6).
    3. For each main question, identify if it has branches (أ، ب، ج) or points (1، 2، 3).
    4. Ensure your JSON reflects this hierarchy using "subQuestions".
    
    IRAQI EXAM FORMAT RULES:
    - **"س1، س2، س3..."**: Level 1 (Top Level).
    - **"أ، ب، ج، د..."**: Level 2 (Branches). These MUST BE in the "subQuestions" array of the preceding "س" question.
    - **"1، 2، 3، 4..."**: Level 3 (Points). If they follow a branch (أ، ب)، they MUST be nested inside that branch. If they follow "س" directly, they are Level 2.
    
    CRITICAL STRUCTURE RULES (Split Combined Labels):
    - **MANDATORY SPLIT**: If you see combined labels like "س1/أ", "س1-أ", or "س1: أ", you MUST split them into TWO levels:
      1. Parent (Level 1): Text: "س1".
      2. Child (Level 2): Text: "أ) [The rest of the question text]".
    - **NEVER** include the branch letter (أ, ب...) in the Level 1 question text.
    - **SUBSTYLE**: 
      - If a question/branch has children starting with (أ, ب, ج), set "subStyle" to "letters".
      - If children start with (1, 2, 3), set "subStyle" to "numbers".
    
    CRITICAL EXTRACTION LOGIC:
    - **GENERAL INSTRUCTIONS**: Text at the very top like "Answer all questions" or "Use clear handwriting" should set "requiredQuestionsCount" (if numeric) but NOT be a question.
    - **CHOICE WORDS**: words like "خمسة فقط" (5 only), "اثنين فقط" (2 only), "فرعين فقط" (2 branches only) indicate a requirement. Use them to set "requiredSubCount" for that specific question or branch.
    - **LEAF NODES**: The smallest items (lowest in hierarchy) are the ones that actually require an answer.
    - **FORMULAS**: Extract formulas exactly (e.g., NaCl, H2O).
    
    EXTRACTION RULES:
    - Extract "text", "grade", and "type" (usually "text" for these descriptive questions).
    - Generate unique string IDs for everything.
    - **MANDATORY**: You MUST scan the entire image from top-to-bottom and side-to-side. Do not stop early.
    - **JSON SAFETY**: Escape all double quotes inside strings.
    
    OUTPUT FORMAT (JSON ONLY):
    {
      "title": "Exam Title",
      "requiredQuestionsCount": number (optional),
      "questions": [
        {
          "id": "unique_id",
          "text": "Question text",
          "grade": number,
          "type": "text|true-false|multiple-choice|fill-in-the-blanks",
          "subQuestions": [ 
            {
              "id": "sub_id",
              "text": "Sub-question text",
              "subQuestions": [ ... even deeper points if exist ... ]
            }
          ]
        }
      ]
    }
  `;

  const imageParts = await Promise.all(base64Images.map(async (base64) => {
    // Ensure we have a data URL for compressImage
    const dataUrl = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
    const compressedData = await compressImage(dataUrl);
    return {
      inlineData: {
        data: compressedData,
        mimeType: "image/jpeg",
      },
    };
  }));

  // Define recursive schema for questions - simplified to reduce token overhead
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
    model: "gemini-flash-latest", // Use stable Flash model
    contents: { parts: [...imageParts, { text: prompt }] },
    config: {
      systemInstruction: "You are a professional exam digitizer. Extract ALL questions into a precise JSON structure. Be concise to avoid long responses. Use \\n for newlines.",
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
  
  // Parallelize image compression for speed
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

  // Fallback to Client-side
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("مفتاح API مفقود. يرجى التأكد من إعداد GEMINI_API_KEY في متغيرات البيئة.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Get all valid question IDs to filter out hallucinations
  const validQuestionIds = new Set<string>();
  const collectIds = (qs: Question[]) => {
    qs.forEach(q => {
      validQuestionIds.add(q.id);
      if (q.subQuestions) collectIds(q.subQuestions);
    });
  };
  collectIds(questions);

  // Flatten questions for the AI to make mapping easier and more accurate
  // We only send leaf nodes (the actual questions to be graded)
  const flattenedQuestions: any[] = [];
  const leafQuestionIds = new Set<string>();

  const flatten = (qs: Question[], parentText: string = "", path: string = "") => {
    qs.forEach((q, index) => {
      // Try to extract a clean label (e.g., "س1" or "أ")
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

  // Flash can handle large contexts. 10 images per batch is efficient and fast.
  const BATCH_SIZE = 10; 
  const allResults: any[] = [];

  // Schema for grading results
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
         - The "label" field (e.g., "س2 / A") tells you which question and branch it is.
         - If a student writes "س2" followed by "A", map the answer for "A" to the ID associated with label "س2 / A".
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
          temperature: 0.1, // Near-zero for maximum consistency
          topP: 0.1,
          topK: 1
        },
      }));

      const parsed = robustJsonParse(result.text || '');
      
      if (parsed && parsed.results && Array.isArray(parsed.results)) {
        // Filter out hallucinated question IDs - ONLY allow IDs from the leafQuestionIds set
        const filteredResults = parsed.results.map((student: any) => {
          const gradings = student.gradings || [];
          const uniqueGradings: any[] = [];
          const seenIds = new Set<string>();

          gradings.forEach((g: any) => {
            if (leafQuestionIds.has(g.questionId) && !seenIds.has(g.questionId)) {
              // Map batch-relative pageIndex to global image index
              if (g.pageIndex !== undefined) {
                g.pageIndex = i + g.pageIndex;
              }
              
              // Include maxGrade for visual display
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
      // If we already have some results, we might want to return them instead of failing completely
      if (allResults.length > 0) {
        console.warn("Returning partial results due to error in batch.");
        break; 
      }
      throw new Error(`خطأ في معالجة الصور: ${e.message || 'خطأ غير معروف'}`);
    }
  }

  // Merge results by student name to handle cases where a student's pages are split across batches
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
      
      // Merge gradings
      res.gradings.forEach((newG: any) => {
        const existingIdx = existing.gradings.findIndex((eg: any) => eg.questionId === newG.questionId);
        if (existingIdx > -1) {
          // If duplicate question, keep the one with the higher grade
          if ((newG.grade || 0) > (existing.gradings[existingIdx].grade || 0)) {
            existing.gradings[existingIdx] = newG;
          }
        } else {
          existing.gradings.push(newG);
        }
      });
      
      // Recalculate total grade based on merged gradings
      existing.totalGrade = existing.gradings.reduce((sum: number, g: any) => sum + (g.grade || 0), 0);
    } else {
      mergedMap.set(normName, { ...res, gradings: [...res.gradings] });
    }
  });

  return { results: Array.from(mergedMap.values()) };
}

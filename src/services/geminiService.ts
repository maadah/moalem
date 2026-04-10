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

export async function extractExamFromImages(base64Images: string[], apiKey: string): Promise<{ title: string, questions: Question[], requiredQuestionsCount?: number }> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `
    Analyze the provided images of an exam paper and extract the questions and answers into a structured JSON format.
    
    LANGUAGE RULE:
    - All extracted text MUST be in Arabic if the source is Arabic.
    
    HIERARCHY RULES:
    1. Level 1: Main Questions (e.g., س1، س2).
    2. Level 2: Branches (e.g., A, B or أ، ب).
    3. Level 3: Points (e.g., 1, 2, 3).
    
    CRITICAL EXTRACTION LOGIC:
    - If a Question has Branches, the Question text is just a header (e.g., "Answer the following").
    - If a Branch has Points, the Branch text is just a header.
    - ONLY the leaf nodes should have an "answer" field.
    - For scientific formulas (Chemistry/Physics), extract them exactly as written (e.g., H2SO4, CO2).
    
    EXTRACTION RULES:
    - Extract "text", "grade" (if mentioned), and "type".
    - Detect choice logic (e.g., "Answer 5 questions only") and set "requiredQuestionsCount" or "requiredSubCount".
    - Generate unique IDs.
    - **BE CONCISE**: Do not add unnecessary explanations.
    - **JSON SAFETY**: Ensure all quotes are escaped. Do not include unescaped newlines within strings.
    
    OUTPUT FORMAT (JSON ONLY):
    {
      "title": "Exam Title",
      "requiredQuestionsCount": number (optional),
      "questions": [
        {
          "id": "unique_id",
          "text": "Question text",
          "answer": "Answer text (if found)",
          "grade": number,
          "type": "text|true-false|multiple-choice|fill-in-the-blanks",
          "options": ["opt1", "opt2"],
          "subStyle": "letters|numbers",
          "requiredSubCount": number (optional),
          "subQuestions": [ ... nested sub-questions ... ]
        }
      ]
    }
  `;

  const imageParts = base64Images.map((base64) => ({
    inlineData: {
      data: base64.split(',')[1] || base64,
      mimeType: "image/jpeg",
    },
  }));

  // Define recursive schema for questions
  const questionSchema: any = {
    type: Type.OBJECT,
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
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  grade: { type: Type.NUMBER },
                  type: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } }
                }
              }
            }
          }
        }
      }
    }
  };

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview", // Correct model name for speed and stability
    contents: { parts: [...imageParts, { text: prompt }] },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
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
  });

  const text = response.text || '';
  
  // Robust JSON parsing with cleaning and truncation repair
  try {
    return JSON.parse(text);
  } catch (innerError) {
    let cleaned = text
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // Remove control characters
      .replace(/```json\n?|```/g, "")
      .trim();
    
    // Attempt to repair truncated JSON by closing arrays/objects
    // This is a basic heuristic to close open structures if the string was cut off
    let openBraces = (cleaned.match(/\{/g) || []).length;
    let closeBraces = (cleaned.match(/\}/g) || []).length;
    let openBrackets = (cleaned.match(/\[/g) || []).length;
    let closeBrackets = (cleaned.match(/\]/g) || []).length;

    // If it's cut off inside a string, close the string first
    if (cleaned.split('"').length % 2 === 0) {
      cleaned += '"';
    }

    while (openBrackets > closeBrackets) {
      cleaned += ']';
      closeBrackets++;
    }
    while (openBraces > closeBraces) {
      cleaned += '}';
      closeBraces++;
    }
    
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      console.error("Final JSON parse failed even after repair attempt.", e2);
      // If it still fails, try to find the last valid question and truncate there
      try {
        const lastValidIndex = cleaned.lastIndexOf('},');
        if (lastValidIndex !== -1) {
          const partial = cleaned.substring(0, lastValidIndex) + '}]}';
          return JSON.parse(partial);
        }
      } catch (e3) {}
      throw innerError;
    }
  }
}

async function compressImage(url: string, maxWidth = 1600, maxHeight = 1600, quality = 0.7): Promise<string> {
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

  // 1. Try Backend API first (Secure & Preferred)
  try {
    const response = await fetch('/api/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrls: base64Images, questions, totalExamGrade, requiredQuestionsCount }),
    });

    if (response.ok) {
      return await response.json();
    }
  } catch (e) {}

  // 2. Fallback to Client-side
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
                  feedback: { type: Type.STRING }
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
      You are an expert teacher grading student handwritten exam papers.
      
      EXAM QUESTIONS AND MODEL ANSWERS (Use these IDs exactly):
      ${JSON.stringify(questions, null, 2)}
      
      TOTAL EXAM GRADE: ${totalExamGrade}
      NUMBER OF QUESTIONS IN THIS EXAM: ${questions.length}
      REQUIRED QUESTIONS COUNT: ${requiredQuestionsCount}
      
      INSTRUCTIONS:
      1. Analyze the provided images (Batch ${currentBatchIndex} of ${totalBatches}).
      2. Each student's paper might span one or more images. 
      3. Extract the student's name exactly as written. Do not add suffixes like "Part 1" or "Continuation". If an image is a continuation of the previous student, group them.
      4. **STRICT QUESTION MAPPING**: You MUST ONLY grade the questions listed in the "EXAM QUESTIONS" section above. 
      5. **HIERARCHICAL GRADING**: 
         - If a Question has sub-questions (branches/points), you MUST grade each sub-question individually using its specific "id".
         - Do not give a single grade for a parent question if it has sub-questions; instead, provide a grading result for each leaf node (the deepest level) that the student answered.
      6. If a student writes a question number that doesn't exist (e.g., writes "Q10" when there are only 4 questions), you MUST identify which of the 4 actual questions they are answering based on the content and map it to the correct "id".
      7. **DO NOT CREATE NEW QUESTIONS**: Under no circumstances should you include a "questionId" in the output that is not present in the provided EXAM QUESTIONS list.
      8. **STUDENT ANSWER EXTRACTION**: You MUST extract the FULL text of the student's handwritten answer for each question and put it in the "studentAnswer" field. This must be a VERBATIM transcription of what the student wrote. Do not summarize, shorten, or paraphrase it.
      9. **MATCH IDs**: You MUST use the exact "id" from the EXAM QUESTIONS provided above for each grading result.
      10. **ARABIC FEEDBACK ONLY**: You MUST provide all feedback and student names in Arabic language only.
      11. **CONCISE FEEDBACK**: Provide very short, constructive feedback (max 15 words per question).
      12. Calculate the total grade for the student.
      13. **CRITICAL**: Ensure all strings are properly escaped for JSON. Do not include unescaped newlines or control characters.
    `;

    const imageParts = batch.map((base64) => ({
      inlineData: {
        data: base64,
        mimeType: "image/jpeg",
      },
    }));

    try {
      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview", // Switched to Flash for speed and stability
        contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
        config: {
          systemInstruction: "You are a professional Arabic teacher. All your feedback and communication must be in Arabic.",
          responseMimeType: "application/json",
          responseSchema: gradingSchema
        },
      });

      const text = result.text || '';
      
      // Robust JSON parsing with cleaning and truncation repair
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (innerError) {
        let cleaned = text
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") 
          .replace(/```json\n?|```/g, "")
          .trim();
        
        // Attempt to repair truncated JSON by closing arrays/objects
        if (!cleaned.endsWith('}')) {
          if (cleaned.includes('"results": [')) {
            if (!cleaned.endsWith(']')) cleaned += ' ]';
            cleaned += ' }';
          }
        }
        
        try {
          parsed = JSON.parse(cleaned);
        } catch (e2) {
          console.error("Final JSON parse failed even after repair attempt.");
          throw innerError;
        }
      }
      
      if (parsed.results && Array.isArray(parsed.results)) {
        // Filter out hallucinated question IDs
        const filteredResults = parsed.results.map((student: any) => ({
          ...student,
          gradings: (student.gradings || []).filter((g: any) => validQuestionIds.has(g.questionId))
        })).filter((student: any) => student.gradings.length > 0);
        
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

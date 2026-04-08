import { GoogleGenAI } from "@google/genai";

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
    
    HIERARCHY RULES:
    1. Level 1: Main Questions (e.g., Q1, Q2, S1, S2).
    2. Level 2: Branches (e.g., a, b, c or أ، ب، ج).
    3. Level 3: Points (e.g., 1, 2, 3).
    
    EXTRACTION RULES:
    - If a question has sub-parts (branches), put them in the "subQuestions" array.
    - If a branch has sub-parts (points), put them in the "subQuestions" array of that branch.
    - Extract the "text" for each question/branch/point.
    - If the image contains model answers or student answers, extract them into the "answer" field.
    - If no answers are found, leave the "answer" field empty.
    - Assign a "grade" if mentioned in the image (e.g., "5 marks" or "5 درجات").
    - Identify the "type" (text, true-false, multiple-choice, fill-in-the-blanks).
    - For multiple-choice, extract the "options".
    - Try to extract a logical "title" for the exam from the header.
    - Generate a unique ID for each question/sub-question.
    - **CRITICAL**: Detect choice logic (e.g., "Answer 2 out of 3" or "أجب عن اثنين مما يلي").
      - For main questions, set "requiredQuestionsCount".
      - For sub-questions/branches/points, set "requiredSubCount".
    
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

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: { parts: [...imageParts, { text: prompt }] },
    config: {
      responseMimeType: "application/json",
    }
  });

  const text = response.text || '';
  try {
    // Clean potential markdown wrapping
    const jsonStr = text.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse JSON from AI response:", text);
    throw new Error("فشل في تحليل استجابة الذكاء الاصطناعي.");
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
  onProgress?: (current: number, total: number) => void
): Promise<{ results: { studentName: string; gradings: GradingResult[]; totalGrade: number }[] }> {
  const totalImages = imageUrls.length;
  
  // Convert and compress images
  const base64Images = [];
  for (let i = 0; i < imageUrls.length; i++) {
    if (onProgress) onProgress(i + 1, totalImages);
    try {
      const compressed = await compressImage(imageUrls[i]);
      base64Images.push(compressed);
    } catch (e) {
      console.error(`Error compressing image ${i}:`, e);
    }
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
  
  // If we have many images, we should process them in smaller batches to avoid hitting payload limits
  // and to prevent the browser from hanging.
  const BATCH_SIZE = 3; // Reduced batch size for better reliability
  const allResults: any[] = [];

  for (let i = 0; i < base64Images.length; i += BATCH_SIZE) {
    const batch = base64Images.slice(i, i + BATCH_SIZE);
    
    const prompt = `
      You are an expert teacher grading student handwritten exam papers.
      
      EXAM QUESTIONS AND MODEL ANSWERS:
      ${JSON.stringify(questions, null, 2)}
      
      TOTAL EXAM GRADE: ${totalExamGrade}
      REQUIRED QUESTIONS COUNT: ${requiredQuestionsCount}
      
      INSTRUCTIONS:
      1. Analyze the provided images (Batch ${Math.floor(i/BATCH_SIZE) + 1} of ${Math.ceil(base64Images.length / BATCH_SIZE)}).
      2. Each student's paper might span one or more images. 
      3. Extract the student's name. If an image is a continuation of the previous student, group them.
      4. Grade each question accurately based on the model answers.
      5. Provide constructive feedback for each answer.
      6. Calculate the total grade for the student.
      
      OUTPUT FORMAT (JSON ONLY):
      {
        "results": [
          {
            "studentName": "Name",
            "gradings": [
              { "questionId": "id", "studentAnswer": "text", "grade": number, "feedback": "text" }
            ],
            "totalGrade": number
          }
        ]
      }
    `;

    const imageParts = batch.map((base64) => ({
      inlineData: {
        data: base64,
        mimeType: "image/jpeg",
      },
    }));

    try {
      const result = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview", // Upgraded to Pro for better handwritten text analysis
        contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = result.text || '';
      const jsonStr = text.replace(/```json\n?|```/g, '').trim();
      const parsed = JSON.parse(jsonStr || '{"results":[]}');
      
      if (parsed.results && Array.isArray(parsed.results)) {
        allResults.push(...parsed.results);
      }
    } catch (e: any) {
      console.error(`Error in grading batch ${i}:`, e);
      // If it's a quota error or something similar, we should stop and inform the user
      if (e.message?.includes('429') || e.message?.includes('quota')) {
        throw new Error("تم تجاوز حصة استخدام API (Quota Exceeded). يرجى المحاولة لاحقاً.");
      }
      // For other errors, we might want to continue or throw
      throw new Error(`خطأ في معالجة الصور: ${e.message || 'خطأ غير معروف'}`);
    }
  }

  return { results: allResults };
}

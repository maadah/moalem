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
}

export interface GradingResult {
  questionId: string;
  studentAnswer: string;
  grade: number;
  feedback: string;
}

const getApiKey = () => {
  // 1. Check URL parameters (e.g., ?key=AIza...)
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
  const envKey = import.meta.env.VITE_GEMINI_API_KEY || (typeof process !== 'undefined' ? process.env.VITE_GEMINI_API_KEY : '');
  
  if (envKey && envKey !== 'undefined' && envKey !== 'null' && envKey !== '') {
    return envKey;
  }

  // 3. Check Local Storage
  return localStorage.getItem('GEMINI_API_KEY_AUTO') || '';
};

export async function gradeStudentPaper(
  imageUrls: string[],
  questions: Question[],
  totalExamGrade: number,
  requiredQuestionsCount: number
): Promise<{ results: { studentName: string; gradings: GradingResult[]; totalGrade: number }[] }> {
  // Convert image URLs (blobs) to base64 strings
  const base64Images = await Promise.all(
    imageUrls.map(async (url) => {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
    })
  );

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
    // If 404, it means we are on a static host like Netlify Drop, so fallback to client-side
    if (response.status !== 404) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'فشل التصحيح التلقائي');
    }
  } catch (e: any) {
    if (e.message && !e.message.includes('404')) {
      throw e;
    }
  }

  // 2. Fallback to Client-side (For Static Hosting / Netlify Drop)
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("مفتاح API مفقود. يرجى إضافة ?key=YOUR_KEY في نهاية رابط الموقع لمرة واحدة لتفعيله تلقائياً.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `
    You are an expert teacher grading a student's handwritten exam paper.
    
    EXAM QUESTIONS AND MODEL ANSWERS:
    ${JSON.stringify(questions, null, 2)}
    
    TOTAL EXAM GRADE: ${totalExamGrade}
    REQUIRED QUESTIONS COUNT: ${requiredQuestionsCount}
    
    INSTRUCTIONS:
    1. Analyze the provided images of the student's handwritten paper.
    2. Extract the student's name from the first page. If not found, use "Unknown Student".
    3. For each question (including sub-questions like 1a, 1b, etc.), identify the student's answer.
    4. Compare the student's answer with the model answer.
    5. Assign a grade for each question/sub-question based on accuracy. Be fair but strict as a teacher.
    6. Provide brief feedback for each answer.
    7. Calculate the total grade.
    
    CHOICE LOGIC (IMPORTANT):
    - Some exams allow students to skip questions (e.g., "Answer 5 out of 6").
    - If a student answers MORE than the required number of questions, you MUST ignore the LAST question(s) in the sequence. For example, if 5 are required and 6 are answered, ignore question 6.
    - If a question has sub-questions and the student answers MORE than the "requiredSubCount", you MUST ignore the LAST sub-question(s) in that question.
    - Mark ignored questions/sub-questions with a grade of 0 and state in the feedback: "تم تجاهل هذا السؤال/الفرع لأنه زائد عن العدد المطلوب (قاعدة ترك الأخير)".
    - Calculate the "totalGrade" based only on the required number of questions/sub-questions (excluding the ignored ones).
    
    OUTPUT FORMAT (JSON ONLY):
    {
      "results": [
        {
          "studentName": "Name",
          "gradings": [
            {
              "questionId": "id", // Use the original ID from the questions list, even for sub-questions
              "studentAnswer": "extracted text",
              "grade": number,
              "feedback": "feedback text"
            }
          ],
          "totalGrade": number
        }
      ]
    }
    
    IMPORTANT: If a question has sub-questions, grade each sub-question individually and include them in the "gradings" array using their respective IDs.
  `;

  const imageParts = base64Images.map((base64) => ({
    inlineData: {
      data: base64,
      mimeType: "image/jpeg",
    },
  }));

  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
    config: {
      responseMimeType: "application/json",
    },
  });

  return JSON.parse(result.text || '{}');
}

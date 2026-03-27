import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Route for grading (Secure Backend)
  app.post("/api/grade", async (req, res) => {
    try {
      const { imageUrls, questions, totalExamGrade, requiredQuestionsCount } = req.body;
      const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is missing in server environment" });
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
        3. For each question (including sub-questions like 1a, 1b or 1-1, 1-2, etc.), identify the student's answer.
        - The questions are hierarchical: Level 1 (Main Question), Level 2 (Branch/Point), Level 3 (Point inside Branch).
        - Sub-questions might be lettered (a, b, c) or numbered (1, 2, 3) depending on the "subStyle" property.
        - Identify answers at the lowest level of the hierarchy (leaf nodes).
        - Some questions or answers in the exam structure may include images (provided as base64 data in 'questionImage' or 'answerImage' fields). Use these images to understand the context of the question and the expected answer.
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

      const imageParts = imageUrls.map((base64: string) => ({
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

      res.json(JSON.parse(result.text || '{}'));
    } catch (error: any) {
      console.error("Grading error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

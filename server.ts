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
      const { imageUrls, questions, totalExamGrade } = req.body;
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
        
        INSTRUCTIONS:
        1. Analyze the provided images of the student's handwritten paper.
        2. Extract the student's name from the first page. If not found, use "Unknown Student".
        3. For each question (including sub-questions like 1a, 1b, etc.), identify the student's answer.
        4. Compare the student's answer with the model answer.
        5. Assign a grade for each question/sub-question based on accuracy. Be fair but strict as a teacher.
        6. Provide brief feedback for each answer.
        7. Calculate the total grade.
        
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

#!/usr/bin/env python3

import os
import google.generativeai as genai
from dotenv import load_dotenv

class AIEnhancer:
    def __init__(self):
        load_dotenv()
        self.model = self._initialize_model()
    
    def _initialize_model(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("WARNING: GEMINI_API_KEY not found in .env file. AI features will be disabled.")
            return None
        
        genai.configure(api_key=api_key)
        return genai.GenerativeModel('gemini-2.5-flash')
    
    def enhance_assignment(self, assignment_title, assignment_description="", course_name="", college_name=""):
        if not self.model:
            return ""
        
        try:
            prompt = f"""College: {college_name}
Assignment: {assignment_title}
Description: {assignment_description[:400] if assignment_description else "No description provided"}
Use the assignment description and college name and history of the course to fill in the time, difficulty, and notes be realistic.

FOLLOW THIS EXACT FORMAT - NO OTHER TEXT:
Time: Time it will take to complete the assignment in hours
Difficulty: Easy/Medium/Hard
Notes: study tip or key focus area

Be concise and practical."""
            
            response = self.model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            print(f"WARNING: AI enhancement failed: {e}")
            return ""

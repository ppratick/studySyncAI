#!/usr/bin/env python3

import os
import sqlite3
import subprocess
import requests
import google.generativeai as genai
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv


# Database class
class Database:
    def __init__(self, db_path="studysync.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_database()
    
    def init_database(self):
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                due_at TEXT NOT NULL,
                course_name TEXT NOT NULL,
                reminder_list TEXT NOT NULL,
                ai_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_name TEXT UNIQUE NOT NULL,
                reminder_list TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        try:
            cursor.execute('ALTER TABLE courses ADD COLUMN enabled INTEGER DEFAULT 1')
        except sqlite3.OperationalError as e:
            if 'duplicate column' not in str(e).lower():
                raise
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def get_connection(self):
        return sqlite3.connect(self.db_path)
    
    def save_assignment(self, assignment_id, title, description, due_at, course_name, reminder_list, ai_notes=""):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO assignments 
            (assignment_id, title, description, due_at, course_name, reminder_list, ai_notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ''', (assignment_id, title, description, due_at, course_name, reminder_list, ai_notes))
        
        conn.commit()
        conn.close()
    
    def get_assignment(self, assignment_id):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM assignments WHERE assignment_id = ?', (assignment_id,))
        result = cursor.fetchone()
        
        conn.close()
        return result
    
    def save_course_mapping(self, course_name, reminder_list):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO courses (course_name, reminder_list, enabled)
            VALUES (?, ?, COALESCE((SELECT enabled FROM courses WHERE course_name = ?), 1))
        ''', (course_name, reminder_list, course_name))
        
        conn.commit()
        conn.close()
    
    def get_course_mapping(self, course_name):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT reminder_list FROM courses WHERE course_name = ?', (course_name,))
        result = cursor.fetchone()
        
        conn.close()
        return result[0] if result else None
    
    def delete_course_mapping(self, course_name):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT enabled FROM courses WHERE course_name = ?', (course_name,))
        exists = cursor.fetchone()
        
        if exists:
            cursor.execute('UPDATE courses SET enabled = 0 WHERE course_name = ?', (course_name,))
        else:
            cursor.execute('''
                INSERT INTO courses (course_name, reminder_list, enabled)
                VALUES (?, ?, 0)
            ''', (course_name, course_name))
        
        conn.commit()
        conn.close()
        return True
    
    def enable_course_mapping(self, course_name):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT enabled FROM courses WHERE course_name = ?', (course_name,))
        exists = cursor.fetchone()
        
        if exists:
            cursor.execute('UPDATE courses SET enabled = 1 WHERE course_name = ?', (course_name,))
        else:
            cursor.execute('''
                INSERT INTO courses (course_name, reminder_list, enabled)
                VALUES (?, ?, 1)
            ''', (course_name, course_name))
        
        conn.commit()
        conn.close()
        return True
    
    def get_all_course_mappings(self):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT course_name, reminder_list, enabled FROM courses ORDER BY course_name')
        results = cursor.fetchall()
        
        conn.close()
        return results
    
    def get_course_mapping_with_enabled(self, course_name):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT reminder_list, enabled FROM courses WHERE course_name = ?', (course_name,))
        result = cursor.fetchone()
        
        conn.close()
        return result if result else (None, None)
    
    def save_setting(self, key, value):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT OR REPLACE INTO settings (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        ''', (key, value))
        
        conn.commit()
        conn.close()
    
    def get_setting(self, key):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('SELECT value FROM settings WHERE key = ?', (key,))
        result = cursor.fetchone()
        
        conn.close()
        return result[0] if result else None
    
    def get_all_assignments(self):
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT assignment_id, title, description, due_at, course_name, reminder_list, ai_notes
            FROM assignments
            ORDER BY due_at ASC
        ''')
        
        results = cursor.fetchall()
        conn.close()
        return results


# AI Enhancer class
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
            ai_response = response.text.strip()
            
            if self._validate_ai_response(ai_response):
                return ai_response
            else:
                print(f"  WARNING: AI response format invalid for '{assignment_title[:50]}'. Skipping AI notes.")
                return ""
                
        except Exception as e:
            error_type = self._classify_error(e)
            print(f"  WARNING: AI analysis failed for '{assignment_title[:50]}': {error_type}")
            if "quota" in str(e).lower() or "rate" in str(e).lower():
                print("  Suggestion: Wait a few minutes and try again, or check your API quota.")
            elif "api" in str(e).lower() or "key" in str(e).lower():
                print("  Suggestion: Check your GEMINI_API_KEY in .env file.")
            return ""
    
    def _validate_ai_response(self, response):
        if not response or len(response) < 10:
            return False
        
        required_fields = ["Time:", "Difficulty:", "Notes:"]
        response_lower = response.lower()
        
        for field in required_fields:
            if field.lower() not in response_lower:
                return False
        
        return True
    
    def _classify_error(self, error):
        error_str = str(error).lower()
        if "quota" in error_str or "rate" in error_str:
            return "API rate limit exceeded"
        elif "api" in error_str or "key" in error_str or "auth" in error_str:
            return "API authentication error"
        elif "timeout" in error_str or "network" in error_str:
            return "Network connection error"
        else:
            return "Unknown error"


# Reminders Manager class
class RemindersManager:
    @staticmethod
    def run_applescript(script):
        subprocess.run(["osascript", "-e", script])
    
    @staticmethod
    def add_reminder(title, due_str, list_name, notes=""):
        escaped_notes = notes.replace('"', '\\"')
        script = f'''
        tell application "Reminders"
            try
                set targetList to list "{list_name}"
            on error
                set targetList to make new list with properties {{name:"{list_name}"}}
            end try
            set newReminder to make new reminder in targetList
            set name of newReminder to "{title}"
            set due date of newReminder to date "{due_str}"
            set body of newReminder to "{escaped_notes}"
        end tell
        '''
        RemindersManager.run_applescript(script)
    
    @staticmethod
    def remove_existing_reminder(title, list_name):
        script = f'''
        tell application "Reminders"
            try
                set targetList to list "{list_name}"
                set matchingReminders to every reminder in targetList whose name is "{title}"
                repeat with r in matchingReminders
                    set completed of r to true
                end repeat
            on error
            end try
        end tell
        '''
        RemindersManager.run_applescript(script)
    
    @staticmethod
    def clear_reminder_list(list_name):
        script = f'''
        tell application "Reminders"
            try
                set targetList to list "{list_name}"
                set allReminders to every reminder in targetList
                repeat with r in allReminders
                    delete r
                end repeat
            on error
            end try
        end tell
        '''
        RemindersManager.run_applescript(script)


# Canvas API class
class CanvasAPI:
    def __init__(self, api_token, canvas_domain):
        self.headers = {"Authorization": f"Bearer {api_token}"}
        self.base_url = f"https://{canvas_domain}/api/v1"
    
    def fetch_courses(self):
        print("Fetching favorite courses from Canvas")
        try:
            response = requests.get(f"{self.base_url}/users/self/favorites/courses", headers=self.headers)
            response.raise_for_status()
            courses = response.json()
            print(f"Found {len(courses)} favorite courses")
            print()
            print("-" * 60)
            print()
            return courses
        except requests.exceptions.RequestException as e:
            print(f"ERROR: Failed to fetch favorite courses: {e}")
            exit(1)
    
    def fetch_course_assignments(self, course_id):
        try:
            params = {"include[]": ["submission", "description"], "per_page": 50}
            response = requests.get(f"{self.base_url}/courses/{course_id}/assignments", headers=self.headers, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException:
            return []
    
    def fetch_course_discussions(self, course_id):
        try:
            params = {"per_page": 50}
            response = requests.get(f"{self.base_url}/courses/{course_id}/discussion_topics", headers=self.headers, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException:
            return []
    
    def get_course_items(self, course_id):
        assignments = self.fetch_course_assignments(course_id)
        discussions = self.fetch_course_discussions(course_id)
        return assignments + discussions


# Assignment Processor class
class AssignmentProcessor:
    def __init__(self, db, ai_enhancer, reminders_manager):
        self.db = db
        self.ai_enhancer = ai_enhancer
        self.reminders_manager = reminders_manager
    
    def should_process_assignment(self, item, now):
        title = item.get("name") or item.get("title", "No Title")
        assignment_id = str(item.get("id"))
        
        due_at = item.get("due_at")
        
        if not due_at and "assignment" in item:
            assignment = item.get("assignment", {})
            if "checkpoints" in assignment and assignment["checkpoints"]:
                due_at = assignment["checkpoints"][0].get("due_at")
        
        if not due_at:
            return False, None
        
        if "submission" in item:
            submission = item.get("submission", {})
            if submission.get("submitted_at") is not None:
                return False, None
        
        try:
            due_date_utc = datetime.strptime(due_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            if due_date_utc <= now:
                return False, None
            
            local_due = due_date_utc.astimezone()
            apple_due = local_due.strftime("%A, %B %d, %Y at %I:%M:%S %p")
            display_due = local_due.strftime("%m/%d/%Y")
            
        except Exception:
            return False, None
        
        existing = self.db.get_assignment(assignment_id)
        if existing and existing[4] == due_at:
            return False, None
        
        return True, {
            "title": title,
            "assignment_id": assignment_id,
            "due_at": due_at,
            "apple_due": apple_due,
            "display_due": display_due,
            "description": item.get("description", "")
        }
    
    def process_assignment(self, assignment_data, reminder_list, course_name, college_name):
        if not assignment_data:
            return
        
        title = assignment_data["title"]
        assignment_id = assignment_data["assignment_id"]
        due_at = assignment_data["due_at"]
        apple_due = assignment_data["apple_due"]
        description = assignment_data.get("description", "")
        
        existing = self.db.get_assignment(assignment_id)
        if existing and existing[4] != due_at:
            self.reminders_manager.remove_existing_reminder(title, reminder_list)
        
        ai_notes = ""
        if self.ai_enhancer and self.ai_enhancer.model:
            if existing and len(existing) > 7 and existing[7] and existing[7].strip():
                ai_notes = existing[7]
            else:
                ai_notes = self.ai_enhancer.enhance_assignment(title, description, course_name, college_name)
        
        self.reminders_manager.add_reminder(title, apple_due, reminder_list, ai_notes)
        self.db.save_assignment(assignment_id, title, description, due_at, course_name, reminder_list, ai_notes)
    
    def process_course_assignments(self, reminder_list, items, course_name, college_name, now):
        new_assignments = 0
        new_items = []
        new_assignments_data = []
        
        for item in items:
            should_process, assignment_data = self.should_process_assignment(item, now)
            if should_process:
                new_assignments += 1
                new_items.append((assignment_data["title"], assignment_data["display_due"]))
                
                self.process_assignment(assignment_data, reminder_list, course_name, college_name)
                
                existing = self.db.get_assignment(assignment_data["assignment_id"])
                ai_notes = existing[7] if existing and len(existing) > 7 and existing[7] else None
                
                new_assignments_data.append({
                    'assignment_id': assignment_data["assignment_id"],
                    'title': assignment_data["title"],
                    'description': assignment_data.get("description", ""),
                    'due_at': assignment_data["due_at"],
                    'course_name': course_name,
                    'reminder_list': reminder_list,
                    'ai_notes': ai_notes
                })
        
        return new_assignments, new_items, new_assignments_data


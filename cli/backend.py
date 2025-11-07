#!/usr/bin/env python3

import os
import sqlite3
import subprocess
import requests
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv


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


class AssignmentProcessor:
    def __init__(self, db, reminders_manager):
        self.db = db
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
    
    def process_assignment(self, assignment_data, reminder_list, course_name):
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
        if existing and len(existing) > 7 and existing[7] and existing[7].strip():
            ai_notes = existing[7]
        
        self.reminders_manager.add_reminder(title, apple_due, reminder_list, ai_notes)
        self.db.save_assignment(assignment_id, title, description, due_at, course_name, reminder_list, ai_notes)
    
    def process_course_assignments(self, reminder_list, items, course_name, now):
        new_assignments = 0
        new_items = []
        new_assignments_data = []
        
        for item in items:
            should_process, assignment_data = self.should_process_assignment(item, now)
            if should_process:
                new_assignments += 1
                new_items.append((assignment_data["title"], assignment_data["display_due"]))
                
                self.process_assignment(assignment_data, reminder_list, course_name)
                
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


"""
Backend modules for StudySync AI.
Contains Database, AIEnhancer, RemindersManager, CanvasAPI, and AssignmentProcessor classes.
"""

import re
import html
import json
import sqlite3
import subprocess
import requests
from datetime import datetime
from zoneinfo import ZoneInfo
EST = ZoneInfo("America/New_York")
from pathlib import Path
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed

class Database:
    def __init__(self, db_path="studysync.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_database()

    def init_database(self):
        try:
            if self.db_path.exists() and self.db_path.stat().st_size == 0:
                print(f"Database file is empty at {self.db_path}, recreating...")
                self.db_path.unlink()

            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            existing_tables = [row[0] for row in cursor.fetchall()]

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
                    reminder_added INTEGER DEFAULT 0,
                    status TEXT DEFAULT "Not Started",
                    priority TEXT DEFAULT "Medium",
                    user_notes TEXT DEFAULT "",
                    deleted INTEGER DEFAULT 0,
                    deleted_at TIMESTAMP DEFAULT NULL,
                    time_estimate REAL DEFAULT NULL,
                    suggested_priority TEXT DEFAULT NULL,
                    ai_confidence INTEGER DEFAULT NULL,
                    ai_confidence_explanation TEXT DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS deleted_assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    assignment_id TEXT UNIQUE NOT NULL,
                    title TEXT NOT NULL,
                    course_name TEXT NOT NULL,
                    deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS courses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    course_name TEXT UNIQUE NOT NULL,
                    reminder_list TEXT NOT NULL,
                    enabled INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS ai_insights (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    insights_json TEXT NOT NULL,
                    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_sync_before TIMESTAMP,
                    end_date TEXT
                )
            ''')

            if 'assignments' in existing_tables:
                new_columns = [
                    ('status', 'TEXT DEFAULT "Not Started"'),
                    ('priority', 'TEXT DEFAULT "Medium"'),
                    ('user_notes', 'TEXT DEFAULT ""'),
                    ('deleted', 'INTEGER DEFAULT 0'),
                    ('deleted_at', 'TIMESTAMP DEFAULT NULL'),
                    ('time_estimate', 'REAL DEFAULT NULL'),
                    ('suggested_priority', 'TEXT DEFAULT NULL'),
                    ('ai_confidence', 'INTEGER DEFAULT NULL'),
                    ('ai_confidence_explanation', 'TEXT DEFAULT NULL')
                ]

                for column_name, column_def in new_columns:
                    try:
                        cursor.execute(f'ALTER TABLE assignments ADD COLUMN {column_name} {column_def}')
                    except sqlite3.OperationalError as e:
                        if 'duplicate column' not in str(e).lower():
                            raise

            if 'courses' in existing_tables:
                try:
                    cursor.execute('ALTER TABLE courses ADD COLUMN enabled INTEGER DEFAULT 1')
                except sqlite3.OperationalError as e:
                    if 'duplicate column' not in str(e).lower():
                        raise

            conn.commit()
            conn.close()
        except (sqlite3.Error, OSError) as e:
            print(f"Database error detected: {e}. Recreating database...")

            try:
                if 'conn' in locals():
                    conn.close()
            except Exception:
                pass

            if self.db_path.exists():
                self.db_path.unlink()

            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute('''
                CREATE TABLE assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    assignment_id TEXT UNIQUE NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    due_at TEXT NOT NULL,
                    course_name TEXT NOT NULL,
                    reminder_list TEXT NOT NULL,
                    ai_notes TEXT,
                    reminder_added INTEGER DEFAULT 0,
                    status TEXT DEFAULT "Not Started",
                    priority TEXT DEFAULT "Medium",
                    user_notes TEXT DEFAULT "",
                    deleted INTEGER DEFAULT 0,
                    deleted_at TIMESTAMP DEFAULT NULL,
                    time_estimate REAL DEFAULT NULL,
                    suggested_priority TEXT DEFAULT NULL,
                    ai_confidence INTEGER DEFAULT NULL,
                    ai_confidence_explanation TEXT DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE deleted_assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    assignment_id TEXT UNIQUE NOT NULL,
                    title TEXT NOT NULL,
                    course_name TEXT NOT NULL,
                    deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE courses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    course_name TEXT UNIQUE NOT NULL,
                    reminder_list TEXT NOT NULL,
                    enabled INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')

            cursor.execute('''
                CREATE TABLE ai_insights (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    insights_json TEXT NOT NULL,
                    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_sync_before TIMESTAMP,
                    end_date TEXT
                )
            ''')

            conn.commit()
            conn.close()

    def get_connection(self):
        if not self.db_path.exists():
            print("Database file missing, reinitializing...")
            self.init_database()
        
        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.execute("SELECT 1").fetchone()
            return conn
        except (sqlite3.Error, OSError) as e:
            print(f"Database connection error: {e}. Reinitializing...")
            try:
                if self.db_path.exists():
                    self.db_path.unlink()
            except Exception:
                pass
            self.init_database()
            return sqlite3.connect(str(self.db_path))

    def save_assignment(self, assignment_id, title, description, due_at, course_name, reminder_list, ai_notes=""):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('SELECT assignment_id FROM deleted_assignments WHERE assignment_id = ?', (assignment_id,))
        if cursor.fetchone():
            conn.close()
            return

        cursor.execute('''
            INSERT OR REPLACE INTO assignments
            (assignment_id, title, description, due_at, course_name, reminder_list, ai_notes, reminder_added,
             status, priority, user_notes, deleted, time_estimate, suggested_priority, ai_confidence, ai_confidence_explanation, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?,
                    COALESCE((SELECT reminder_added FROM assignments WHERE assignment_id = ?), 0),
                    COALESCE((SELECT status FROM assignments WHERE assignment_id = ?), 'Not Started'),
                    COALESCE((SELECT priority FROM assignments WHERE assignment_id = ?), 'Medium'),
                    COALESCE((SELECT user_notes FROM assignments WHERE assignment_id = ?), ''),
                    COALESCE((SELECT deleted FROM assignments WHERE assignment_id = ?), 0),
                    COALESCE((SELECT time_estimate FROM assignments WHERE assignment_id = ?), NULL),
                    COALESCE((SELECT suggested_priority FROM assignments WHERE assignment_id = ?), NULL),
                    COALESCE((SELECT ai_confidence FROM assignments WHERE assignment_id = ?), NULL),
                    COALESCE((SELECT ai_confidence_explanation FROM assignments WHERE assignment_id = ?), NULL),
                    CURRENT_TIMESTAMP)
        ''', (assignment_id, title, description, due_at, course_name, reminder_list, ai_notes,
              assignment_id, assignment_id, assignment_id, assignment_id, assignment_id, assignment_id, assignment_id, assignment_id, assignment_id))

        conn.commit()
        conn.close()

    def update_assignment_fields(self, assignment_id, **fields):
        if not fields:
            return

        conn = self.get_connection()
        cursor = conn.cursor()

        set_clause = ', '.join([f'{k} = ?' for k in fields.keys()])
        values = list(fields.values()) + [assignment_id]

        cursor.execute(f'''
            UPDATE assignments
            SET {set_clause}, updated_at = CURRENT_TIMESTAMP
            WHERE assignment_id = ?
        ''', values)

        conn.commit()
        conn.close()

    def mark_reminder_added(self, assignment_id):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            UPDATE assignments
            SET reminder_added = 1
            WHERE assignment_id = ?
        ''', (assignment_id,))

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

    def get_course_mapping_with_enabled(self, course_name):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('SELECT reminder_list, enabled FROM courses WHERE course_name = ?', (course_name,))
        result = cursor.fetchone()

        conn.close()
        return result if result else (None, None)

    def get_all_courses_from_db(self):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('SELECT course_name, reminder_list, enabled FROM courses WHERE enabled = 1')
        results = cursor.fetchall()

        conn.close()
        return [{'name': row[0], 'reminder_list': row[1] or '', 'enabled': row[2]} for row in results]

    def permanently_delete_course(self, course_name):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('DELETE FROM courses WHERE course_name = ?', (course_name,))

        conn.commit()
        conn.close()
        return True

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

    def save_ai_insights(self, insights_json, last_sync_before, end_date):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('DELETE FROM ai_insights')

        est_timestamp = datetime.now(EST).isoformat()

        cursor.execute('''
            INSERT INTO ai_insights (insights_json, generated_at, last_sync_before, end_date)
            VALUES (?, ?, ?, ?)
        ''', (insights_json, est_timestamp, last_sync_before, end_date))

        conn.commit()
        conn.close()

    def get_ai_insights(self):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT insights_json, generated_at, last_sync_before, end_date
            FROM ai_insights
            ORDER BY generated_at DESC
            LIMIT 1
        ''')
        result = cursor.fetchone()

        conn.close()
        if result:
            return {
                'insights_json': result[0],
                'generated_at': result[1],
                'last_sync_before': result[2],
                'end_date': result[3] if len(result) > 3 else None
            }
        return None

    def get_last_sync_timestamp(self):
        return self.get_setting('last_sync_timestamp')

    def set_last_sync_timestamp(self, timestamp):
        self.save_setting('last_sync_timestamp', timestamp)

    def get_all_assignments(self, include_deleted=False):
        conn = self.get_connection()
        cursor = conn.cursor()

        query = '''
            SELECT assignment_id, title, description, due_at, course_name, reminder_list, ai_notes, reminder_added,
                   status, priority, user_notes, deleted, time_estimate, suggested_priority, ai_confidence, ai_confidence_explanation
            FROM assignments
        '''

        if not include_deleted:
            query += ' WHERE deleted = 0'

        query += ' ORDER BY due_at ASC'

        cursor.execute(query)
        results = cursor.fetchall()
        conn.close()
        return results

    def delete_assignment(self, assignment_id):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('SELECT title, course_name FROM assignments WHERE assignment_id = ?', (assignment_id,))
        assignment = cursor.fetchone()

        if assignment:
            cursor.execute('UPDATE assignments SET deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE assignment_id = ?', (assignment_id,))

            cursor.execute('''
                INSERT OR REPLACE INTO deleted_assignments (assignment_id, title, course_name, deleted_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ''', (assignment_id, assignment[0], assignment[1]))

        conn.commit()
        conn.close()

    def is_assignment_permanently_deleted(self, assignment_id):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('SELECT assignment_id FROM deleted_assignments WHERE assignment_id = ?', (assignment_id,))
        result = cursor.fetchone()

        conn.close()
        return result is not None

    def get_deleted_assignments(self):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT assignment_id, title, course_name, deleted_at
            FROM deleted_assignments
            ORDER BY deleted_at DESC
        ''')

        results = cursor.fetchall()
        conn.close()
        return results

    def restore_assignment(self, assignment_id):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('DELETE FROM deleted_assignments WHERE assignment_id = ?', (assignment_id,))

        cursor.execute('UPDATE assignments SET deleted = 0, deleted_at = NULL WHERE assignment_id = ?', (assignment_id,))

        conn.commit()
        conn.close()

    def permanently_delete_assignment(self, assignment_id):
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('SELECT title, course_name FROM assignments WHERE assignment_id = ?', (assignment_id,))
        assignment = cursor.fetchone()

        cursor.execute('DELETE FROM assignments WHERE assignment_id = ?', (assignment_id,))

        if assignment:
            cursor.execute('''
                INSERT OR REPLACE INTO deleted_assignments (assignment_id, title, course_name, deleted_at)
                VALUES (?, ?, ?, COALESCE((SELECT deleted_at FROM deleted_assignments WHERE assignment_id = ?), CURRENT_TIMESTAMP))
            ''', (assignment_id, assignment[0], assignment[1], assignment_id))
        else:
            cursor.execute('SELECT assignment_id FROM deleted_assignments WHERE assignment_id = ?', (assignment_id,))
            if not cursor.fetchone():
                cursor.execute('''
                    INSERT INTO deleted_assignments (assignment_id, title, course_name, deleted_at)
                    VALUES (?, 'Unknown', 'Unknown', CURRENT_TIMESTAMP)
                ''', (assignment_id,))

        conn.commit()
        conn.close()

class AIEnhancer:
    def __init__(self, ollama_model):
        load_dotenv()
        if not ollama_model:
            raise ValueError("ollama_model is required")
        self.ollama_model = ollama_model
        self.ollama_url = "http://localhost:11434/api/generate"
        self.model = self._initialize_model()
        self.prompts_dir = Path(__file__).parent / "aiPrompts"
        self.assignment_prompt_template = self._load_prompt("assignment_enhancement.txt")
        self.insights_prompt_template = self._load_prompt("comprehensive_insights.txt")

    def _load_prompt(self, filename):
        prompt_path = self.prompts_dir / filename
        with open(prompt_path, 'r', encoding='utf-8') as f:
            return f.read()

    def _initialize_model(self):
        try:
            response = requests.get("http://localhost:11434/api/tags", timeout=2)
            if response.status_code == 200:
                return "ollama"
            else:
                print("WARNING: Ollama service not responding. AI features will be disabled.")
                return None
        except Exception as e:
            print(f"WARNING: Ollama not available ({e}). AI features will be disabled.")
            return None

    def enhance_assignment(self, assignment_title, assignment_description="", course_name="", college_name=""):
        if not self.model:
            return "", None, None, None, None

        try:
            if assignment_description:
                clean_description = re.sub(r'<[^>]+>', '', assignment_description)
                clean_description = html.unescape(clean_description)
                clean_description = ' '.join(clean_description.split())
            else:
                clean_description = "No description provided"

            prompt = self.assignment_prompt_template.format(
                college_name=college_name,
                assignment_title=assignment_title,
                clean_description=clean_description
            )

            if self.model == "ollama":
                ai_response = self._call_ollama(prompt)
            else:
                print("  WARNING: Ollama not available. Skipping AI analysis.")
                return "", None, None, None, None

            if self._validate_ai_response(ai_response):
                time_estimate = None
                suggested_priority = None
                ai_confidence = None
                ai_confidence_explanation = None

                normalized_lines = []
                lines = ai_response.split('\n')
                for line in lines:
                    if line.startswith('Time:'):
                        try:
                            time_str = line.split(':', 1)[1].strip().split()[0]
                            time_estimate = float(time_str)

                            normalized_lines.append(f"Time: {int(time_estimate) if time_estimate.is_integer() else time_estimate} hours")
                        except (ValueError, IndexError):
                            normalized_lines.append(line)
                    elif line.startswith('Priority:'):
                        priority_str = line.split(':', 1)[1].strip()
                        if priority_str in ['High', 'Medium', 'Low']:
                            suggested_priority = priority_str
                            normalized_lines.append(line)
                        else:
                            normalized_lines.append(line)
                    elif line.startswith('Confidence:'):
                        try:
                            confidence_str = line.split(':', 1)[1].strip().split()[0]
                            confidence_val = int(confidence_str)

                            ai_confidence = max(1, min(5, confidence_val))
                        except (ValueError, IndexError):
                            pass
                    elif line.startswith('ConfidenceReason:'):
                        ai_confidence_explanation = line.split(':', 1)[1].strip()

                    else:
                        normalized_lines.append(line)

                normalized_response = '\n'.join(normalized_lines)
                return normalized_response, time_estimate, suggested_priority, ai_confidence, ai_confidence_explanation
            else:
                print(f"  WARNING: AI response format invalid for '{assignment_title[:50]}'. Skipping AI notes.")
                return "", None, None, None, None

        except Exception as e:
            error_type = self._classify_error(e)
            print(f"  WARNING: AI analysis failed for '{assignment_title[:50]}': {error_type}")
            if "timeout" in str(e).lower():
                print("  Suggestion: Try a smaller/faster model, or increase timeout.")
            elif "ollama" in str(e).lower():
                print("  Suggestion: Make sure Ollama is running (ollama serve).")
            return "", None, None, None, None

    def _validate_ai_response(self, response):
        if not response or len(response) < 10:
            return False

        required_fields = ["Time:", "Priority:", "Difficulty:", "Notes:"]
        response_lower = response.lower()

        for field in required_fields:
            if field.lower() not in response_lower:
                return False

        return True

    def _call_ollama(self, prompt):
        try:
            timeout = 120

            payload = {
                "model": self.ollama_model,
                "prompt": prompt,
                "stream": False
            }
            response = requests.post(self.ollama_url, json=payload, timeout=timeout)
            response.raise_for_status()
            result = response.json()
            return result.get("response", "").strip()
        except requests.exceptions.Timeout as e:
            raise Exception(f"Ollama API timeout after {timeout}s - model may be too slow.")
        except requests.exceptions.RequestException as e:
            raise Exception(f"Ollama API error: {str(e)}")

    def _classify_error(self, error):
        error_str = str(error).lower()
        if "timeout" in error_str:
            return "Request timeout - model may be too slow"
        elif "network" in error_str or "connection" in error_str:
            return "Network connection error"
        elif "ollama" in error_str:
            return "Ollama connection error"
        else:
            return "Unknown error"

    def generate_comprehensive_insights(self, assignments_data, college_name, end_date):
        if not self.model:
            return None

        try:
            today = datetime.now(EST).strftime("%m-%d-%Y")

            try:
                end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
                end_date_formatted = end_date_obj.strftime("%m-%d-%Y")
            except (ValueError, TypeError):
                end_date_formatted = end_date

            assignments_summary = []
            for assignment in assignments_data:
                due_date = assignment.get('due_at', '')
                try:
                    due_date_obj = datetime.strptime(due_date, "%Y-%m-%dT%H:%M:%SZ")
                    due_date_formatted = due_date_obj.strftime("%m-%d-%Y")
                except (ValueError, TypeError):
                    due_date_formatted = due_date

                assignments_summary.append({
                    'title': assignment.get('title', ''),
                    'course': assignment.get('course_name', ''),
                    'due_date': due_date_formatted,
                    'time_estimate': assignment.get('time_estimate'),
                    'priority': assignment.get('priority', 'Medium'),
                    'status': assignment.get('status', 'Not Started'),
                    'ai_notes': assignment.get('ai_notes', ''),
                    'description': assignment.get('description', '')[:200]
                })

            assignments_json = json.dumps(assignments_summary, indent=2)
            
            prompt = self.insights_prompt_template.format(
                college_name=college_name,
                today=today,
                end_date_formatted=end_date_formatted,
                assignments_json=assignments_json
            )

            if self.model == "ollama":
                ai_response = self._call_ollama(prompt)
            else:
                print("  WARNING: Ollama not available. Skipping comprehensive insights.")
                return None

            json_match = re.search(r'\{.*\}', ai_response, re.DOTALL)
            json_str = json_match.group() if json_match else ai_response
            
            json_str = json_str.strip()
            
            def clean_json_string(s):
                result = []
                in_string = False
                escape_count = 0
                i = 0
                while i < len(s):
                    char = s[i]
                    if char == '\\':
                        escape_count += 1
                        result.append(char)
                    elif char == '"':
                        if escape_count % 2 == 0:
                            in_string = not in_string
                        result.append(char)
                        escape_count = 0
                    elif in_string and ord(char) < 32:
                        if char == '\n':
                            result.append('\\n')
                        elif char == '\r':
                            result.append('\\r')
                        elif char == '\t':
                            result.append('\\t')
                        else:
                            pass
                        escape_count = 0
                    else:
                        result.append(char)
                        escape_count = 0
                    i += 1
                return ''.join(result)
            
            json_str = clean_json_string(json_str)
            
            try:
                insights = json.loads(json_str)
                return insights
            except json.JSONDecodeError as e:
                print(f"JSON decode error: {e}")
                print(f"JSON string (first 500 chars): {json_str[:500]}")
                return None

        except Exception as e:
            print(f"Error generating comprehensive insights: {e}")
            return None

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
        with ThreadPoolExecutor(max_workers=2) as executor:
            assignments_future = executor.submit(self.fetch_course_assignments, course_id)
            discussions_future = executor.submit(self.fetch_course_discussions, course_id)

            assignments = assignments_future.result()
            discussions = discussions_future.result()

        return assignments + discussions

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
            due_date_utc = datetime.strptime(due_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=ZoneInfo("UTC"))
            if due_date_utc <= now:
                return False, None

            local_due = due_date_utc.astimezone(EST)
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

    def process_assignment(self, assignment_data, reminder_list, course_name, college_name, ai_summary_enabled=True):
        if not assignment_data:
            return

        title = assignment_data["title"]
        assignment_id = assignment_data["assignment_id"]
        due_at = assignment_data["due_at"]
        description = assignment_data.get("description", "")

        existing = self.db.get_assignment(assignment_id)

        ai_notes = ""
        time_estimate = None
        suggested_priority = None
        ai_confidence = None
        ai_confidence_explanation = None

        if self.ai_enhancer and self.ai_enhancer.model and ai_summary_enabled:
            if existing and len(existing) > 7 and existing[7] and existing[7].strip():
                ai_notes = existing[7]

                if existing and len(existing) > 16:
                    time_estimate = existing[16] if existing[16] else None
                    suggested_priority = existing[17] if len(existing) > 17 and existing[17] else None
                    ai_confidence = existing[18] if len(existing) > 18 and existing[18] else None
                    ai_confidence_explanation = existing[19] if len(existing) > 19 and existing[19] else None
            else:
                ai_notes, time_estimate, suggested_priority, ai_confidence, ai_confidence_explanation = self.ai_enhancer.enhance_assignment(title, description, course_name, college_name)

        self.db.save_assignment(assignment_id, title, description, due_at, course_name, reminder_list, ai_notes)

        if time_estimate is not None or suggested_priority is not None or ai_confidence is not None or ai_confidence_explanation is not None:
            update_fields = {}
            if time_estimate is not None:
                update_fields['time_estimate'] = time_estimate
            if suggested_priority is not None:
                update_fields['suggested_priority'] = suggested_priority
            if ai_confidence is not None:
                update_fields['ai_confidence'] = ai_confidence
            if ai_confidence_explanation is not None:
                update_fields['ai_confidence_explanation'] = ai_confidence_explanation
            if update_fields:
                self.db.update_assignment_fields(assignment_id, **update_fields)

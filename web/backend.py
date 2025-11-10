import os
import re
import html
import json
import sqlite3
import subprocess
import requests
import google.generativeai as genai
from datetime import datetime
from zoneinfo import ZoneInfo
EST = ZoneInfo("America/New_York")
from pathlib import Path
from dotenv import load_dotenv

class Database:
    def __init__(self, db_path="studysync.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_database()

    def init_database(self):
        try:
            if not self.db_path.exists():
                print(f"Database file not found at {self.db_path}, creating new database...")
            elif self.db_path.stat().st_size == 0:
                print(f"Database file is empty at {self.db_path}, recreating...")
                self.db_path.unlink()

            conn = sqlite3.connect(str(self.db_path))
            cursor = conn.cursor()

            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            cursor.fetchall()
        except (sqlite3.Error, OSError) as e:
            print(f"Database error detected: {e}. Recreating database...")

            try:
                conn.close()
            except Exception:
                pass

            if self.db_path.exists():
                self.db_path.unlink()

            conn = sqlite3.connect(str(self.db_path))
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
                reminder_added INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        new_columns = [
            ('reminder_added', 'INTEGER DEFAULT 0'),
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

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS deleted_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assignment_id TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                course_name TEXT NOT NULL,
                deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        for column_name, column_def in new_columns:
            try:
                cursor.execute(f'ALTER TABLE assignments ADD COLUMN {column_name} {column_def}')
            except sqlite3.OperationalError as e:
                if 'duplicate column' not in str(e).lower():
                    raise

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

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS ai_insights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                insights_json TEXT NOT NULL,
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_sync_before TIMESTAMP,
                end_date TEXT
            )
        ''')

        try:
            cursor.execute('ALTER TABLE ai_insights ADD COLUMN end_date TEXT')
        except sqlite3.OperationalError as e:
            if 'duplicate column' not in str(e).lower():
                raise

        conn.commit()
        conn.close()

    def get_connection(self):
        try:
            if not self.db_path.exists():
                print("Database file missing, reinitializing...")
                self.init_database()
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

    def update_assignment_field(self, assignment_id, field, value):
        """Update a specific field of an assignment"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute(f'''
            UPDATE assignments
            SET {field} = ?, updated_at = CURRENT_TIMESTAMP
            WHERE assignment_id = ?
        ''', (value, assignment_id))

        conn.commit()
        conn.close()

    def update_assignment_fields(self, assignment_id, **fields):
        """Update multiple fields of an assignment at once"""
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
        """Save AI insights to cache"""
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
        """Get cached AI insights"""
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
        """Get timestamp of last sync (stored in settings)"""
        return self.get_setting('last_sync_timestamp')

    def set_last_sync_timestamp(self, timestamp):
        """Set timestamp of last sync"""
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
        """Mark assignment as deleted and add to deleted_assignments table"""
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

    def get_deleted_assignments(self):
        """Get all deleted assignments"""
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
        """Remove from deleted_assignments and mark as not deleted"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('DELETE FROM deleted_assignments WHERE assignment_id = ?', (assignment_id,))

        cursor.execute('UPDATE assignments SET deleted = 0, deleted_at = NULL WHERE assignment_id = ?', (assignment_id,))

        conn.commit()
        conn.close()

    def permanently_delete_assignment(self, assignment_id):
        """Permanently delete assignment from both tables"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('DELETE FROM deleted_assignments WHERE assignment_id = ?', (assignment_id,))
        cursor.execute('DELETE FROM assignments WHERE assignment_id = ?', (assignment_id,))

        conn.commit()
        conn.close()

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
            return "", None, None, None, None

        try:
            if assignment_description:
                clean_description = re.sub(r'<[^>]+>', '', assignment_description)
                clean_description = html.unescape(clean_description)
                clean_description = ' '.join(clean_description.split())
            else:
                clean_description = "No description provided"

            prompt = f"""You are an AI academic assistant helping a university student estimate workload and focus areas for assignments.

INPUTS:

College: {college_name}

Assignment: {assignment_title}

Description: {clean_description}

TASK:

Estimate realistic workload metrics for this assignment. Assume the student is full-time, balancing 4-5 courses. Be *conservative but practical* in your time estimates and avoid over-optimism.

GUIDELINES:

- Homework or short reflections → 1-3 hours

- Medium assignments → 3-8 hours

- Large projects or papers → 10-30 hours

- Capstone / Final projects → 30-60 hours

Difficulty scale:

- Easy = routine tasks, low uncertainty

- Medium = moderate research, coding, or writing load

- Hard = complex, creative, or multi-step project

Confidence should reflect:

1. How specific the description is

2. How typical the workload is for this course type

3. How clearly the requirements are stated

OUTPUT:

Return *only* the following fields in plain text — no extra commentary or punctuation.

Time: <number only, integer hours>

Priority: High / Medium / Low

Difficulty: Easy / Medium / Hard

Notes: <1 short actionable tip, ≤15 words>

Confidence: <1-5>

ConfidenceReason: <1 concise sentence explaining uncertainty or confidence>"""

            response = self.model.generate_content(prompt)
            ai_response = response.text.strip()

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
            if "quota" in str(e).lower() or "rate" in str(e).lower():
                print("  Suggestion: Wait a few minutes and try again, or check your API quota.")
            elif "api" in str(e).lower() or "key" in str(e).lower():
                print("  Suggestion: Check your GEMINI_API_KEY in .env file.")
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

    def generate_comprehensive_insights(self, assignments_data, college_name, end_date):
        """Generate comprehensive AI insights from all assignments"""
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

            prompt = f"""You are an AI study assistant evaluating a student's total assignment workload.

INPUT:

College: {college_name}

Today's Date: {today}

Target End Date: {end_date_formatted}

Assignments: {json.dumps(assignments_summary, indent=2)}

TASK:

Analyze the workload between today and the target end date.

Estimate total hours remaining, identify busiest upcoming periods, and determine which assignments require the most immediate attention.

Generate actionable insights and a concise summary report that a college student can read and immediately act upon.

INSTRUCTIONS:

- Use today's date and assignment due dates to assess urgency and prioritize tasks.

- Consider each assignment's difficulty level and time estimates when making recommendations.

- Assume ~10-12 study hours per day is the sustainable maximum for a full-time student.

- Be direct, practical, and encouraging — write like an experienced academic coach providing personalized guidance.

- All dates must be written in MM-DD-YYYY format.

- Focus on actionable advice that helps the student manage their time effectively and avoid burnout.

OUTPUT:

Return a JSON object with the following structure:

{{
    "summary_report": "A concise paragraph-style report (2-4 sentences) that summarizes the key insights and actionable advice for the student",
    "summary_confidence": <1-5>,
    "summary_confidence_explanation": "Brief explanation of confidence level",
    "workload_analysis": {{
        "overall_assessment": "Brief assessment of workload (e.g., 'Manageable', 'Heavy', 'Critical overload')",
        "busy_periods": ["List of dates/periods with high assignment density in MM-DD-YYYY format"],
        "total_hours_estimated": <total hours>,
        "course_difficulty_comparison": {{"course_name": "difficulty level"}},
        "risk_assessment": "Brief assessment of at-risk assignments or periods"
    }},
    "workload_confidence": <1-5>,
    "workload_confidence_explanation": "Brief explanation of confidence level",
    "priority_recommendations": [
        {{
            "assignment_title": "title",
            "reason": "Why this should be prioritized",
            "suggested_start_date": "date in MM-DD-YYYY format",
            "urgency_level": "High/Medium/Low"
        }}
    ],
    "priority_confidence": <1-5>,
    "priority_confidence_explanation": "Brief explanation of confidence level",
    "conflict_detection": {{
        "overlapping_deadlines": ["List of dates with multiple assignments due in MM-DD-YYYY format"],
        "scheduling_conflicts": "Any identified conflicts",
        "early_start_recommendations": ["Assignments that should be started early"]
    }},
    "conflict_confidence": <1-5>,
    "conflict_confidence_explanation": "Brief explanation of confidence level"
}}

Confidence ratings (1-5) should reflect:
- How complete and accurate the assignment data is
- How clear the patterns and trends are
- How certain the recommendations are based on the available information
- Lower confidence (1-2) if data is limited or patterns are unclear
- Higher confidence (4-5) if data is comprehensive and patterns are clear

Return ONLY valid JSON, no other text."""

            response = self.model.generate_content(prompt)
            ai_response = response.text.strip()

            json_match = re.search(r'\{.*\}', ai_response, re.DOTALL)
            if json_match:
                insights = json.loads(json_match.group())
                return insights
            else:
                insights = json.loads(ai_response)
                return insights

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
        assignments = self.fetch_course_assignments(course_id)
        discussions = self.fetch_course_discussions(course_id)
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

                if existing and len(existing) > 13:
                    time_estimate = existing[13] if existing[13] else None
                    suggested_priority = existing[14] if len(existing) > 14 and existing[14] else None
                    ai_confidence = existing[15] if len(existing) > 15 and existing[15] else None
                    ai_confidence_explanation = existing[16] if len(existing) > 16 and existing[16] else None
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

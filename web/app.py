#!/usr/bin/env python3

import os
import json
import requests
import sqlite3
from datetime import datetime, timezone
from flask import Flask, render_template, jsonify, request, send_from_directory, Response, stream_with_context
from dotenv import load_dotenv
from pathlib import Path
from backend import Database, AIEnhancer, RemindersManager, CanvasAPI, AssignmentProcessor

load_dotenv()

app = Flask(__name__, template_folder='.', static_folder='.')

db_path = str(Path(__file__).parent / "studysync-web.db")
db = Database(db_path=db_path)
# Ensure database is initialized - force re-initialization to ensure all tables exist
try:
    db.init_database()
    # Verify tables exist by trying to query settings table
    test_conn = sqlite3.connect(db_path)
    test_cursor = test_conn.cursor()
    test_cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
    if not test_cursor.fetchone():
        print("WARNING: Settings table not found, re-initializing database...")
        db.init_database()
    test_conn.close()
except Exception as e:
    print(f"Error initializing database: {e}")
    import traceback
    traceback.print_exc()
ai_enhancer = None
reminders_manager = RemindersManager()
canvas_api = None
processor = None

def initialize_components():
    global ai_enhancer, canvas_api, processor
    
    api_token = os.getenv("CANVAS_API_TOKEN")
    canvas_domain = os.getenv("CANVAS_DOMAIN")
    
    if not api_token or not canvas_domain:
        return False
    
    canvas_api = CanvasAPI(api_token, canvas_domain)
    ai_enhancer = AIEnhancer()
    processor = AssignmentProcessor(db, ai_enhancer, reminders_manager)
    return True

def get_due_date(item):
    due_at = item.get("due_at")
    if not due_at and "assignment" in item:
        assignment = item.get("assignment", {})
        if "checkpoints" in assignment and assignment["checkpoints"]:
            due_at = assignment["checkpoints"][0].get("due_at")
    return due_at or ""

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/style.css')
def style_css():
    return send_from_directory('.', 'style.css', mimetype='text/css')

@app.route('/app.js')
def app_js():
    return send_from_directory('.', 'app.js', mimetype='application/javascript')

@app.route('/api/assignments')
def get_assignments():
    try:
        assignments = db.get_all_assignments()
        result = []
        for assignment in assignments:
            # SQL query returns: assignment_id, title, description, due_at, course_name, reminder_list, ai_notes, reminder_added
            result.append({
                'assignment_id': assignment[0],
                'title': assignment[1],
                'description': assignment[2],
                'due_at': assignment[3],
                'course_name': assignment[4],
                'reminder_list': assignment[5],
                'ai_notes': assignment[6] if len(assignment) > 6 else None,
                'reminder_added': assignment[7] if len(assignment) > 7 else 0
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/courses')
def get_courses():
    try:
        api_token = os.getenv("CANVAS_API_TOKEN")
        canvas_domain = os.getenv("CANVAS_DOMAIN")
        if not api_token or not canvas_domain:
            return jsonify({'error': 'Canvas API not configured'}), 500
        
        headers = {"Authorization": f"Bearer {api_token}"}
        base_url = f"https://{canvas_domain}/api/v1"
        
        response = requests.get(f"{base_url}/users/self/favorites/courses", headers=headers)
        response.raise_for_status()
        courses = response.json()
        
        result = []
        for course in courses:
            course_name = course.get("name", "Unnamed Course")
            reminder_list, enabled = db.get_course_mapping_with_enabled(course_name)
            # Don't set default reminder list - user must set it explicitly
            if reminder_list is None:
                reminder_list = ''  # Empty string, not course name
                enabled = None
            result.append({
                'id': course.get('id'),
                'name': course_name,
                'reminder_list': reminder_list or '',  # Return empty string if None
                'enabled': enabled if enabled is not None else True
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sync', methods=['GET'])
def sync_assignments():
    def generate():
        try:
            if not initialize_components():
                yield f"data: {json.dumps({'error': 'Canvas API not configured'})}\n\n"
                return
            
            college_name = db.get_setting("college_name")
            if not college_name:
                yield f"data: {json.dumps({'error': 'College name not set. Please set it in Settings before syncing.'})}\n\n"
                return
            
            # Check if auto-sync reminders is enabled
            auto_sync_reminders = db.get_setting("auto_sync_reminders") or '0'
            auto_sync_enabled = auto_sync_reminders == '1'
            
            yield f"data: {json.dumps({'type': 'progress', 'message': 'Fetching courses...', 'progress': 5})}\n\n"
            
            now = datetime.now(timezone.utc)
            
            api_token = os.getenv("CANVAS_API_TOKEN")
            canvas_domain = os.getenv("CANVAS_DOMAIN")
            headers = {"Authorization": f"Bearer {api_token}"}
            base_url = f"https://{canvas_domain}/api/v1"
            
            response = requests.get(f"{base_url}/users/self/favorites/courses", headers=headers)
            response.raise_for_status()
            favorite_courses = response.json()
            
            total_added = 0
            added_by_course = {}
            new_assignments_list = []
            total_courses = len(favorite_courses)
            processed_courses = 0
            
            yield f"data: {json.dumps({'type': 'progress', 'message': f'Processing {total_courses} courses...', 'progress': 10})}\n\n"
            
            for course in favorite_courses:
                course_id = course.get("id")
                course_name = course.get("name", "Unnamed Course")
                
                if not course_id:
                    processed_courses += 1
                    continue
                
                reminder_list, enabled = db.get_course_mapping_with_enabled(course_name)
                if enabled == 0:
                    processed_courses += 1
                    continue
                
                # Always require reminder list name
                if not reminder_list or reminder_list.strip() == '':
                    processed_courses += 1
                    continue
                
                yield f"data: {json.dumps({'type': 'progress', 'message': f'Processing {course_name}...', 'progress': 10 + int((processed_courses / total_courses) * 70)})}\n\n"
                
                items = canvas_api.get_course_items(course_id)
                
                if not items:
                    processed_courses += 1
                    continue
                
                items.sort(key=get_due_date)
                new_assignments, new_items, new_assignments_data = processor.process_course_assignments(
                    reminder_list, items, course_name, college_name, now
                )
                
                # If auto-sync is enabled, add reminders for new assignments
                if auto_sync_enabled and new_assignments > 0:
                    yield f"data: {json.dumps({'type': 'progress', 'message': f'Adding reminders for {course_name}...', 'progress': 10 + int((processed_courses / total_courses) * 70)})}\n\n"
                    for assignment_data in new_assignments_data:
                        assignment_id = assignment_data.get('assignment_id')
                        if assignment_id:
                            assignment = db.get_assignment(assignment_id)
                            if assignment:
                                title = assignment[2]
                                due_at = assignment[4]
                                reminder_list_name = assignment[6]
                                ai_notes = assignment[7] if len(assignment) > 7 else ""
                                
                                try:
                                    due_date_utc = datetime.strptime(due_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                                    local_due = due_date_utc.astimezone()
                                    apple_due = local_due.strftime("%A, %B %d, %Y at %I:%M:%S %p")
                                    
                                    reminders_manager.add_reminder(title, apple_due, reminder_list_name, ai_notes or "")
                                    db.mark_reminder_added(assignment_id)
                                except Exception as e:
                                    print(f"Error adding reminder for {title}: {e}")
                
                if new_assignments > 0:
                    added_by_course[course_name] = new_items
                    total_added += new_assignments
                    new_assignments_list.extend(new_assignments_data)
                    yield f"data: {json.dumps({'type': 'progress', 'message': f'Added {new_assignments} assignment(s) from {course_name}', 'progress': 10 + int((processed_courses / total_courses) * 70)})}\n\n"
                    
                    # Send each assignment as it's created for incremental display
                    for assignment_data in new_assignments_data:
                        assignment = db.get_assignment(assignment_data['assignment_id'])
                        if assignment:
                            # Get reminder_added status
                            reminder_added = assignment[8] if len(assignment) > 8 else 0
                            assignment_dict = {
                                'assignment_id': assignment[1],
                                'title': assignment[2],
                                'description': assignment[3],
                                'due_at': assignment[4],
                                'course_name': assignment[5],
                                'reminder_list': assignment[6],
                                'ai_notes': assignment[7] if len(assignment) > 7 else None,
                                'reminder_added': reminder_added
                            }
                            yield f"data: {json.dumps({'type': 'progress', 'message': f'Added {assignment_data["title"]}', 'progress': 10 + int((processed_courses / total_courses) * 70), 'assignment': assignment_dict})}\n\n"
                
                processed_courses += 1
            
            yield f"data: {json.dumps({'type': 'complete', 'total_added': total_added, 'added_by_course': added_by_course, 'new_assignments': new_assignments_list, 'progress': 100})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'GET':
        college_name = db.get_setting("college_name")
        auto_sync_reminders = db.get_setting("auto_sync_reminders") or '0'
        return jsonify({
            'college_name': college_name,
            'auto_sync_reminders': auto_sync_reminders
        })
    else:
        data = request.json
        college_name = data.get('college_name', '')
        auto_sync_reminders = data.get('auto_sync_reminders', '0')
        
        if college_name:
            db.save_setting("college_name", college_name)
        
        db.save_setting("auto_sync_reminders", auto_sync_reminders)
        
        return jsonify({'success': True})

@app.route('/api/course-mapping', methods=['POST'])
def update_course_mapping():
    try:
        data = request.json
        course_name = data.get('course_name')
        reminder_list = data.get('reminder_list')
        
        if course_name and reminder_list:
            db.save_course_mapping(course_name, reminder_list)
            return jsonify({'success': True})
        return jsonify({'error': 'Missing course_name or reminder_list'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/course-mapping/disable', methods=['POST'])
def disable_course_mapping():
    try:
        data = request.json
        course_name = data.get('course_name')
        if not course_name:
            return jsonify({'error': 'Missing course_name'}), 400
        db.delete_course_mapping(course_name)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/course-mapping/enable', methods=['POST'])
def enable_course_mapping():
    try:
        data = request.json
        course_name = data.get('course_name')
        if not course_name:
            return jsonify({'error': 'Missing course_name'}), 400
        db.enable_course_mapping(course_name)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/add-reminder', methods=['POST'])
def add_reminder_to_assignment():
    try:
        if not initialize_components():
            return jsonify({'error': 'Canvas API not configured'}), 500
        
        data = request.json
        assignment_id = data.get('assignment_id')
        if not assignment_id:
            return jsonify({'error': 'Missing assignment_id'}), 400
        
        # Get assignment from database
        assignment = db.get_assignment(assignment_id)
        if not assignment:
            return jsonify({'error': 'Assignment not found'}), 404
        
        # assignment structure: (id, assignment_id, title, description, due_at, course_name, reminder_list, ai_notes)
        title = assignment[2]
        due_at = assignment[4]
        reminder_list = assignment[6]
        ai_notes = assignment[7] if len(assignment) > 7 else ""
        
        # Convert due_at to Apple Reminders format
        try:
            due_date_utc = datetime.strptime(due_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            local_due = due_date_utc.astimezone()
            apple_due = local_due.strftime("%A, %B %d, %Y at %I:%M:%S %p")
        except Exception:
            return jsonify({'error': 'Invalid due date format'}), 400
        
        # Add reminder
        reminders_manager.add_reminder(title, apple_due, reminder_list, ai_notes or "")
        
        # Mark reminder as added in database
        db.mark_reminder_added(assignment_id)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/remove-reminder', methods=['POST'])
def remove_reminder_from_assignment():
    try:
        if not initialize_components():
            return jsonify({'error': 'Canvas API not configured'}), 500
        
        data = request.json
        assignment_id = data.get('assignment_id')
        if not assignment_id:
            return jsonify({'error': 'Missing assignment_id'}), 400
        
        # Get assignment from database
        assignment = db.get_assignment(assignment_id)
        if not assignment:
            return jsonify({'error': 'Assignment not found'}), 404
        
        title = assignment[2]
        reminder_list = assignment[6]
        
        # Remove reminder
        reminders_manager.remove_existing_reminder(title, reminder_list)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5001)


import os
import json
import requests
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo
EST = ZoneInfo("America/New_York")
from flask import Flask, render_template, jsonify, request, send_from_directory, Response, stream_with_context
from dotenv import load_dotenv
from pathlib import Path
from backend import Database, AIEnhancer, RemindersManager, CanvasAPI, AssignmentProcessor
from concurrent.futures import ThreadPoolExecutor, as_completed

load_dotenv()

app = Flask(__name__, template_folder='.', static_folder='.')

db_path = str(Path(__file__).parent / "studysync-web.db")
db = Database(db_path=db_path)

try:
    db.init_database()
    
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
    
    try:
        if os.path.exists(db_path):
            os.remove(db_path)
        print("Recreating database...")
        db = Database(db_path=db_path)
    except Exception as e2:
        print(f"Failed to recreate database: {e2}")
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
    
    
    ollama_model = os.getenv("OLLAMA_MODEL")
    if not ollama_model:
        print("ERROR: OLLAMA_MODEL not set in .env file. AI features will be disabled.")
        return False
    
    ai_enhancer = AIEnhancer(ollama_model=ollama_model)
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

@app.route('/colleges.csv')
def colleges_csv():
    return send_from_directory('.', 'colleges.csv', mimetype='text/csv')

@app.route('/api/assignments')
def get_assignments():
    try:
        include_deleted = request.args.get('include_deleted', 'false').lower() == 'true'
        assignments = db.get_all_assignments(include_deleted=include_deleted)
        result = []
        for assignment in assignments:
            result.append({
                'assignment_id': assignment[0],
                'title': assignment[1],
                'description': assignment[2],
                'due_at': assignment[3],
                'course_name': assignment[4],
                'reminder_list': assignment[5],
                'ai_notes': assignment[6] if len(assignment) > 6 else None,
                'reminder_added': assignment[7] if len(assignment) > 7 else 0,
                'status': assignment[8] if len(assignment) > 8 else 'Not Started',
                'priority': assignment[9] if len(assignment) > 9 else 'Medium',
                'user_notes': assignment[10] if len(assignment) > 10 else '',
                'deleted': assignment[11] if len(assignment) > 11 else 0,
                'time_estimate': assignment[12] if len(assignment) > 12 else None,
                'suggested_priority': assignment[13] if len(assignment) > 13 else None,
                'ai_confidence': assignment[14] if len(assignment) > 14 else None,
                'ai_confidence_explanation': assignment[15] if len(assignment) > 15 else None
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/deleted')
def get_deleted_assignments():
    try:
        deleted = db.get_deleted_assignments()
        result = []
        for item in deleted:
            result.append({
                'assignment_id': item[0],
                'title': item[1],
                'course_name': item[2],
                'deleted_at': item[3]
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/delete', methods=['POST'])
def delete_assignment():
    try:
        data = request.json
        assignment_id = data.get('assignment_id')
        if not assignment_id:
            return jsonify({'error': 'Missing assignment_id'}), 400
        
        db.delete_assignment(assignment_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/restore', methods=['POST'])
def restore_assignment():
    try:
        data = request.json
        assignment_id = data.get('assignment_id')
        if not assignment_id:
            return jsonify({'error': 'Missing assignment_id'}), 400
        
        db.restore_assignment(assignment_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/permanently-delete', methods=['POST'])
def permanently_delete_assignment():
    try:
        data = request.json
        assignment_id = data.get('assignment_id')
        if not assignment_id:
            return jsonify({'error': 'Missing assignment_id'}), 400
        
        db.permanently_delete_assignment(assignment_id)
        return jsonify({'success': True})
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
            
            if reminder_list is None:
                reminder_list = ''
                enabled = None
            result.append({
                'id': course.get('id'),
                'name': course_name,
                'reminder_list': reminder_list or '',
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

            auto_sync_reminders = db.get_setting("auto_sync_reminders") or '0'
            auto_sync_enabled = auto_sync_reminders == '1'
            
            ai_summary_enabled_setting = db.get_setting("ai_summary_enabled")
            
            ai_summary_enabled = ai_summary_enabled_setting != '0'
            
            
            now = datetime.now(EST)
            
            api_token = os.getenv("CANVAS_API_TOKEN")
            canvas_domain = os.getenv("CANVAS_DOMAIN")
            headers = {"Authorization": f"Bearer {api_token}"}
            base_url = f"https://{canvas_domain}/api/v1"
            
            response = requests.get(f"{base_url}/users/self/favorites/courses", headers=headers)
            response.raise_for_status()
            favorite_courses = response.json()
            
            total_added = 0
            added_by_course = {}
            total_courses = len(favorite_courses)
            processed_courses = 0
            
            
            enabled_courses = []
            for course in favorite_courses:
                course_id = course.get("id")
                course_name = course.get("name", "Unnamed Course")
                
                if not course_id:
                    continue
                
                reminder_list, enabled = db.get_course_mapping_with_enabled(course_name)
                if enabled == 0:
                    continue

                if not reminder_list or reminder_list.strip() == '':
                    continue
                
                enabled_courses.append({
                    'id': course_id,
                    'name': course_name,
                    'reminder_list': reminder_list
                })
            
            
            course_data = {}
            with ThreadPoolExecutor(max_workers=min(5, len(enabled_courses))) as executor:
                future_to_course = {
                    executor.submit(canvas_api.get_course_items, course['id']): course
                    for course in enabled_courses
                }
                
                for future in as_completed(future_to_course):
                    course = future_to_course[future]
                    try:
                        items = future.result()
                        course_data[course['id']] = {
                            'course': course,
                            'items': items
                        }
                    except Exception as e:
                        print(f"Error fetching course {course['name']}: {e}")
                        course_data[course['id']] = {
                            'course': course,
                            'items': []
                        }
            
            
            all_assignments_to_process = []
            
            
            for course_id, data in course_data.items():
                course = data['course']
                course_name = course['name']
                reminder_list = course['reminder_list']
                items = data['items']
                
                if not items:
                    continue
                
                items.sort(key=get_due_date)
                
                for item in items:
                    should_process, assignment_data = processor.should_process_assignment(item, now)
                    if should_process:
                        
                        existing = db.get_assignment(assignment_data['assignment_id'])
                        needs_ai = (ai_summary_enabled and
                                   ai_enhancer and
                                   ai_enhancer.model and
                                   (not existing or not existing[7] or not existing[7].strip()))
                        
                        all_assignments_to_process.append({
                            'assignment_data': assignment_data,
                            'course_name': course_name,
                            'reminder_list': reminder_list,
                            'needs_ai': needs_ai
                        })
            
            
            import time
            total_assignments_for_reminders = len(all_assignments_to_process)
            assignments_needing_ai = [a for a in all_assignments_to_process if a['needs_ai']] if all_assignments_to_process else []
            
            total_ai_time = len(assignments_needing_ai) * 3.5 if assignments_needing_ai else 0
            total_reminder_time = total_assignments_for_reminders * 1.5 if auto_sync_enabled else 0
            total_estimated_time = total_ai_time + total_reminder_time
            
            phase_start_time = None
            ai_results = {}
            
            if all_assignments_to_process:
                total_assignments_count = len(all_assignments_to_process)
                yield f"data: {json.dumps({'type': 'progress', 'assignment_count': total_assignments_count, 'message': 'Fetching courses...', 'progress': 0})}\n\n"
                
                if assignments_needing_ai and ai_enhancer and ai_enhancer.model and ai_summary_enabled:
                    phase_start_time = time.time()
                    yield f"data: {json.dumps({'type': 'progress', 'message': 'Generating AI summaries...', 'progress': 0})}\n\n"
                    
                    def process_ai_assignment(assignment_info):
                        try:
                            assignment_data = assignment_info['assignment_data']
                            course_name = assignment_info['course_name']
                            reminder_list = assignment_info['reminder_list']
                            
                            title = assignment_data["title"]
                            description = assignment_data.get("description", "")
                            
                            ai_notes, time_estimate, suggested_priority, ai_confidence, ai_confidence_explanation = ai_enhancer.enhance_assignment(
                                title, description, course_name, college_name
                            )
                            
                            return {
                                'assignment_data': assignment_data,
                                'course_name': course_name,
                                'reminder_list': reminder_list,
                                'ai_notes': ai_notes,
                                'time_estimate': time_estimate,
                                'suggested_priority': suggested_priority,
                                'ai_confidence': ai_confidence,
                                'ai_confidence_explanation': ai_confidence_explanation
                            }
                        except Exception as e:
                            print(f"Error processing AI for assignment {assignment_info['assignment_data']['title']}: {e}")
                            return {
                                'assignment_data': assignment_info['assignment_data'],
                                'course_name': assignment_info['course_name'],
                                'reminder_list': assignment_info['reminder_list'],
                                'ai_notes': "",
                                'time_estimate': None,
                                'suggested_priority': None,
                                'ai_confidence': None,
                                'ai_confidence_explanation': None
                            }
                    
                    
                    with ThreadPoolExecutor(max_workers=1) as executor:
                        future_to_assignment = {
                            executor.submit(process_ai_assignment, assignment_info): assignment_info
                            for assignment_info in assignments_needing_ai
                        }
                        
                        completed = 0
                        for future in as_completed(future_to_assignment):
                            assignment_info = future_to_assignment[future]
                            try:
                                result = future.result()
                                assignment_id = result['assignment_data']['assignment_id']
                                ai_results[assignment_id] = result
                                
                                completed += 1
                                
                                if total_estimated_time > 0:
                                    ai_progress = (completed / len(assignments_needing_ai)) * (total_ai_time / total_estimated_time * 100)
                                    progress = int(ai_progress)
                                else:
                                    progress = int((completed / len(assignments_needing_ai)) * 100) if len(assignments_needing_ai) > 0 else 0
                                
                                yield f"data: {json.dumps({'type': 'progress', 'message': 'Generating AI summaries...', 'progress': progress})}\n\n"
                            except Exception as e:
                                print(f"Error in AI processing: {e}")
                elif (not assignments_needing_ai or not ai_summary_enabled) and auto_sync_enabled and total_assignments_for_reminders > 0:
                    phase_start_time = time.time()
                    yield f"data: {json.dumps({'type': 'progress', 'message': 'Adding reminders...', 'progress': 0})}\n\n"
                elif not auto_sync_enabled and (not assignments_needing_ai or not ai_summary_enabled):
                    phase_start_time = time.time()
                    yield f"data: {json.dumps({'type': 'progress', 'message': 'Processing assignments...', 'progress': 0})}\n\n"
            
            
            processed_courses = 0
            reminders_added = 0
            reminder_phase_start_time = None
            
            for course_id, data in course_data.items():
                course = data['course']
                course_name = course['name']
                reminder_list = course['reminder_list']
                items = data['items']
                
                if not items:
                    processed_courses += 1
                    continue
                
                items.sort(key=get_due_date)

                new_assignments = 0
                new_items = []
                
                for item in items:
                    should_process, assignment_data = processor.should_process_assignment(item, now)
                    if should_process:
                        new_assignments += 1
                        new_items.append((assignment_data["title"], assignment_data["display_due"]))
                        
                        assignment_id = assignment_data['assignment_id']
                        
                        
                        if assignment_id in ai_results:
                            
                            ai_result = ai_results[assignment_id]
                            ai_notes = ai_result['ai_notes']
                            time_estimate = ai_result['time_estimate']
                            suggested_priority = ai_result['suggested_priority']
                            ai_confidence = ai_result['ai_confidence']
                            ai_confidence_explanation = ai_result['ai_confidence_explanation']
                            
                            
                            db.save_assignment(assignment_id, assignment_data['title'],
                                             assignment_data.get('description', ''),
                                             assignment_data['due_at'],
                                             course_name, reminder_list, ai_notes)
                            
                            
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
                                db.update_assignment_fields(assignment_id, **update_fields)
                        else:
                            
                            processor.process_assignment(assignment_data, reminder_list, course_name, college_name, ai_summary_enabled)
                        
                        
                        assignment = db.get_assignment(assignment_id)
                        if assignment:
                            assignment_dict = {
                                'assignment_id': assignment[1],
                                'title': assignment[2],
                                'description': assignment[3],
                                'due_at': assignment[4],
                                'course_name': assignment[5],
                                'reminder_list': assignment[6],
                                'ai_notes': assignment[7] if len(assignment) > 7 else None,
                                'reminder_added': assignment[8] if len(assignment) > 8 else 0,
                                'status': assignment[9] if len(assignment) > 9 else 'Not Started',
                                'priority': assignment[10] if len(assignment) > 10 else 'Medium',
                                'user_notes': assignment[11] if len(assignment) > 11 else '',
                                'deleted': assignment[12] if len(assignment) > 12 else 0,
                                'time_estimate': assignment[13] if len(assignment) > 13 else None,
                                'suggested_priority': assignment[14] if len(assignment) > 14 else None,
                                'ai_confidence': assignment[15] if len(assignment) > 15 else None,
                                'ai_confidence_explanation': assignment[16] if len(assignment) > 16 else None
                            }

                            if phase_start_time is not None:
                                if auto_sync_enabled:
                                    if reminder_phase_start_time is None:
                                        reminder_phase_start_time = time.time()
                                    
                                    reminders_added += 1
                                    
                                    if total_estimated_time > 0:
                                        ai_progress = (total_ai_time / total_estimated_time * 100) if total_ai_time > 0 else 0
                                        reminder_progress = (reminders_added / total_assignments_for_reminders) * (total_reminder_time / total_estimated_time * 100) if total_reminder_time > 0 and total_assignments_for_reminders > 0 else 0
                                        progress = int(ai_progress + reminder_progress)
                                    else:
                                        reminder_progress = (reminders_added / total_assignments_for_reminders) * 100 if total_assignments_for_reminders > 0 else 0
                                        progress = int(reminder_progress)
                                    
                                    yield f"data: {json.dumps({'type': 'progress', 'message': 'Adding reminders...', 'progress': progress, 'assignment': assignment_dict})}\n\n"
                                else:
                                    if total_estimated_time > 0:
                                        ai_progress = (total_ai_time / total_estimated_time * 100) if total_ai_time > 0 else 0
                                    else:
                                        ai_progress = 100 if len(assignments_needing_ai) > 0 and ai_summary_enabled else 0
                                    yield f"data: {json.dumps({'type': 'progress', 'message': 'Processing assignments...', 'progress': ai_progress, 'assignment': assignment_dict})}\n\n"
                            else:
                                progress_val = 0
                                if phase_start_time is not None:
                                    if total_estimated_time > 0:
                                        if total_ai_time > 0:
                                            progress_val = int((total_ai_time / total_estimated_time) * 100)
                                        elif total_reminder_time > 0:
                                            progress_val = 0
                                    else:
                                        progress_val = 0
                                yield f"data: {json.dumps({'type': 'progress', 'message': 'Processing assignments...', 'progress': progress_val, 'assignment': assignment_dict})}\n\n"

                            if auto_sync_enabled:
                                try:
                                    due_at = assignment[4]
                                    title = assignment[2]
                                    reminder_list_name = assignment[6]
                                    ai_notes = assignment[7] if len(assignment) > 7 else ""
                                    
                                    due_date_utc = datetime.strptime(due_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=ZoneInfo("UTC"))
                                    local_due = due_date_utc.astimezone(EST)
                                    apple_due = local_due.strftime("%A, %B %d, %Y at %I:%M:%S %p")
                                    
                                    reminders_manager.add_reminder(title, apple_due, reminder_list_name, ai_notes or "")
                                    db.mark_reminder_added(assignment_dict['assignment_id'])
                                except Exception as e:
                                    print(f"Error adding reminder for {title}: {e}")
                
                if new_assignments > 0:
                    added_by_course[course_name] = new_items
                    total_added += new_assignments
                
                processed_courses += 1

            db.set_last_sync_timestamp(datetime.now(EST).isoformat())
            
            if phase_start_time is not None:
                yield f"data: {json.dumps({'type': 'progress', 'message': 'Finishing up...', 'progress': 100})}\n\n"
            
            yield f"data: {json.dumps({'type': 'complete', 'total_added': total_added, 'added_by_course': added_by_course, 'progress': 100})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'GET':
        college_name = db.get_setting("college_name")
        auto_sync_reminders = db.get_setting("auto_sync_reminders") or '0'
        ai_summary_enabled = db.get_setting("ai_summary_enabled")
        
        
        return jsonify({
            'college_name': college_name,
            'auto_sync_reminders': auto_sync_reminders,
            'ai_summary_enabled': ai_summary_enabled
        })
    else:
        data = request.json
        college_name = data.get('college_name', '')
        auto_sync_reminders = data.get('auto_sync_reminders', '0')
        ai_summary_enabled = data.get('ai_summary_enabled', '1')
        
        if college_name:
            db.save_setting("college_name", college_name)
        
        db.save_setting("auto_sync_reminders", auto_sync_reminders)
        db.save_setting("ai_summary_enabled", ai_summary_enabled)
        
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

        assignment = db.get_assignment(assignment_id)
        if not assignment:
            
            all_assignments = db.get_all_assignments(include_deleted=False)
            
            assignment_ids = [a[0] for a in all_assignments if len(a) > 0]
            return jsonify({
                'error': f'Assignment not found. Searched ID: "{assignment_id}" (type: {type(assignment_id).__name__}). Found {len(assignment_ids)} assignments. First few IDs: {assignment_ids[:5]}'
            }), 404

        title = assignment[2]
        due_at = assignment[4]
        reminder_list = assignment[6]
        ai_notes = assignment[7] if len(assignment) > 7 else ""

        try:
            due_date_utc = None
            date_formats = [
                "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%dT%H:%M:%S.%fZ",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S"
            ]
            
            for fmt in date_formats:
                try:
                    due_date_utc = datetime.strptime(due_at, fmt).replace(tzinfo=ZoneInfo("UTC"))
                    break
                except ValueError:
                    continue
            
            if due_date_utc is None:
                try:
                    due_date_utc = datetime.fromisoformat(due_at.replace('Z', '+00:00'))
                    if due_date_utc.tzinfo is None:
                        due_date_utc = due_date_utc.replace(tzinfo=ZoneInfo("UTC"))
                except (ValueError, TypeError):
                    raise ValueError(f"Could not parse date: {due_at}")
            
            local_due = due_date_utc.astimezone(EST)
            apple_due = local_due.strftime("%A, %B %d, %Y at %I:%M:%S %p")
        except Exception as e:
            return jsonify({'error': f'Invalid due date format: {str(e)}'}), 400

        reminders_manager.add_reminder(title, apple_due, reminder_list, ai_notes or "")

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

        assignment = db.get_assignment(assignment_id)
        if not assignment:
            return jsonify({'error': 'Assignment not found'}), 404
        
        title = assignment[2]
        reminder_list = assignment[6]

        reminders_manager.remove_existing_reminder(title, reminder_list)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/generate-ai-summary', methods=['POST'])
def generate_ai_summary_for_assignment():
    try:
        if not initialize_components():
            return jsonify({'error': 'AI not configured'}), 500
        
        data = request.json
        assignment_id = data.get('assignment_id')
        if not assignment_id:
            return jsonify({'error': 'Missing assignment_id'}), 400

        assignment = db.get_assignment(assignment_id)
        if not assignment:
            return jsonify({'error': 'Assignment not found'}), 404

        
        existing_ai_notes = assignment[7] if len(assignment) > 7 else None
        if existing_ai_notes and existing_ai_notes.strip():
            return jsonify({'error': 'AI summary already exists for this assignment'}), 400

        title = assignment[2]
        description = assignment[3] if len(assignment) > 3 else ''
        course_name = assignment[5] if len(assignment) > 5 else ''
        college_name = db.get_setting('college_name') or ''

        global ai_enhancer
        if ai_enhancer is None:
            ai_enhancer = AIEnhancer()

        if not ai_enhancer or not ai_enhancer.model:
            return jsonify({'error': 'AI model not available'}), 500

        
        ai_notes, time_estimate, suggested_priority, ai_confidence, ai_confidence_explanation = ai_enhancer.enhance_assignment(
            title, description, course_name, college_name
        )

        
        db.update_assignment_fields(
            assignment_id,
            ai_notes=ai_notes
        )

        
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
            db.update_assignment_fields(assignment_id, **update_fields)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/update', methods=['POST'])
def update_assignment():
    try:
        data = request.json
        assignment_id = data.get('assignment_id')
        if not assignment_id:
            return jsonify({'error': 'Missing assignment_id'}), 400

        fields_to_update = {k: v for k, v in data.items() if k != 'assignment_id'}
        
        if not fields_to_update:
            return jsonify({'error': 'No fields to update'}), 400

        allowed_fields = ['status', 'priority', 'user_notes', 'time_estimate', 'suggested_priority', 'ai_confidence', 'ai_confidence_explanation']
        fields_to_update = {k: v for k, v in fields_to_update.items() if k in allowed_fields}
        
        if not fields_to_update:
            return jsonify({'error': 'Invalid fields'}), 400
        
        db.update_assignment_fields(assignment_id, **fields_to_update)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/bulk-update', methods=['POST'])
def bulk_update_assignments():
    try:
        data = request.json
        assignment_ids = data.get('assignment_ids', [])
        fields_to_update = data.get('fields', {})
        
        if not assignment_ids:
            return jsonify({'error': 'No assignment IDs provided'}), 400
        
        if not fields_to_update:
            return jsonify({'error': 'No fields to update'}), 400

        allowed_fields = ['status', 'priority', 'reminder_added']
        fields_to_update = {k: v for k, v in fields_to_update.items() if k in allowed_fields}
        
        if not fields_to_update:
            return jsonify({'error': 'Invalid fields'}), 400

        for assignment_id in assignment_ids:
            db.update_assignment_fields(assignment_id, **fields_to_update)
        
        return jsonify({'success': True, 'updated': len(assignment_ids)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/create', methods=['POST'])
def create_assignment():
    try:
        data = request.json
        assignment_id = data.get('assignment_id')
        title = data.get('title')
        description = data.get('description', '')
        due_at = data.get('due_at')
        course_name = data.get('course_name')
        reminder_list = data.get('reminder_list')
        
        if not all([assignment_id, title, due_at, course_name, reminder_list]):
            return jsonify({'error': 'Missing required fields'}), 400

        college_name = db.get_setting('college_name') or ''
        user_notes = data.get('user_notes', '')

        global ai_enhancer
        if ai_enhancer is None:
            ai_enhancer = AIEnhancer()

        ai_notes = ""
        time_estimate = None
        suggested_priority = None
        ai_confidence = None
        ai_confidence_explanation = None
        
        ai_summary_enabled_setting = db.get_setting("ai_summary_enabled")
        
        ai_summary_enabled = ai_summary_enabled_setting != '0'
        
        if description and description.strip() and ai_summary_enabled and ai_enhancer and ai_enhancer.model:
            ai_notes, time_estimate, suggested_priority, ai_confidence, ai_confidence_explanation = ai_enhancer.enhance_assignment(
                title, description, course_name, college_name
            )

        db.save_assignment(assignment_id, title, description, due_at, course_name, reminder_list, ai_notes)

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
                db.update_assignment_fields(assignment_id, **update_fields)
        
        if user_notes:
            db.update_assignment_fields(assignment_id, user_notes=user_notes)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/ai-insights/check', methods=['GET'])
def check_ai_insights():
    """Check if AI insights exist in database"""
    try:
        cached = db.get_ai_insights()
        if cached:
            return jsonify({'exists': True, 'end_date': cached.get('end_date')})
        return jsonify({'exists': False})
    except Exception as e:
        return jsonify({'exists': False, 'error': str(e)})

@app.route('/api/ai-insights', methods=['GET'])
def get_ai_insights():
    """Get AI insights with caching"""
    try:
        force_refresh = request.args.get('refresh', 'false').lower() == 'true'
        end_date = request.args.get('end_date')
        
        if not end_date:
            return jsonify({'error': 'End date is required'}), 400

        if not force_refresh:
            cached = db.get_ai_insights()
            if cached:
                cached_end_date = cached.get('end_date')
                if cached_end_date == end_date:
                    generated_at_str = cached['generated_at']
                    try:
                        if '+' in generated_at_str or generated_at_str.endswith('-05:00') or generated_at_str.endswith('-04:00'):
                            generated_at = datetime.fromisoformat(generated_at_str)
                            if generated_at.tzinfo != EST:
                                generated_at = generated_at.astimezone(EST)
                        elif 'Z' in generated_at_str:
                            generated_at = datetime.fromisoformat(generated_at_str.replace('Z', '+00:00'))
                            generated_at = generated_at.astimezone(EST)
                        else:
                            generated_at = datetime.fromisoformat(generated_at_str)
                            generated_at = generated_at.replace(tzinfo=EST)
                    except (ValueError, TypeError):
                        try:
                            generated_at = datetime.strptime(generated_at_str, "%Y-%m-%d %H:%M:%S")
                            generated_at = generated_at.replace(tzinfo=EST)
                        except (ValueError, TypeError):
                            generated_at = datetime.now(EST)
                    
                    current_time = datetime.now(EST)

                    age_hours = (current_time - generated_at).total_seconds() / 3600
                    if age_hours < 24:
                        last_sync_ts = db.get_last_sync_timestamp()
                        if last_sync_ts:
                            try:
                                if 'Z' in last_sync_ts or '+' in last_sync_ts or last_sync_ts.endswith('+00:00'):
                                    last_sync = datetime.fromisoformat(last_sync_ts.replace('Z', '+00:00'))
                                else:
                                    last_sync = datetime.fromisoformat(last_sync_ts)
                                    last_sync = last_sync.replace(tzinfo=EST)
                            except (ValueError, TypeError):
                                last_sync = datetime.strptime(last_sync_ts, "%Y-%m-%d %H:%M:%S")
                                last_sync = last_sync.replace(tzinfo=EST)
                            
                            if last_sync <= generated_at:
                                return jsonify({
                                    'success': True,
                                    'insights': json.loads(cached['insights_json']),
                                    'cached': True,
                                    'generated_at': cached['generated_at']
                                })
                        else:
                            return jsonify({
                                'success': True,
                                'insights': json.loads(cached['insights_json']),
                                'cached': True,
                                'generated_at': cached['generated_at']
                            })

        if not initialize_components():
            return jsonify({'error': 'AI not configured'}), 500

        assignments = db.get_all_assignments(include_deleted=False)

        try:
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid end date format'}), 400
        
        active_assignments = []
        for assignment in assignments:
            status = assignment[8] if len(assignment) > 8 else 'Not Started'
            if status != 'Completed':
                due_at = assignment[3]
                try:
                    due_date_obj = datetime.strptime(due_at, "%Y-%m-%dT%H:%M:%SZ")
                    if due_date_obj.date() > end_date_obj.date():
                        continue
                except (ValueError, TypeError):
                    pass
                
                time_estimate_raw = assignment[12] if len(assignment) > 12 else None
                try:
                    time_estimate = float(time_estimate_raw) if time_estimate_raw is not None else None
                except (ValueError, TypeError):
                    time_estimate = None
                
                active_assignments.append({
                    'assignment_id': assignment[0],
                    'title': assignment[1],
                    'description': assignment[2] if len(assignment) > 2 else '',
                    'due_at': assignment[3],
                    'course_name': assignment[4],
                    'reminder_list': assignment[5],
                    'ai_notes': assignment[6] if len(assignment) > 6 else None,
                    'reminder_added': assignment[7] if len(assignment) > 7 else 0,
                    'status': status,
                    'priority': assignment[9] if len(assignment) > 9 else 'Medium',
                    'user_notes': assignment[10] if len(assignment) > 10 else '',
                    'time_estimate': time_estimate,
                    'suggested_priority': assignment[14] if len(assignment) > 14 else None,
                    'ai_confidence': assignment[15] if len(assignment) > 15 else None
                })
        
        if not active_assignments:
            return jsonify({'error': 'No active assignments to analyze within the selected date range'}), 400

        college_name = db.get_setting('college_name') or ''

        insights = ai_enhancer.generate_comprehensive_insights(active_assignments, college_name, end_date)
        
        if not insights:
            return jsonify({'error': 'Failed to generate AI insights'}), 500

        last_sync_before = db.get_last_sync_timestamp() or datetime.now(EST).isoformat()

        db.save_ai_insights(json.dumps(insights), last_sync_before, end_date)
        
        return jsonify({
            'success': True,
            'insights': insights,
            'cached': False,
            'generated_at': datetime.now(EST).isoformat()
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/assignments/study-plan', methods=['GET'])
def generate_study_plan():
    try:
        assignments = db.get_all_assignments(include_deleted=False)

        active_assignments = []
        for assignment in assignments:
            status = assignment[8] if len(assignment) > 8 else 'Not Started'
            if status != 'Completed':
                time_estimate_raw = assignment[12] if len(assignment) > 12 else None
                try:
                    time_estimate = float(time_estimate_raw) if time_estimate_raw is not None else None
                except (ValueError, TypeError):
                    time_estimate = None
                
                active_assignments.append({
                    'assignment_id': assignment[0],
                    'title': assignment[1],
                    'due_at': assignment[3],
                    'course_name': assignment[4],
                    'priority': assignment[9] if len(assignment) > 9 else 'Medium',
                    'time_estimate': time_estimate,
                    'status': status
                })

        def sort_key(a):
            due_date = datetime.strptime(a['due_at'], "%Y-%m-%dT%H:%M:%SZ")
            priority_order = {'High': 0, 'Medium': 1, 'Low': 2}
            return (due_date, priority_order.get(a['priority'], 1))
        
        active_assignments.sort(key=sort_key)

        study_plan = []
        current_date = datetime.now(EST)
        
        for assignment in active_assignments:
            due_date = datetime.strptime(assignment['due_at'], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=ZoneInfo("UTC")).astimezone(EST)
            days_until_due = (due_date - current_date).days

            time_estimate = assignment.get('time_estimate')
            if time_estimate is None:
                time_estimate = 2.0
            else:
                try:
                    time_estimate = float(time_estimate)
                except (ValueError, TypeError):
                    time_estimate = 2.0

            if time_estimate > 8:
                suggested_start_days = max(1, int(time_estimate / 4))
            else:
                suggested_start_days = max(1, days_until_due - 1)
            
            study_plan.append({
                'assignment_id': assignment['assignment_id'],
                'title': assignment['title'],
                'course_name': assignment['course_name'],
                'due_date': assignment['due_at'],
                'days_until_due': days_until_due,
                'time_estimate': time_estimate,
                'priority': assignment['priority'],
                'suggested_start_days_before': suggested_start_days,
                'status': assignment['status']
            })
        
        return jsonify({'success': True, 'study_plan': study_plan})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5001)
